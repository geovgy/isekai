import "server-only";

import { createShieldedTransferOutputNotes } from "@/src/storage/utils";
import { getMerkleTree } from "@/src/merkle";
import { getRandomBlinding } from "@/src/joinsplits";
import { queryBranchShieldedTransferSigners } from "@/src/subgraph-queries";
import type {
  CompleteMarketFulfillmentInput,
  MarketInputNote,
  MarketOfferRequestRecord,
  MarketOutputNote,
  MarketRequestNotes,
  MarketSignerDelegation,
  MarketWormholeNote,
} from "@/src/server/market-offer-requests";
import {
  findLatestSignerStateForDelegation,
  inferShieldedMasterRootFromInputNotes,
} from "@/src/server/market-offer-requests";
import { getChainConfig } from "@/src/chains";
import {
  TransferType,
  type DelegatedShieldedTx,
  type DelegatedShieldedTxStringified,
  type InputNote,
  type MarketFulfillmentExecutionPayload,
  type MarketFulfillmentProofFixtureRequest,
  type MarketFulfillmentProofServiceRequest,
  type MarketFulfillmentProofServiceResponse,
  type MarketOutputNotePayload,
  type MarketSignerNoteMembershipPayload,
  type MarketSignerNoteStatePayload,
  type MarketWormholeNotePayload,
  type OutputNote,
  type Withdrawal,
} from "@/src/types";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  getAddress,
  hashTypedData,
  hexToBytes,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MERKLE_TREE_DEPTH = 20;
const ZERO_32 = toHex(0n, { size: 32 });
const SIGNER_DELEGATION_TYPE =
  "SignerDelegation(uint64 chainId,address owner,address delegate,uint64 startTime,uint64 endTime,address token,uint256 tokenId,uint256 amount,uint8 amountType,uint64 maxCumulativeAmount,uint64 maxNonce,uint64 timeInterval,uint8 transferType)";

type ParsedSignerDelegation = {
  chainId: bigint;
  owner: Address;
  delegate: Address;
  startTime: bigint;
  endTime: bigint;
  token: Address;
  tokenId: bigint;
  amount: bigint;
  amountType: number;
  maxCumulativeAmount: bigint;
  maxNonce: bigint;
  timeInterval: bigint;
  transferType: number;
};

type SignerNoteState = {
  totalAmount: bigint;
  nonce: bigint;
  timestamp: bigint;
  blinding: bigint;
  commitment: Hex;
  signerRoot: Hex;
  txHash: Hex;
  blockNumber: bigint;
};

type DelegatedWormholeDeposit = {
  dst_chain_id: bigint;
  src_chain_id: bigint;
  entry_id: bigint;
  recipient: Address;
  wormhole_secret: bigint;
  token: bigint;
  token_id: bigint;
  to: Address;
  from: Address;
  amount: bigint;
  master_root: bigint;
  branch_index: bigint;
  branch_siblings: bigint[];
  branch_root: bigint;
  master_index: bigint;
  master_siblings: bigint[];
  is_approved: boolean;
  confidential_type: number;
};

type ResolvedSignerState = {
  signerNote: {
    index: bigint;
    siblings: bigint[];
    total_amount: bigint;
    nonce: bigint;
    timestamp: bigint;
    blinding: bigint;
  };
  signerRoot: bigint;
  stateBefore: SignerNoteState;
  signerBlinding: bigint;
  postState: SignerNoteState;
};

type DelegatedFixture = {
  shieldedTx: DelegatedShieldedTx;
  proofData: {
    proof: Uint8Array;
    publicInputs: string[];
  };
  publicInputs: {
    eip712DomainLo: string;
    eip712DomainHi: string;
    chainId: string;
    timestamp: string;
    shieldedRoot: string;
    wormholeRoot: string;
    signerRoot: string;
    hashedMessageHi: string;
    hashedMessageLo: string;
    signerCommitment: string;
    signerNullifier: string;
    wormholeNullifier: string;
    inputNullifiers: [string, string];
    outputCommitments: [string, string];
  };
  stateBefore: SignerNoteState;
  stateAfter: SignerNoteState;
};

