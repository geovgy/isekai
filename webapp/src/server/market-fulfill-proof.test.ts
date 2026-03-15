import { describe, expect, it } from "bun:test";
import { deflattenFields } from "@aztec/bb.js";
import { privateKeyToAccount } from "viem/accounts";
import {
  bytesToHex,
  hashTypedData,
  keccak256,
  hexToBytes,
  recoverPublicKey,
  stringToHex,
  toHex,
  type Address,
  type Hex,
  zeroAddress,
} from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import { getMerkleTree } from "../merkle";
import { ZKProver } from "../zk-prover";
import { TransferType, type InputNote, type OutputNote } from "../types";

const MERKLE_TREE_DEPTH = 20;
const RECURSIVE_INNER_TARGET = "noir-recursive-no-zk" as const;
const OUTER_TARGET = "evm" as const;

const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const delegate = privateKeyToAccount("0x1000000000000000000000000000000000000000000000000000000000000001");
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const verifyingContract = "0x0000000000000000000000000000000000001000";
const tokenAddress = "0x0000000000000000000000000000000000000001";
const chainId = 421614n;
const tokenId = 0n;

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

function getShieldedPoolDomain(chainIdValue: bigint, verifyingContractValue: Address) {
  return {
    name: "ShieldedPool",
    version: "1",
    chainId: chainIdValue,
    verifyingContract: verifyingContractValue,
  } as const;
}

function getShieldedPoolDomainSeparator(chainIdValue: bigint, verifyingContractValue: Address): Hex {
  return keccak256(
    concatBytes([
      hexToBytes(keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))),
      hexToBytes(keccak256(stringToHex("ShieldedPool"))),
      hexToBytes(keccak256(stringToHex("1"))),
      bytes32(chainIdValue),
      bytes32(BigInt(verifyingContractValue)),
    ]),
  );
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

