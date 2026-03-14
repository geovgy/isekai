import { randomBytes } from "node:crypto";
import { deflattenFields } from "@aztec/bb.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import {
  bytesToHex,
  getAddress,
  hashTypedData,
  hexToBytes,
  keccak256,
  recoverPublicKey,
  stringToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Prover } from "../../../circuits/src/prover";
import {
  TransferType,
  type DelegatedShieldedTx,
  type DelegatedShieldedTxStringified,
  type InputNote,
  type MarketFulfillmentProofFixtureRequest,
  type MarketFulfillmentProofFixtureResponse,
  type MarketFulfillmentProofServiceRequest,
  type MarketFulfillmentProofServiceResponse,
  type MarketOutputNotePayload,
  type MarketSignerDelegationPayload,
  type MarketSignerNoteMembershipPayload,
  type MarketSignerNoteStatePayload,
  type MarketWormholeNotePayload,
  type OutputNote,
  type Withdrawal,
} from "../../../webapp/src/types";

const RECURSIVE_INNER_TARGET = "noir-recursive-no-zk" as const;
const OUTER_TARGET = "evm" as const;
const ZERO_32 = toHex(0n, { size: 32 });
const MERKLE_TREE_DEPTH = 20;
const SIGNER_DELEGATION_TYPE =
  "SignerDelegation(uint64 chainId,address owner,address delegate,address recipient,bool recipientLocked,uint64 startTime,uint64 endTime,address token,uint256 tokenId,uint256 amount,uint8 amountType,uint64 maxCumulativeAmount,uint64 maxNonce,uint64 timeInterval,uint8 transferType)";

function getRandomField() {
  return BigInt(`0x${randomBytes(31).toString("hex")}`);
}