function concatBytes(arrays: Uint8Array[]) {
  const result = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function bytes32(value: bigint) {
  return hexToBytes(toHex(value, { size: 32 }));
}

function splitHashWords(hash: Hex) {
  const hashBytes = hexToBytes(hash);
  return {
    hi: hashBytes.slice(0, 16),
    lo: hashBytes.slice(16, 32),
  };
}

function getShieldedPoolDomain(chainId: bigint, verifyingContract: Address) {
  return {
    name: "ShieldedPool",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

function getShieldedPoolDomainSeparator(chainId: bigint, verifyingContract: Address): Hex {
  return keccak256(
    concatBytes([
      hexToBytes(keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))),
      hexToBytes(keccak256(stringToHex("ShieldedPool"))),
      hexToBytes(keccak256(stringToHex("1"))),
      bytes32(chainId),
      bytes32(BigInt(verifyingContract)),
    ]),
  );
}

function getSignerDelegationTypehashBytes() {
  return [...hexToBytes(keccak256(stringToHex(SIGNER_DELEGATION_TYPE)))];
}

function getSignerDelegationHash(
  chainId: bigint,
  verifyingContract: Address,
  delegation: ParsedSignerDelegation,
): Hex {
  return hashTypedData({
    domain: getShieldedPoolDomain(chainId, verifyingContract),
    primaryType: "SignerDelegation",
    types: {
      SignerDelegation: [
        { name: "chainId", type: "uint64" },
        { name: "owner", type: "address" },
        { name: "delegate", type: "address" },
        { name: "startTime", type: "uint64" },
        { name: "endTime", type: "uint64" },
        { name: "token", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "amountType", type: "uint8" },
        { name: "maxCumulativeAmount", type: "uint64" },
        { name: "maxNonce", type: "uint64" },
        { name: "timeInterval", type: "uint64" },
        { name: "transferType", type: "uint8" },
      ],
    },
    message: delegation,
  });
}

function getSignerCommitment(
  delegateAddress: Address,
  ownerAddress: Address,
  delegationHash: Hex,
  signerNote: { total_amount: bigint; nonce: bigint; timestamp: bigint; blinding: bigint },
) {
  return poseidon2Hash([
    BigInt(delegateAddress),
    BigInt(ownerAddress),
    BigInt(delegationHash),
    signerNote.total_amount,
    signerNote.nonce,
    signerNote.timestamp,
    signerNote.blinding,
  ]);
}

function getSignerNullifier(
  delegateAddress: Address,
  ownerAddress: Address,
  delegationHash: Hex,
  signerNote: { nonce: bigint },
) {
  return poseidon2Hash([
    BigInt(delegateAddress),
    BigInt(ownerAddress),
    BigInt(delegationHash),
    signerNote.nonce,
  ]);
}

function getDelegatedPublicInputHashes(domainSeparator: Hex, messageHash: Hex) {
  const domainWords = splitHashWords(domainSeparator);
  const messageWords = splitHashWords(messageHash);

  return {
    eip712DomainHi: BigInt(bytesToHex(domainWords.hi)),
    eip712DomainLo: BigInt(bytesToHex(domainWords.lo)),
    hashedMessageHi: BigInt(bytesToHex(messageWords.hi)),
    hashedMessageLo: BigInt(bytesToHex(messageWords.lo)),
  };
}

function parseDelegation(delegation: MarketSignerDelegation): ParsedSignerDelegation {
  return {
    chainId: BigInt(delegation.chainId),
    owner: getAddress(delegation.owner),
    delegate: getAddress(delegation.delegate),
    startTime: BigInt(delegation.startTime),
    endTime: BigInt(delegation.endTime),
    token: getAddress(delegation.token),
    tokenId: BigInt(delegation.tokenId),
    amount: BigInt(delegation.amount),
    amountType: delegation.amountType,
    maxCumulativeAmount: BigInt(delegation.maxCumulativeAmount),
    maxNonce: BigInt(delegation.maxNonce),
    timeInterval: BigInt(delegation.timeInterval),
    transferType: delegation.transferType,
  };
}

function parseInputNotes(inputNotes: MarketInputNote[] | null | undefined): InputNote[] {
  return (inputNotes ?? []).map((note) => ({
    chain_id: BigInt(note.chain_id),
    blinding: BigInt(note.blinding),
    amount: BigInt(note.amount),
    branch_index: BigInt(note.branch_index),
    branch_siblings: note.branch_siblings.map((value) => BigInt(value)),
    branch_root: BigInt(note.branch_root),
    master_index: BigInt(note.master_index),
    master_siblings: note.master_siblings.map((value) => BigInt(value)),
  }));
}

function parseOutputNotes(outputNotes: MarketOutputNote[] | null | undefined): OutputNote[] {
  return (outputNotes ?? []).map((note) => ({
    chain_id: BigInt(note.chain_id),
    recipient: note.recipient.startsWith("0x") ? getAddress(note.recipient) : BigInt(note.recipient),
    blinding: BigInt(note.blinding),
    amount: BigInt(note.amount),
    transfer_type: note.transfer_type,
  }));
}

function parseWormholeNote(
  wormholeNote: MarketWormholeNote | null | undefined,
  delegation: ParsedSignerDelegation,
): DelegatedWormholeDeposit | undefined {
  if (!wormholeNote) {
    return undefined;
  }

  const payload = wormholeNote as MarketWormholeNotePayload;
  return {
    dst_chain_id: BigInt(payload.dst_chain_id),
    src_chain_id: BigInt(payload.src_chain_id),
    entry_id: BigInt(payload.entry_id),
    recipient: getAddress(payload.recipient),
    wormhole_secret: BigInt(payload.wormhole_secret),
    token: BigInt(delegation.token),
    token_id: delegation.tokenId,
    to: getAddress(payload.recipient),
    from: getAddress(payload.sender),
    amount: BigInt(payload.amount),
    master_root: BigInt(payload.master_root),
    branch_index: BigInt(payload.branch_index),
    branch_siblings: payload.branch_siblings.map((value) => BigInt(value)),
    branch_root: BigInt(payload.branch_root),
    master_index: BigInt(payload.master_index),
    master_siblings: payload.master_siblings.map((value) => BigInt(value)),
    is_approved: payload.is_approved,
    confidential_type: 0,
  };
}

function getRecipientHash(chainId: bigint, recipient: Address, blinding: bigint) {
  return poseidon2Hash([chainId, BigInt(recipient), blinding]);
}

function getOutputCommitment(token: bigint, tokenId: bigint, outputNote: OutputNote) {
  if ((outputNote.chain_id === 0n && outputNote.blinding === 0n) || outputNote.transfer_type === TransferType.WITHDRAWAL) {
    return BigInt(outputNote.recipient);
  }
  const recipient = typeof outputNote.recipient === "bigint" ? toHex(outputNote.recipient, { size: 20 }) : outputNote.recipient;
  return poseidon2Hash([getRecipientHash(outputNote.chain_id, recipient, outputNote.blinding), token, tokenId, outputNote.amount, BigInt(outputNote.transfer_type)]);
}

function getInputNullifier(chainId: bigint, branchRoot: bigint, ownerAddress: Address, token: bigint, tokenId: bigint, inputNote: InputNote) {
  const secretCommitment = poseidon2Hash([BigInt(ownerAddress), token, tokenId, inputNote.amount]);
  return poseidon2Hash([chainId, branchRoot, inputNote.branch_index, inputNote.blinding, secretCommitment]);
}

function getDelegatedWormholeNullifier(wormholeNote: DelegatedWormholeDeposit) {
  const secretCommitment = poseidon2Hash([BigInt(wormholeNote.recipient), wormholeNote.token, wormholeNote.token_id, BigInt(wormholeNote.from), wormholeNote.amount]);
  const idHash = poseidon2Hash([wormholeNote.src_chain_id, wormholeNote.entry_id]);
  return poseidon2Hash([1n, idHash, wormholeNote.wormhole_secret, secretCommitment]);
}

function getDelegatedWormholePseudoNullifier(chainId: bigint, address: Address, token: bigint, tokenId: bigint, secret: bigint) {
  const pseudoCommitment = poseidon2Hash([BigInt(address), token, tokenId, 0n, 0n]);
  return poseidon2Hash([1n, chainId, secret, pseudoCommitment]);
}

function sumInputAmount(inputNotes: InputNote[], wormholeNote?: DelegatedWormholeDeposit) {
  return inputNotes.reduce((total, note) => total + note.amount, 0n) + (wormholeNote?.amount ?? 0n);
}

function createOutputNotes(args: {
  srcChainId: bigint;
  dstChainId: bigint;
  sender: Address;
  receiver: Address;
  amount: bigint;
  totalAmountIn: bigint;
}) {
  if (args.totalAmountIn < args.amount) {
    throw new Error(`Insufficient input amount ${args.totalAmountIn} for output amount ${args.amount}`);
  }

  return createShieldedTransferOutputNotes({
    srcChainId: args.srcChainId,
    dstChainId: args.dstChainId,
    sender: args.sender,
    receiver: args.receiver,
    amount: args.amount,
    transferType: TransferType.TRANSFER,
    notes: {
      shielded: [
        {
          id: "synthetic",
          treeNumber: 0,
          leafIndex: 0,
          srcChainId: Number(args.srcChainId),
          dstChainId: Number(args.srcChainId),
          note: {
            account: args.sender,
            asset: args.sender,
            assetId: undefined,
            blinding: "0",
            amount: args.totalAmountIn.toString(),
            transferType: TransferType.TRANSFER,
          },
        },
      ],
    },
  });
}

function toCircuitInputNotes(inputNotes: InputNote[]) {
  return inputNotes.map((note) => ({
    chain_id: note.chain_id.toString(),
    blinding: note.blinding.toString(),
    amount: note.amount.toString(),
    branch_index: note.branch_index.toString(),
    branch_siblings: note.branch_siblings.map((sibling) => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.branch_siblings.length).fill("0")),
    branch_root: note.branch_root.toString(),
    master_index: note.master_index.toString(),
    master_siblings: note.master_siblings.map((sibling) => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.master_siblings.length).fill("0")),
  }));
}