function getSignerDelegationHash(delegation: {
  chainId: bigint;
  owner: Address;
  delegate: Address;
  recipient: Address;
  recipientLocked: boolean;
  startTime: bigint;
  endTime: bigint;
  token: Address;
  tokenLocked: boolean;
  tokenId: bigint;
  amount: bigint;
  amountType: number;
  maxCumulativeAmount: bigint;
  maxNonce: bigint;
  timeInterval: bigint;
  transferType: number;
}) {
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
        { name: "tokenLocked", type: "bool" },
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

function getSignerDelegationTypehashBytes() {
  return [...hexToBytes(keccak256(stringToHex("SignerDelegation(uint64 chainId,address owner,address delegate,address recipient,bool recipientLocked,uint64 startTime,uint64 endTime,address token,bool tokenLocked,uint256 tokenId,uint256 amount,uint8 amountType,uint64 maxCumulativeAmount,uint64 maxNonce,uint64 timeInterval,uint8 transferType)")))];
}

function getInputCommitment(ownerAddress: Address, token: bigint, tokenIdValue: bigint, note: Pick<InputNote, "chain_id" | "blinding" | "amount">) {
  const blindedOwner = poseidon2Hash([note.chain_id, BigInt(ownerAddress), note.blinding]);
  return poseidon2Hash([blindedOwner, token, tokenIdValue, note.amount, 1n]);
}

function getOutputCommitment(token: bigint, tokenIdValue: bigint, outputNote: OutputNote) {
  if ((outputNote.chain_id === 0n && outputNote.blinding === 0n) || outputNote.transfer_type === TransferType.WITHDRAWAL) {
    return BigInt(outputNote.recipient);
  }
  const recipientValue = typeof outputNote.recipient === "bigint" ? outputNote.recipient : BigInt(outputNote.recipient);
  const recipientHash = poseidon2Hash([outputNote.chain_id, recipientValue, outputNote.blinding]);
  return poseidon2Hash([recipientHash, token, tokenIdValue, outputNote.amount, BigInt(outputNote.transfer_type)]);
}

function getInputNullifier(inputNote: InputNote) {
  const secretCommitment = poseidon2Hash([BigInt(owner.address), BigInt(tokenAddress), tokenId, inputNote.amount]);
  return poseidon2Hash([chainId, inputNote.branch_root, inputNote.branch_index, inputNote.blinding, secretCommitment]);
}

function getPseudoNullifier(secret: bigint) {
  const pseudoCommitment = poseidon2Hash([BigInt(owner.address), BigInt(tokenAddress), tokenId, 0n, 0n]);
  return poseidon2Hash([1n, chainId, secret, pseudoCommitment]);
}

function getSignerCommitment(
  delegationHash: Hex,
  signerNote: { total_amount: bigint; nonce: bigint; timestamp: bigint; blinding: bigint },
  valid = true,
) {
  return poseidon2Hash([
    BigInt(delegate.address),
    BigInt(owner.address),
    BigInt(delegationHash),
    signerNote.total_amount,
    signerNote.nonce,
    signerNote.timestamp,
    signerNote.blinding,
    BigInt(valid),
  ]);
}

function getSignerNullifier(delegationHash: Hex, nonce: bigint) {
  return poseidon2Hash([
    BigInt(delegate.address),
    BigInt(owner.address),
    BigInt(delegationHash),
    nonce,
  ]);
}

function getShieldedTxHash(shieldedTx: {
  chainId: bigint;
  wormholeRoot: Hex;
  wormholeNullifier: Hex;
  shieldedRoot: Hex;
  signerRoot: Hex;
  signerCommitment: Hex;
  signerNullifier: Hex;
  nullifiers: Hex[];
  commitments: bigint[];
  withdrawals: {
    to: Address;
    asset: Address;
    id: bigint;
    amount: bigint;
    confidentialContext: Hex;
  }[];
}) {
  return hashTypedData({
    domain: getShieldedPoolDomain(chainId, verifyingContract),
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
    message: shieldedTx,
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

function toCircuitSignerDelegation(delegation: ReturnType<typeof buildDelegation>) {
  return {
    chainId: delegation.chainId.toString(),
    owner: delegation.owner,
    delegate: delegation.delegate,
    recipient: delegation.recipient,
    recipientLocked: delegation.recipientLocked,
    startTime: delegation.startTime.toString(),
    endTime: delegation.endTime.toString(),
    token: delegation.token,
    tokenLocked: delegation.tokenLocked,
    tokenId: delegation.tokenId.toString(),
    amount: delegation.amount.toString(),
    amountType: delegation.amountType,
    maxCumulativeAmount: delegation.maxCumulativeAmount.toString(),
    maxNonce: delegation.maxNonce.toString(),
    timeInterval: delegation.timeInterval.toString(),
    transferType: delegation.transferType,
  };
}

function buildDelegation() {
  return {
    chainId,
    owner: owner.address,
    delegate: delegate.address,
    recipient: zeroAddress,
    recipientLocked: false,
    startTime: 0n,
    endTime: 0n,
    token: tokenAddress as Address,
    tokenLocked: true,
    tokenId,
    amount: 150n,
    amountType: 0,
    maxCumulativeAmount: 0n,
    maxNonce: 0n,
    timeInterval: 0n,
    transferType: 0,
  };
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

async function createFixture(timestamp: bigint, signerBlinding: bigint, wormholePseudoSecret: bigint, noteBlindings: [bigint, bigint], outputBlindings: [bigint, bigint]) {
  const notes = [
    { blinding: noteBlindings[0], amount: 100n },
    { blinding: noteBlindings[1], amount: 100n },
  ];
  const commitments = notes.map((note) => getInputCommitment(owner.address, BigInt(tokenAddress), tokenId, {
    chain_id: chainId,
    blinding: note.blinding,
    amount: note.amount,
  }));
  const utxoBranchTree = getMerkleTree(commitments);
  const utxoMasterTree = getMerkleTree([utxoBranchTree.root]);
  const masterProof = utxoMasterTree.generateProof(0);
  const inputNotes: InputNote[] = notes.map((note, index) => {
    const proof = utxoBranchTree.generateProof(index);
    return {
      chain_id: chainId,
      blinding: note.blinding,
      amount: note.amount,
      branch_index: BigInt(proof.index),
      branch_siblings: proof.siblings,
      branch_root: utxoBranchTree.root,
      master_index: BigInt(masterProof.index),
      master_siblings: masterProof.siblings,
    };
  });
  const outputNotes: OutputNote[] = [
    { chain_id: chainId, recipient, blinding: outputBlindings[0], amount: 150n, transfer_type: TransferType.TRANSFER },
    { chain_id: chainId, recipient: owner.address, blinding: outputBlindings[1], amount: 50n, transfer_type: TransferType.TRANSFER },
  ];

  const delegation = buildDelegation();
  const delegationHash = getSignerDelegationHash(delegation);
  const signerNote = {
    index: 0n,
    siblings: [] as bigint[],
    total_amount: 0n,
    nonce: 0n,
    timestamp: 0n,
    blinding: 0n,
  };
  const expectedSignerNullifier = getSignerNullifier(delegationHash, signerNote.nonce);
  const updatedSignerNote = {
    total_amount: 150n,
    nonce: 1n,
    timestamp,
    blinding: signerBlinding,
  };
  const expectedSignerCommitment = getSignerCommitment(delegationHash, updatedSignerNote);
  const expectedWormholeNullifier = getPseudoNullifier(wormholePseudoSecret);

  const shieldedTx = {
    chainId,
    wormholeRoot: toHex(0n, { size: 32 }),
    wormholeNullifier: toHex(expectedWormholeNullifier, { size: 32 }),
    shieldedRoot: toHex(utxoMasterTree.root, { size: 32 }),
    signerRoot: toHex(0n, { size: 32 }),
    signerCommitment: toHex(expectedSignerCommitment, { size: 32 }),
    signerNullifier: toHex(expectedSignerNullifier, { size: 32 }),
    nullifiers: inputNotes.map((inputNote) => toHex(getInputNullifier(inputNote), { size: 32 })),
    commitments: outputNotes.map((note) => getOutputCommitment(BigInt(tokenAddress), tokenId, note)),
    withdrawals: [] as {
      to: Address;
      asset: Address;
      id: bigint;
      amount: bigint;
      confidentialContext: Hex;
    }[],
  };

  const messageHash = getShieldedTxHash(shieldedTx);
  const relayerSignature = await delegate.sign({ hash: messageHash });
  const relayerPublicKey = await recoverPublicKey({ hash: messageHash, signature: relayerSignature });
  const delegationSignature = await owner.sign({ hash: delegationHash });
  const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: delegationSignature });
  const domainSeparator = getShieldedPoolDomainSeparator(chainId, verifyingContract);
  const publicHashes = getDelegatedPublicInputHashes(domainSeparator, messageHash);

  const prover = new ZKProver("delegated_utxo_2x2");
  await prover.init();
  const { witness } = await prover.noir.execute({
    eip712_domain_lo: publicHashes.eip712DomainLo.toString(),
    eip712_domain_hi: publicHashes.eip712DomainHi.toString(),
    pub_key_x: [...hexToBytes(relayerPublicKey).slice(1, 33)],
    pub_key_y: [...hexToBytes(relayerPublicKey).slice(33, 65)],
    signature: [...hexToBytes(relayerSignature).slice(0, 64)],
    hashed_message: [...hexToBytes(messageHash)],
    chain_id: chainId.toString(),
    timestamp: timestamp.toString(),
    shielded_root: utxoMasterTree.root.toString(),
    wormhole_root: "0",
    signer_root: "0",
    signer_note: {
      index: "0",
      siblings: Array(MERKLE_TREE_DEPTH).fill("0"),
      total_amount: "0",
      nonce: "0",
      timestamp: "0",
      blinding: "0",
    },
    signer_blinding: signerBlinding.toString(),
    delegation_typehash: getSignerDelegationTypehashBytes(),
    delegation: toCircuitSignerDelegation(delegation),
    owner_pub_key_x: [...hexToBytes(ownerPublicKey).slice(1, 33)],
    owner_pub_key_y: [...hexToBytes(ownerPublicKey).slice(33, 65)],
    delegation_signature: [...hexToBytes(delegationSignature).slice(0, 64)],
    token: BigInt(tokenAddress).toString(),
    token_id: tokenId.toString(),
    input_notes: toCircuitInputNotes(inputNotes),
    output_notes: toCircuitOutputNotes(outputNotes),
    wormhole_notes: [{
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
    }],
    wormhole_pseudo_secrets: [{ _is_some: true, _value: wormholePseudoSecret.toString() }],
  });
  const proofData = await prover.backend.generateProof(witness, { verifierTarget: RECURSIVE_INNER_TARGET } as never);
  const publicInputs = extractDelegatedPublicInputs(proofData.publicInputs);
  return { proofData, publicInputs };
}

describe("market fulfill recursive proofs", () => {
  it("builds two delegated proofs and aggregates them recursively", async () => {
    const fixtureA = await createFixture(1000n, 999n, 69n, [123456789n, 987654321n], [111111111n, 222222222n]);
    const fixtureB = await createFixture(1001n, 1999n, 96n, [123123123n, 321321321n], [333333333n, 444444444n]);

    const innerProver = new ZKProver("delegated_utxo_2x2");
    const outerProver = new ZKProver("batch_delegated_utxo_2x2_recursive");
    await Promise.all([innerProver.init(), outerProver.init()]);

    const recursiveArtifacts = await innerProver.backend.generateRecursiveProofArtifacts(
      fixtureA.proofData.proof,
      fixtureA.proofData.publicInputs.length,
      { verifierTarget: RECURSIVE_INNER_TARGET } as never,
    );
    const proofs = [fixtureA, fixtureB].map((fixture) => fieldHexesToDecimals(deflattenFields(fixture.proofData.proof)));
    const { witness } = await outerProver.noir.execute({
      eip712_domain_lo: fieldHexToDecimal(fixtureA.publicInputs.eip712DomainLo),
      eip712_domain_hi: fieldHexToDecimal(fixtureA.publicInputs.eip712DomainHi),
      chain_id: fieldHexToDecimal(fixtureA.publicInputs.chainId),
      timestamps: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.timestamp)),
      shielded_roots: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.shieldedRoot)),
      wormhole_roots: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.wormholeRoot)),
      signer_roots: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.signerRoot)),
      message_hash_his: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.hashedMessageHi)),
      message_hash_los: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.hashedMessageLo)),
      signer_commitments: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.signerCommitment)),
      signer_nullifiers: [fixtureA, fixtureB].map((fixture) => fieldHexToDecimal(fixture.publicInputs.signerNullifier)),
      wormhole_nullifiers: [fixtureA, fixtureB].map((fixture) => [fieldHexToDecimal(fixture.publicInputs.wormholeNullifier)]),
      input_nullifiers: [fixtureA, fixtureB].map((fixture) => fieldHexesToDecimals(fixture.publicInputs.inputNullifiers)),
      output_commitments: [fixtureA, fixtureB].map((fixture) => fieldHexesToDecimals(fixture.publicInputs.outputCommitments)),
      proofs,
      verification_key: fieldHexesToDecimals(recursiveArtifacts.vkAsFields),
      key_hash: fieldHexToDecimal(recursiveArtifacts.vkHash),
    });
    const batchProof = await outerProver.backend.generateProof(witness, { verifierTarget: OUTER_TARGET } as never);

    expect(batchProof.publicInputs).toHaveLength(29);
    expect(bytesToHex(batchProof.proof).length).toBeGreaterThan(2);
  }, 120000);
});