type ParsedSignerDelegation = {
  chainId: bigint;
  owner: Address;
  delegate: Address;
  recipient: Address;
  recipientLocked: boolean;
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

type SerializableSignerNote = {
  index: bigint;
  siblings: bigint[];
  total_amount: bigint;
  nonce: bigint;
  timestamp: bigint;
  blinding: bigint;
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
  role: "maker" | "fulfiller";
};

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function isProofRequest(value: unknown): value is MarketFulfillmentProofServiceRequest {
  return typeof value === "object" && value !== null
    && "fixtures" in value
    && Array.isArray((value as { fixtures?: unknown }).fixtures)
    && (value as { fixtures: unknown[] }).fixtures.length === 2;
}

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
        { name: "recipient", type: "address" },
        { name: "recipientLocked", type: "bool" },
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

function parseDelegation(delegation: MarketSignerDelegationPayload): ParsedSignerDelegation {
  return {
    chainId: BigInt(delegation.chainId),
    owner: getAddress(delegation.owner),
    delegate: getAddress(delegation.delegate),
    recipient: typeof delegation.recipient === "string" ? getAddress(delegation.recipient) : zeroAddress,
    recipientLocked: delegation.recipientLocked === true,
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

function parseInputNotes(inputNotes: MarketFulfillmentProofFixtureRequest["inputNotes"]): InputNote[] {
  return inputNotes.map((note) => ({
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

function normalizeInputNotes(
  inputNotes: InputNote[],
  fallbackChainId: bigint,
): [InputNote, InputNote] {
  const normalized = inputNotes.slice(0, 2);

  while (normalized.length < 2) {
    const template = normalized[0];
    normalized.push({
      chain_id: template?.chain_id ?? fallbackChainId,
      blinding: getRandomField(),
      amount: 0n,
      branch_index: 0n,
      branch_siblings: template?.branch_siblings ?? Array(MERKLE_TREE_DEPTH).fill(0n),
      branch_root: template?.branch_root ?? 0n,
      master_index: template?.master_index ?? 0n,
      master_siblings: template?.master_siblings ?? Array(MERKLE_TREE_DEPTH).fill(0n),
    });
  }

  return normalized as [InputNote, InputNote];
}

function parseOutputNotes(outputNotes: MarketOutputNotePayload[]): OutputNote[] {
  return outputNotes.map((note) => ({
    chain_id: BigInt(note.chain_id),
    recipient: note.recipient.startsWith("0x") ? getAddress(note.recipient) : BigInt(note.recipient),
    blinding: BigInt(note.blinding),
    amount: BigInt(note.amount),
    transfer_type: note.transfer_type,
  }));
}

function parseWormholeNote(
  wormholeNote: MarketWormholeNotePayload | null,
  delegation: ParsedSignerDelegation,
): DelegatedWormholeDeposit | undefined {
  if (!wormholeNote) {
    return undefined;
  }
  return {
    dst_chain_id: BigInt(wormholeNote.dst_chain_id),
    src_chain_id: BigInt(wormholeNote.src_chain_id),
    entry_id: BigInt(wormholeNote.entry_id),
    recipient: getAddress(wormholeNote.recipient),
    wormhole_secret: BigInt(wormholeNote.wormhole_secret),
    token: BigInt(delegation.token),
    token_id: delegation.tokenId,
    to: getAddress(wormholeNote.recipient),
    from: getAddress(wormholeNote.sender),
    amount: BigInt(wormholeNote.amount),
    master_root: BigInt(wormholeNote.master_root),
    branch_index: BigInt(wormholeNote.branch_index),
    branch_siblings: wormholeNote.branch_siblings.map((value) => BigInt(value)),
    branch_root: BigInt(wormholeNote.branch_root),
    master_index: BigInt(wormholeNote.master_index),
    master_siblings: wormholeNote.master_siblings.map((value) => BigInt(value)),
    is_approved: wormholeNote.is_approved,
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
  return poseidon2Hash([
    getRecipientHash(outputNote.chain_id, recipient, outputNote.blinding),
    token,
    tokenId,
    outputNote.amount,
    BigInt(outputNote.transfer_type),
  ]);
}

function getInputNullifier(chainId: bigint, branchRoot: bigint, owner: Address, token: bigint, tokenId: bigint, note: InputNote) {
  const secretCommitment = poseidon2Hash([BigInt(owner), token, tokenId, note.amount]);
  return poseidon2Hash([chainId, branchRoot, note.branch_index, note.blinding, secretCommitment]);
}

function getDelegatedWormholeNullifier(deposit: DelegatedWormholeDeposit) {
  const secretCommitment = poseidon2Hash([BigInt(deposit.to), deposit.token, deposit.token_id, deposit.amount]);
  return poseidon2Hash([deposit.src_chain_id, deposit.entry_id, deposit.wormhole_secret, secretCommitment]);
}

function getDelegatedWormholePseudoNullifier(
  chainId: bigint,
  owner: Address,
  token: bigint,
  tokenId: bigint,
  secret: bigint,
) {
  const pseudoCommitment = poseidon2Hash([BigInt(owner), token, tokenId, 0n, 0n]);
  return poseidon2Hash([1n, chainId, secret, pseudoCommitment]);
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
    recipient: typeof note.recipient === "bigint" ? note.recipient.toString() : BigInt(note.recipient).toString(),
    blinding: note.blinding.toString(),
    amount: note.amount.toString(),
    transfer_type: note.transfer_type,
  }));
}

function toCircuitSignerNote(signerNote: SerializableSignerNote) {
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
    recipient: delegation.recipient,
    recipientLocked: delegation.recipientLocked,
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
      recipient: BigInt(wormholeNote.recipient).toString(),
      wormhole_secret: wormholeNote.wormhole_secret.toString(),
      token: wormholeNote.token.toString(),
      token_id: wormholeNote.token_id.toString(),
      to: BigInt(wormholeNote.to).toString(),
      from: BigInt(wormholeNote.from).toString(),
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
  const typedDataMessage = {
    ...shieldedTx,
    withdrawals: shieldedTx.withdrawals.map((withdrawal) => ({
      ...withdrawal,
      confidentialContext: withdrawal.confidentialContext ?? ZERO_32,
    })),
  };

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
    message: typedDataMessage,
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

function parseSerializableSignerNote(signerNote: MarketSignerNoteMembershipPayload): SerializableSignerNote {
  return {
    index: BigInt(signerNote.index),
    siblings: signerNote.siblings.map((sibling) => BigInt(sibling)),
    total_amount: BigInt(signerNote.total_amount),
    nonce: BigInt(signerNote.nonce),
    timestamp: BigInt(signerNote.timestamp),
    blinding: BigInt(signerNote.blinding),
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

async function buildFixture(
  request: MarketFulfillmentProofFixtureRequest,
  relayerPrivateKey: Hex,
): Promise<DelegatedFixture> {
  const relayer = privateKeyToAccount(relayerPrivateKey);
  const delegation = parseDelegation(request.delegation);
  const inputNotes = normalizeInputNotes(
    parseInputNotes(request.inputNotes),
    BigInt(request.chainId),
  );
  const outputNotes = parseOutputNotes(request.outputNotes);
  const wormholeDeposit = parseWormholeNote(request.wormholeNote, delegation);
  const signerNote = parseSerializableSignerNote(request.signerNote);
  const signerStateBefore = fromSerializableSignerState(request.stateBefore);
  const signerStateAfter = fromSerializableSignerState(request.stateAfter);
  const delegationHash = getSignerDelegationHash(BigInt(request.chainId), request.verifyingContract, delegation);
  const signerNullifier = getSignerNullifier(delegation.delegate, delegation.owner, delegationHash, {
    nonce: signerNote.nonce,
  });
  const nextSignerCommitment = getSignerCommitment(delegation.delegate, delegation.owner, delegationHash, {
    total_amount: signerNote.total_amount + (signerStateAfter.totalAmount - signerStateBefore.totalAmount),
    nonce: signerNote.nonce + 1n,
    timestamp: BigInt(request.timestamp),
    blinding: BigInt(request.signerBlinding),
  });
  const wormholePseudoSecret = wormholeDeposit ? undefined : getRandomField();
  const shieldedTx = buildDelegatedShieldedTx({
    chainId: BigInt(request.chainId),
    sender: request.sender,
    token: delegation.token,
    tokenId: delegation.tokenId,
    shieldedRoot: BigInt(request.shieldedRoot),
    wormholeRoot: wormholeDeposit?.master_root ?? 0n,
    wormholeDeposit,
    wormholePseudoSecret,
    inputs: inputNotes,
    outputs: outputNotes,
    signerRoot: BigInt(request.signerRoot),
    signerCommitment: nextSignerCommitment,
    signerNullifier,
  });
  const messageHash = getDelegatedShieldedTxHash(
    getShieldedPoolDomain(BigInt(request.chainId), request.verifyingContract),
    shieldedTx,
  );
  const relayerSignature = await relayer.sign({ hash: messageHash });
  const relayerPublicKey = await recoverPublicKey({ hash: messageHash, signature: relayerSignature });
  const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: request.delegationSignature });
  const publicHashes = getDelegatedPublicInputHashes(
    getShieldedPoolDomainSeparator(BigInt(request.chainId), request.verifyingContract),
    messageHash,
  );

  const prover = new Prover("delegated_utxo_2x2");
  await prover.init();
  const { witness } = await prover.noir.execute({
    eip712_domain_lo: publicHashes.eip712DomainLo.toString(),
    eip712_domain_hi: publicHashes.eip712DomainHi.toString(),
    pub_key_x: [...hexToBytes(relayerPublicKey).slice(1, 33)],
    pub_key_y: [...hexToBytes(relayerPublicKey).slice(33, 65)],
    signature: [...hexToBytes(relayerSignature).slice(0, 64)],
    hashed_message: [...hexToBytes(messageHash)],
    chain_id: request.chainId.toString(),
    timestamp: request.timestamp,
    shielded_root: request.shieldedRoot,
    wormhole_root: (wormholeDeposit?.master_root ?? 0n).toString(),
    signer_root: request.signerRoot,
    signer_note: toCircuitSignerNote(signerNote),
    signer_blinding: request.signerBlinding,
    delegation_typehash: getSignerDelegationTypehashBytes(),
    delegation: toCircuitSignerDelegation(delegation),
    owner_pub_key_x: [...hexToBytes(ownerPublicKey).slice(1, 33)],
    owner_pub_key_y: [...hexToBytes(ownerPublicKey).slice(33, 65)],
    delegation_signature: [...hexToBytes(request.delegationSignature).slice(0, 64)],
    token: BigInt(delegation.token).toString(),
    token_id: delegation.tokenId.toString(),
    input_notes: toCircuitInputNotes(inputNotes),
    output_notes: toCircuitOutputNotes(outputNotes),
    wormhole_notes: [wormholeDeposit ? toCircuitWormholeNote(wormholeDeposit) : emptyWormholeNote()],
    wormhole_pseudo_secrets: [
      wormholeDeposit
        ? { _is_some: false, _value: "0" }
        : { _is_some: true, _value: wormholePseudoSecret!.toString() },
    ],
  });
  const proofData = await prover.backend.generateProof(witness, { verifierTarget: RECURSIVE_INNER_TARGET } as never);
  const publicInputs = extractDelegatedPublicInputs(proofData.publicInputs);
  signerStateAfter.commitment = publicInputs.signerCommitment as Hex;
  signerStateAfter.signerRoot = toHex(BigInt(request.signerRoot), { size: 32 });

  return {
    role: request.role,
    shieldedTx,
    proofData: {
      proof: proofData.proof,
      publicInputs: proofData.publicInputs,
    },
    publicInputs,
    stateBefore: signerStateBefore,
    stateAfter: signerStateAfter,
  };
}

async function proveBatch(fixtures: [DelegatedFixture, DelegatedFixture]) {
  const innerProver = new Prover("delegated_utxo_2x2");
  const outerProver = new Prover("batch_delegated_utxo_2x2");
  await Promise.all([innerProver.init(), outerProver.init()]);
  const recursiveArtifacts = await innerProver.backend.generateRecursiveProofArtifacts(
    fixtures[0].proofData.proof,
    fixtures[0].proofData.publicInputs.length,
    { verifierTarget: RECURSIVE_INNER_TARGET } as never,
  );
  const proofs = fixtures.map((fixture) => fieldHexesToDecimals(deflattenFields(fixture.proofData.proof)));
  const { witness } = await outerProver.noir.execute({
    eip712_domain_lo: fieldHexToDecimal(fixtures[0].publicInputs.eip712DomainLo),
    eip712_domain_hi: fieldHexToDecimal(fixtures[0].publicInputs.eip712DomainHi),
    chain_id: fieldHexToDecimal(fixtures[0].publicInputs.chainId),
    timestamps: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.timestamp)),
    shielded_roots: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.shieldedRoot)),
    wormhole_roots: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.wormholeRoot)),
    signer_roots: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.signerRoot)),
    message_hash_his: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.hashedMessageHi)),
    message_hash_los: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.hashedMessageLo)),
    signer_commitments: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.signerCommitment)),
    signer_nullifiers: fixtures.map((fixture) => fieldHexToDecimal(fixture.publicInputs.signerNullifier)),
    wormhole_nullifiers: fixtures.map((fixture) => [fieldHexToDecimal(fixture.publicInputs.wormholeNullifier)]),
    input_nullifiers: fixtures.map((fixture) => fieldHexesToDecimals(fixture.publicInputs.inputNullifiers)),
    output_commitments: fixtures.map((fixture) => fieldHexesToDecimals(fixture.publicInputs.outputCommitments)),
    proofs,
    verification_key: fieldHexesToDecimals(recursiveArtifacts.vkAsFields),
    key_hash: fieldHexToDecimal(recursiveArtifacts.vkHash),
  });
  return outerProver.backend.generateProof(witness, { verifierTarget: OUTER_TARGET } as never);
}