function toCircuitOutputNotes(outputNotes: OutputNote[]) {
  return outputNotes.map((note) => ({
    chain_id: note.chain_id.toString(),
    recipient: typeof note.recipient === "bigint" ? note.recipient.toString() : note.recipient,
    blinding: note.blinding.toString(),
    amount: note.amount.toString(),
    transfer_type: note.transfer_type,
  }));
}

function toCircuitSignerNote(signerNote: ResolvedSignerState["signerNote"]) {
  return {
    index: signerNote.index.toString(),
    siblings: signerNote.siblings.map((sibling) => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - signerNote.siblings.length).fill("0")),
    total_amount: signerNote.total_amount.toString(),
    nonce: signerNote.nonce.toString(),
    timestamp: signerNote.timestamp.toString(),
    blinding: signerNote.blinding.toString(),
  };
}

function toCircuitSignerDelegation(delegation: ParsedSignerDelegation) {
  return {
    chainId: delegation.chainId.toString(),
    owner: delegation.owner,
    delegate: delegation.delegate,
    startTime: delegation.startTime.toString(),
    endTime: delegation.endTime.toString(),
    token: delegation.token,
    tokenId: delegation.tokenId.toString(),
    amount: delegation.amount.toString(),
    amountType: delegation.amountType,
    maxCumulativeAmount: delegation.maxCumulativeAmount.toString(),
    maxNonce: delegation.maxNonce.toString(),
    timeInterval: delegation.timeInterval.toString(),
    transferType: delegation.transferType,
  };
}

function emptyWormholeNote() {
  return {
    _is_some: false,
    _value: {
      dst_chain_id: "0",
      src_chain_id: "0",
      entry_id: "0",
      recipient: "0",
      wormhole_secret: "0",
      token: "0",
      token_id: "0",
      to: "0",
      from: "0",
      amount: "0",
      branch_index: "0",
      branch_siblings: Array(MERKLE_TREE_DEPTH).fill("0"),
      branch_root: "0",
      master_index: "0",
      master_siblings: Array(MERKLE_TREE_DEPTH).fill("0"),
      is_approved: false,
      confidential_type: 0,
    },
  };
}

function toCircuitWormholeNote(wormholeNote: DelegatedWormholeDeposit) {
  return {
    _is_some: true,
    _value: {
      dst_chain_id: wormholeNote.dst_chain_id.toString(),
      src_chain_id: wormholeNote.src_chain_id.toString(),
      entry_id: wormholeNote.entry_id.toString(),
      recipient: wormholeNote.recipient.toString(),
      wormhole_secret: wormholeNote.wormhole_secret.toString(),
      token: wormholeNote.token.toString(),
      token_id: wormholeNote.token_id.toString(),
      to: wormholeNote.to.toString(),
      from: wormholeNote.from.toString(),
      amount: wormholeNote.amount.toString(),
      branch_index: wormholeNote.branch_index.toString(),
      branch_siblings: wormholeNote.branch_siblings.map((sibling) => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - wormholeNote.branch_siblings.length).fill("0")),
      branch_root: wormholeNote.branch_root.toString(),
      master_index: wormholeNote.master_index.toString(),
      master_siblings: wormholeNote.master_siblings.map((sibling) => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - wormholeNote.master_siblings.length).fill("0")),
      is_approved: wormholeNote.is_approved,
      confidential_type: wormholeNote.confidential_type,
    },
  };
}

function getDelegatedShieldedTxHash(
  domain: ReturnType<typeof getShieldedPoolDomain>,
  shieldedTx: DelegatedShieldedTx,
) {
  return hashTypedData({
    domain,
    primaryType: "ShieldedTx",
    types: {
      Withdrawal: [
        { name: "to", type: "address" },
        { name: "asset", type: "address" },
        { name: "id", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "confidentialContext", type: "bytes32" },
      ],
      ShieldedTx: [
        { name: "chainId", type: "uint64" },
        { name: "wormholeRoot", type: "bytes32" },
        { name: "wormholeNullifier", type: "bytes32" },
        { name: "shieldedRoot", type: "bytes32" },
        { name: "signerRoot", type: "bytes32" },
        { name: "signerCommitment", type: "bytes32" },
        { name: "signerNullifier", type: "bytes32" },
        { name: "nullifiers", type: "bytes32[]" },
        { name: "commitments", type: "uint256[]" },
        { name: "withdrawals", type: "Withdrawal[]" },
      ],
    },
    message: shieldedTx as never,
  });
}

function extractDelegatedPublicInputs(result: string[]) {
  return {
    eip712DomainLo: result[0]!,
    eip712DomainHi: result[1]!,
    chainId: result[2]!,
    timestamp: result[3]!,
    shieldedRoot: result[4]!,
    wormholeRoot: result[5]!,
    signerRoot: result[6]!,
    hashedMessageHi: result[7]!,
    hashedMessageLo: result[8]!,
    signerCommitment: result[9]!,
    signerNullifier: result[10]!,
    wormholeNullifier: result[11]!,
    inputNullifiers: [result[12]!, result[13]!] as [string, string],
    outputCommitments: [result[14]!, result[15]!] as [string, string],
  };
}

function fieldHexToDecimal(field: string) {
  return BigInt(field).toString();
}

function fieldHexesToDecimals(fields: string[]) {
  return fields.map(fieldHexToDecimal);
}

function toSerializableSignerState(state: SignerNoteState): MarketSignerNoteStatePayload {
  return {
    totalAmount: state.totalAmount.toString(),
    nonce: state.nonce.toString(),
    timestamp: state.timestamp.toString(),
    blinding: state.blinding.toString(),
    commitment: state.commitment,
    signerRoot: state.signerRoot,
    txHash: state.txHash,
    blockNumber: state.blockNumber.toString(),
  };
}

function fromSerializableSignerState(state: MarketSignerNoteStatePayload): SignerNoteState {
  return {
    totalAmount: BigInt(state.totalAmount),
    nonce: BigInt(state.nonce),
    timestamp: BigInt(state.timestamp),
    blinding: BigInt(state.blinding),
    commitment: state.commitment,
    signerRoot: state.signerRoot,
    txHash: state.txHash,
    blockNumber: BigInt(state.blockNumber),
  };
}

function stringifyOutputNotes(outputNotes: OutputNote[]): MarketOutputNotePayload[] {
  return outputNotes.map((note) => ({
    chain_id: note.chain_id.toString(),
    recipient: typeof note.recipient === "bigint" ? note.recipient.toString() : note.recipient,
    blinding: note.blinding.toString(),
    amount: note.amount.toString(),
    transfer_type: note.transfer_type,
  }));
}

function toSerializableSignerNoteMembership(
  signerNote: ResolvedSignerState["signerNote"],
): MarketSignerNoteMembershipPayload {
  return {
    index: signerNote.index.toString(),
    siblings: signerNote.siblings.map((sibling) => sibling.toString()),
    total_amount: signerNote.total_amount.toString(),
    nonce: signerNote.nonce.toString(),
    timestamp: signerNote.timestamp.toString(),
    blinding: signerNote.blinding.toString(),
  };
}

function stringifyDelegatedShieldedTx(tx: DelegatedShieldedTx): DelegatedShieldedTxStringified {
  return {
    chainId: tx.chainId.toString(),
    wormholeRoot: tx.wormholeRoot,
    wormholeNullifier: tx.wormholeNullifier,
    shieldedRoot: tx.shieldedRoot,
    signerRoot: tx.signerRoot,
    signerCommitment: tx.signerCommitment,
    signerNullifier: tx.signerNullifier,
    nullifiers: tx.nullifiers,
    commitments: tx.commitments.map((commitment) => commitment.toString()),
    withdrawals: tx.withdrawals.map((withdrawal) => ({
      to: withdrawal.to,
      asset: withdrawal.asset,
      id: withdrawal.id.toString(),
      amount: withdrawal.amount.toString(),
      confidentialContext: withdrawal.confidentialContext,
    })),
  };
}