async function proveMarketFulfillment(
  request: MarketFulfillmentProofServiceRequest,
): Promise<MarketFulfillmentProofServiceResponse> {
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPrivateKey) {
    throw new HttpError(500, "RELAYER_PRIVATE_KEY not configured");
  }
  const fixtures = await Promise.all([
    buildFixture(request.fixtures[0], relayerPrivateKey),
    buildFixture(request.fixtures[1], relayerPrivateKey),
  ]) as [DelegatedFixture, DelegatedFixture];
  const batchProof = await proveBatch(fixtures);

  return {
    proof: bytesToHex(batchProof.proof) as Hex,
    fixtures: fixtures.map((fixture) => ({
      role: fixture.role,
      shieldedTx: stringifyDelegatedShieldedTx(fixture.shieldedTx),
      stateBefore: toSerializableSignerState(fixture.stateBefore),
      stateAfter: toSerializableSignerState(fixture.stateAfter),
    })) as [
      MarketFulfillmentProofFixtureResponse,
      MarketFulfillmentProofFixtureResponse,
    ],
  };
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "market-proof-service" });
  });

  app.post(
    "/market-fulfill/prove",
    asyncHandler(async (req, res) => {
      if (!isProofRequest(req.body)) {
        throw new HttpError(400, "Invalid proof request payload");
      }
      const proof = await proveMarketFulfillment(req.body);
      res.json(proof);
    }),
  );

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  });

  return app;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4010);
const app = createApp();
app.listen(port, host, () => {
  console.log(`market-proof-service listening on http://${host}:${port}`);
});