function parseDelegatedShieldedTxStringified(
  tx: DelegatedShieldedTxStringified,
): DelegatedShieldedTx {
  return {
    chainId: BigInt(tx.chainId),
    wormholeRoot: tx.wormholeRoot,
    wormholeNullifier: tx.wormholeNullifier,
    shieldedRoot: tx.shieldedRoot,
    signerRoot: tx.signerRoot,
    signerCommitment: tx.signerCommitment,
    signerNullifier: tx.signerNullifier,
    nullifiers: tx.nullifiers,
    commitments: tx.commitments.map((commitment) => BigInt(commitment)),
    withdrawals: tx.withdrawals.map((withdrawal) => ({
      to: withdrawal.to,
      asset: withdrawal.asset,
      id: BigInt(withdrawal.id),
      amount: BigInt(withdrawal.amount),
      confidentialContext: withdrawal.confidentialContext,
    })),
  };
}

function getMarketProofServiceUrl() {
  return process.env.MARKET_PROOF_SERVICE_URL ?? "http://127.0.0.1:4010";
}

function getProofTimestampForDelegation(delegation: ParsedSignerDelegation) {
  if (delegation.endTime <= delegation.startTime) {
    throw new Error("Invalid delegation time range");
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < delegation.startTime) {
    return delegation.startTime;
  }
  if (now >= delegation.endTime) {
    return delegation.endTime - 1n;
  }
  return now;
}

async function resolveSignerState(args: {
  orderId: string;
  role: "maker" | "fulfiller";
  chainId: number;
  branchAddress: Address;
  delegation: ParsedSignerDelegation;
  amountSent: bigint;
  currentTimestamp: bigint;
}) : Promise<ResolvedSignerState> {
  const previousStatePayload = await findLatestSignerStateForDelegation({
    role: args.role,
    delegation: {
      chainId: args.delegation.chainId.toString(),
      owner: args.delegation.owner,
      delegate: args.delegation.delegate,
      startTime: args.delegation.startTime.toString(),
      endTime: args.delegation.endTime.toString(),
      token: args.delegation.token,
      tokenId: args.delegation.tokenId.toString(),
      amount: args.delegation.amount.toString(),
      amountType: args.delegation.amountType,
      maxCumulativeAmount: args.delegation.maxCumulativeAmount.toString(),
      maxNonce: args.delegation.maxNonce.toString(),
      timeInterval: args.delegation.timeInterval.toString(),
      transferType: args.delegation.transferType,
    },
    excludeOrderId: args.orderId,
  });

  const signerBlinding = getRandomBlinding();

  if (!previousStatePayload) {
    const initialState: SignerNoteState = {
      totalAmount: 0n,
      nonce: 0n,
      timestamp: 0n,
      blinding: 0n,
      commitment: ZERO_32,
      signerRoot: ZERO_32,
      txHash: ZERO_32,
      blockNumber: 0n,
    };
    const postState: SignerNoteState = {
      totalAmount: args.amountSent,
      nonce: 1n,
      timestamp: args.currentTimestamp,
      blinding: signerBlinding,
      commitment: ZERO_32,
      signerRoot: ZERO_32,
      txHash: ZERO_32,
      blockNumber: 0n,
    };
    return {
      signerNote: {
        index: 0n,
        siblings: [],
        total_amount: 0n,
        nonce: 0n,
        timestamp: 0n,
        blinding: 0n,
      },
      signerRoot: 0n,
      stateBefore: initialState,
      signerBlinding,
      postState,
    };
  }

  const previousState = fromSerializableSignerState(previousStatePayload);
  const signerEvents = await queryBranchShieldedTransferSigners({
    chainId: args.chainId,
    branchAddress: args.branchAddress,
    blockNumber_lte: previousState.blockNumber,
  });
  const orderedEvents = signerEvents
    .slice()
    .sort((a, b) => {
      const blockDiff = BigInt(a.blockNumber) - BigInt(b.blockNumber);
      if (blockDiff !== 0n) {
        return blockDiff < 0n ? -1 : 1;
      }
      const treeDiff = BigInt(a.treeId) - BigInt(b.treeId);
      if (treeDiff !== 0n) {
        return treeDiff < 0n ? -1 : 1;
      }
      const startIndexDiff = BigInt(a.startIndex) - BigInt(b.startIndex);
      if (startIndexDiff !== 0n) {
        return startIndexDiff < 0n ? -1 : 1;
      }
      return a.transactionHash.localeCompare(b.transactionHash);
    });
  const exactIndex = orderedEvents.findIndex((event) =>
    event.transactionHash.toLowerCase() === previousState.txHash.toLowerCase()
    && event.signerCommitment.toLowerCase() === previousState.commitment.toLowerCase()
  );
  const matchedIndex = exactIndex;
  if (matchedIndex === -1) {
    throw new Error(`Unable to reconstruct prior ${args.role} signer state from signer event history`);
  }

  const signerLeaves = orderedEvents
    .slice(0, matchedIndex + 1)
    .map((event) => BigInt(event.signerCommitment));
  const signerTree = getMerkleTree(signerLeaves);
  const signerProof = signerTree.generateProof(matchedIndex);
  const postState: SignerNoteState = {
    totalAmount: previousState.totalAmount + args.amountSent,
    nonce: previousState.nonce + 1n,
    timestamp: args.currentTimestamp,
    blinding: signerBlinding,
    commitment: ZERO_32,
    signerRoot: toHex(signerTree.root, { size: 32 }),
    txHash: ZERO_32,
    blockNumber: 0n,
  };

  return {
    signerNote: {
      index: BigInt(signerProof.index),
      siblings: signerProof.siblings,
      total_amount: previousState.totalAmount,
      nonce: previousState.nonce,
      timestamp: previousState.timestamp,
      blinding: previousState.blinding,
    },
    signerRoot: signerTree.root,
    stateBefore: previousState,
    signerBlinding,
    postState,
  };
}

function buildDelegatedShieldedTx(args: {
  chainId: bigint;
  sender: Address;
  token: Address;
  tokenId: bigint;
  shieldedRoot: bigint;
  wormholeRoot: bigint;
  wormholeDeposit?: DelegatedWormholeDeposit;
  wormholePseudoSecret?: bigint;
  inputs: InputNote[];
  outputs: OutputNote[];
  signerRoot: bigint;
  signerCommitment: bigint;
  signerNullifier: bigint;
}): DelegatedShieldedTx {
  const token = BigInt(args.token);
  const wormholeNullifier = args.wormholeDeposit
    ? toHex(getDelegatedWormholeNullifier(args.wormholeDeposit), { size: 32 })
    : toHex(getDelegatedWormholePseudoNullifier(args.chainId, args.sender, token, args.tokenId, args.wormholePseudoSecret ?? 0n), { size: 32 });
  const withdrawals = args.outputs
    .filter((output) => output.transfer_type === TransferType.WITHDRAWAL)
    .map((output) => ({
      to: typeof output.recipient === "bigint" ? toHex(output.recipient, { size: 20 }) : output.recipient,
      asset: args.token,
      id: args.tokenId,
      amount: output.amount,
      confidentialContext: ZERO_32,
    })) satisfies Withdrawal[];

  return {
    chainId: args.chainId,
    wormholeRoot: toHex(args.wormholeRoot, { size: 32 }),
    wormholeNullifier,
    shieldedRoot: toHex(args.shieldedRoot, { size: 32 }),
    signerRoot: toHex(args.signerRoot, { size: 32 }),
    signerCommitment: toHex(args.signerCommitment, { size: 32 }),
    signerNullifier: toHex(args.signerNullifier, { size: 32 }),
    nullifiers: args.inputs.map((input) => toHex(getInputNullifier(args.chainId, input.branch_root, args.sender, token, args.tokenId, input), { size: 32 })),
    commitments: args.outputs
      .filter((output) => output.transfer_type === TransferType.TRANSFER)
      .map((output) => getOutputCommitment(token, args.tokenId, output)),
    withdrawals,
  };
}

function getAmountSentToCounterparty(owner: Address, outputNotes: OutputNote[]) {
  return outputNotes.reduce((total, note) => {
    const recipient = typeof note.recipient === "bigint" ? toHex(note.recipient, { size: 20 }) : note.recipient;
    return recipient.toLowerCase() === owner.toLowerCase() ? total : total + note.amount;
  }, 0n);
}

async function prepareProofFixtureRequest(args: {
  orderId: string;
  role: "maker" | "fulfiller";
  chainId: number;
  verifyingContract: Address;
  delegation: ParsedSignerDelegation;
  delegationSignature: Hex;
  inputNotes: InputNote[];
  outputNotes: OutputNote[];
  wormholeDeposit?: DelegatedWormholeDeposit;
  shieldedRoot: bigint;
  sender: Address;
}): Promise<MarketFulfillmentProofFixtureRequest> {
  const timestamp = getProofTimestampForDelegation(args.delegation);
  const signerState = await resolveSignerState({
    orderId: args.orderId,
    role: args.role,
    chainId: args.chainId,
    branchAddress: args.verifyingContract,
    delegation: args.delegation,
    amountSent: getAmountSentToCounterparty(args.delegation.owner, args.outputNotes),
    currentTimestamp: timestamp,
  });

  return {
    role: args.role,
    chainId: args.chainId,
    verifyingContract: args.verifyingContract,
    sender: args.sender,
    delegation: {
      chainId: args.delegation.chainId.toString(),
      owner: args.delegation.owner,
      delegate: args.delegation.delegate,
      startTime: args.delegation.startTime.toString(),
      endTime: args.delegation.endTime.toString(),
      token: args.delegation.token,
      tokenId: args.delegation.tokenId.toString(),
      amount: args.delegation.amount.toString(),
      amountType: args.delegation.amountType,
      maxCumulativeAmount: args.delegation.maxCumulativeAmount.toString(),
      maxNonce: args.delegation.maxNonce.toString(),
      timeInterval: args.delegation.timeInterval.toString(),
      transferType: args.delegation.transferType,
    },
    delegationSignature: args.delegationSignature,
    inputNotes: args.inputNotes.map((note) => ({
      chain_id: note.chain_id.toString(),
      blinding: note.blinding.toString(),
      amount: note.amount.toString(),
      branch_index: note.branch_index.toString(),
      branch_siblings: note.branch_siblings.map((sibling) => sibling.toString()),
      branch_root: note.branch_root.toString(),
      master_index: note.master_index.toString(),
      master_siblings: note.master_siblings.map((sibling) => sibling.toString()),
    })),
    outputNotes: stringifyOutputNotes(args.outputNotes),
    wormholeNote: args.wormholeDeposit
      ? {
          dst_chain_id: args.wormholeDeposit.dst_chain_id.toString(),
          src_chain_id: args.wormholeDeposit.src_chain_id.toString(),
          entry_id: args.wormholeDeposit.entry_id.toString(),
          recipient: args.wormholeDeposit.recipient,
          wormhole_secret: args.wormholeDeposit.wormhole_secret.toString(),
          asset_id: args.wormholeDeposit.token.toString(),
          sender: args.wormholeDeposit.from,
          amount: args.wormholeDeposit.amount.toString(),
          master_root: args.wormholeDeposit.master_root.toString(),
          branch_root: args.wormholeDeposit.branch_root.toString(),
          branch_index: args.wormholeDeposit.branch_index.toString(),
          branch_siblings: args.wormholeDeposit.branch_siblings.map((sibling) => sibling.toString()),
          master_index: args.wormholeDeposit.master_index.toString(),
          master_siblings: args.wormholeDeposit.master_siblings.map((sibling) => sibling.toString()),
          is_approved: args.wormholeDeposit.is_approved,
        }
      : null,
    shieldedRoot: args.shieldedRoot.toString(),
    timestamp: timestamp.toString(),
    signerRoot: signerState.signerRoot.toString(),
    signerBlinding: signerState.signerBlinding.toString(),
    signerNote: toSerializableSignerNoteMembership(signerState.signerNote),
    stateBefore: toSerializableSignerState(signerState.stateBefore),
    stateAfter: toSerializableSignerState(signerState.postState),
  };
}

async function requestMarketFulfillmentProofs(
  request: MarketFulfillmentProofServiceRequest,
): Promise<MarketFulfillmentProofServiceResponse> {
  const response = await fetch(`${getMarketProofServiceUrl()}/market-fulfill/prove`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => null) as
    | MarketFulfillmentProofServiceResponse
    | { error?: string }
    | null;

  if (!response.ok || !body || !("proof" in body)) {
    throw new Error(
      (body && "error" in body && typeof body.error === "string")
        ? body.error
        : "Proof service request failed",
    );
  }

  return body;
}

function requireBundle(bundle: {
  signerDelegation: MarketSignerDelegation | null;
  signature: string | null;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes?: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
}, label: string) {
  if (!bundle.signerDelegation) {
    throw new Error(`Missing ${label} signer delegation`);
  }
  if (!bundle.signature) {
    throw new Error(`Missing ${label} delegation signature`);
  }
  const hasInputNotes = Boolean(bundle.inputNotes && bundle.inputNotes.some(note => BigInt(note.amount) > 0n));
  const hasWormholeNote = Boolean(bundle.wormholeNote);
  if (!hasInputNotes && !hasWormholeNote) {
    throw new Error(`Missing ${label} input notes or wormhole note`);
  }
  if (hasInputNotes && !bundle.shieldedMasterRoot && !inferShieldedMasterRootFromInputNotes(bundle.inputNotes)) {
    throw new Error(`Missing ${label} shielded root`);
  }
}

function resolveShieldedRoot(bundle: {
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
}) {
  return bundle.shieldedMasterRoot
    ?? inferShieldedMasterRootFromInputNotes(bundle.inputNotes)
    ?? "0";
}

export async function executeMarketFulfillment(args: {
  orderId: string;
  existing: MarketOfferRequestRecord;
  fulfillerDelegation: MarketSignerDelegation;
  fulfillerSignature: string;
  fulfillerNotes: MarketRequestNotes;
}) : Promise<{
  txHash: Hex;
  execution: MarketFulfillmentExecutionPayload;
  completionInput: Omit<CompleteMarketFulfillmentInput, "id">;
}> {
  requireBundle({
    signerDelegation: args.existing.signerDelegation,
    signature: args.existing.signature,
    shieldedMasterRoot: args.existing.shieldedMasterRoot,
    inputNotes: args.existing.inputNotes,
    wormholeNote: args.existing.wormholeNote,
  }, "maker");
  requireBundle({
    signerDelegation: args.fulfillerDelegation,
    signature: args.fulfillerSignature,
    shieldedMasterRoot: args.fulfillerNotes.shieldedMasterRoot,
    inputNotes: args.fulfillerNotes.inputNotes,
    outputNotes: args.fulfillerNotes.outputNotes,
    wormholeNote: args.fulfillerNotes.wormholeNote,
  }, "fulfiller");
  if (!args.fulfillerNotes.outputNotes || args.fulfillerNotes.outputNotes.length === 0) {
    throw new Error("Missing fulfiller output notes");
  }

  const makerDelegation = parseDelegation(args.existing.signerDelegation!);
  const fulfillerDelegation = parseDelegation(args.fulfillerDelegation);
  if (makerDelegation.chainId !== fulfillerDelegation.chainId) {
    throw new Error("Batch delegated fulfillment requires maker and fulfiller proofs on the same chain");
  }

  const chainId = Number(makerDelegation.chainId);
  const verifyingContract = getAddress(getChainConfig(chainId).branchContractAddress);
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPrivateKey) {
    throw new Error("RELAYER_PRIVATE_KEY not configured");
  }
  const relayer = privateKeyToAccount(relayerPrivateKey);
  if (makerDelegation.delegate.toLowerCase() !== relayer.address.toLowerCase()) {
    throw new Error("Maker delegation delegate does not match relayer address");
  }
  if (fulfillerDelegation.delegate.toLowerCase() !== relayer.address.toLowerCase()) {
    throw new Error("Fulfiller delegation delegate does not match relayer address");
  }

  const makerInputNotes = parseInputNotes(args.existing.inputNotes);
  const makerWormholeNote = parseWormholeNote(args.existing.wormholeNote, makerDelegation);
  const fulfillerInputNotes = parseInputNotes(args.fulfillerNotes.inputNotes);
  const fulfillerWormholeNote = parseWormholeNote(args.fulfillerNotes.wormholeNote, fulfillerDelegation);
  const makerShieldedRoot = resolveShieldedRoot({
    shieldedMasterRoot: args.existing.shieldedMasterRoot,
    inputNotes: args.existing.inputNotes,
  });
  const fulfillerShieldedRoot = resolveShieldedRoot({
    shieldedMasterRoot: args.fulfillerNotes.shieldedMasterRoot,
    inputNotes: args.fulfillerNotes.inputNotes,
  });

  const makerOutputNotes = createOutputNotes({
    srcChainId: makerDelegation.chainId,
    dstChainId: BigInt(args.existing.offer.for.dstChainId),
    sender: makerDelegation.owner,
    receiver: fulfillerDelegation.owner,
    amount: makerDelegation.amount,
    totalAmountIn: sumInputAmount(makerInputNotes, makerWormholeNote),
  });
  const fulfillerOutputNotes = parseOutputNotes(args.fulfillerNotes.outputNotes);

  const proofRequest: MarketFulfillmentProofServiceRequest = {
    fixtures: await Promise.all([
      prepareProofFixtureRequest({
        orderId: args.orderId,
        role: "maker",
        chainId,
        verifyingContract,
        delegation: makerDelegation,
        delegationSignature: args.existing.signature as Hex,
        inputNotes: makerInputNotes,
        outputNotes: makerOutputNotes,
        wormholeDeposit: makerWormholeNote,
        shieldedRoot: BigInt(makerShieldedRoot),
        sender: makerDelegation.owner,
      }),
      prepareProofFixtureRequest({
        orderId: args.orderId,
        role: "fulfiller",
        chainId,
        verifyingContract,
        delegation: fulfillerDelegation,
        delegationSignature: args.fulfillerSignature as Hex,
        inputNotes: fulfillerInputNotes,
        outputNotes: fulfillerOutputNotes,
        wormholeDeposit: fulfillerWormholeNote,
        shieldedRoot: BigInt(fulfillerShieldedRoot),
        sender: fulfillerDelegation.owner,
      }),
    ]),
  };

  const proofResponse = await requestMarketFulfillmentProofs(proofRequest);
  const [makerProofFixture, fulfillerProofFixture] = proofResponse.fixtures;
  if (makerProofFixture.role !== "maker" || fulfillerProofFixture.role !== "fulfiller") {
    throw new Error("Proof service returned fixtures in an unexpected order");
  }
  const makerShieldedTx = parseDelegatedShieldedTxStringified(makerProofFixture.shieldedTx);
  const fulfillerShieldedTx = parseDelegatedShieldedTxStringified(fulfillerProofFixture.shieldedTx);

  const walletClient = createWalletClient({
    account: relayer,
    chain: getChainConfig(chainId).chain,
    transport: http(getChainConfig(chainId).rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: getChainConfig(chainId).chain,
    transport: http(getChainConfig(chainId).rpcUrl),
  });
  const txHash = await (walletClient as any).writeContract({
    address: verifyingContract,
    abi: parseAbi([
      "struct Withdrawal { address to; address asset; uint256 id; uint256 amount; bytes32 confidentialContext; }",
      "struct ShieldedTx { uint64 chainId; bytes32 wormholeRoot; bytes32 wormholeNullifier; bytes32 shieldedRoot; bytes32 signerRoot; bytes32 signerCommitment; bytes32 signerNullifier; bytes32[] nullifiers; uint256[] commitments; Withdrawal[] withdrawals; }",
      "function batchShieldedTransfers(ShieldedTx[] memory shieldedTxs, bytes calldata proof) external",
    ]),
    functionName: "batchShieldedTransfers",
    args: [[makerShieldedTx, fulfillerShieldedTx], proofResponse.proof],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  const makerStateAfter = fromSerializableSignerState(makerProofFixture.stateAfter);
  makerStateAfter.txHash = txHash;
  makerStateAfter.blockNumber = receipt.blockNumber;
  makerStateAfter.signerRoot = makerShieldedTx.signerCommitment;
  const fulfillerStateAfter = fromSerializableSignerState(fulfillerProofFixture.stateAfter);
  fulfillerStateAfter.txHash = txHash;
  fulfillerStateAfter.blockNumber = receipt.blockNumber;
  fulfillerStateAfter.signerRoot = fulfillerShieldedTx.signerCommitment;

  const execution: MarketFulfillmentExecutionPayload = {
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    makerSignerStateBefore: makerProofFixture.stateBefore,
    makerSignerStateAfter: toSerializableSignerState(makerStateAfter),
    fulfillerSignerStateBefore: fulfillerProofFixture.stateBefore,
    fulfillerSignerStateAfter: toSerializableSignerState(fulfillerStateAfter),
  };

  return {
    txHash,
    execution,
    completionInput: {
      makerOutputNotes: stringifyOutputNotes(makerOutputNotes),
      signerDelegation: args.fulfillerDelegation,
      signature: args.fulfillerSignature,
      shieldedMasterRoot: args.fulfillerNotes.shieldedMasterRoot,
      inputNotes: args.fulfillerNotes.inputNotes,
      outputNotes: args.fulfillerNotes.outputNotes,
      wormholeNote: args.fulfillerNotes.wormholeNote,
      execution,
    },
  };
}

export const __test__ = {
  getShieldedPoolDomain,
  getShieldedPoolDomainSeparator,
  getSignerDelegationHash,
  getSignerDelegationTypehashBytes,
  getSignerCommitment,
  getSignerNullifier,
  getDelegatedPublicInputHashes,
  getOutputCommitment,
  getInputNullifier,
  getDelegatedWormholeNullifier,
  getDelegatedWormholePseudoNullifier,
  getDelegatedShieldedTxHash,
  buildDelegatedShieldedTx,
  extractDelegatedPublicInputs,
  toCircuitInputNotes,
  toCircuitOutputNotes,
  toCircuitSignerDelegation,
  toCircuitSignerNote,
  emptyWormholeNote,
  toCircuitWormholeNote,
  fieldHexToDecimal,
  fieldHexesToDecimals,
};
