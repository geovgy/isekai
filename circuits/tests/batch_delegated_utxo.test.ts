import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Barretenberg, deflattenFields, type ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js";
import { privateKeyToAccount } from "viem/accounts";
import {
  bytesToHex,
  hashTypedData,
  hexToBytes,
  recoverPublicKey,
  toHex,
  zeroAddress,
  type Address,
} from "viem";
import { getMerkleTree } from "../src/merkle";
import {
  getCommitment,
  getNullifier,
  getWormholeBurnCommitment,
  getWormholeNullifier,
  getWormholePseudoNullifier,
} from "../src/joinsplits";
import {
  getDelegatedPublicInputHashes,
  getShieldedPoolDomain,
  getShieldedPoolDomainSeparator,
  getSignerCommitment,
  getSignerDelegationHash,
  getSignerDelegationTypehashBytes,
  getSignerNullifier,
} from "../src/signers";
import {
  ConfidentialType,
  TransferType,
  type InputNote,
  type OutputNote,
  type SignerDelegation,
  type SignerNote,
  type WormholeNote,
} from "../src/types";

const MERKLE_TREE_DEPTH = 20;
const RECURSIVE_INNER_TARGET = "noir-recursive-no-zk" as const;
const OUTER_TARGET = "evm" as const;
const BATCH_PUBLIC_INPUT_COUNT = 29;

const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const delegate = privateKeyToAccount("0x1000000000000000000000000000000000000000000000000000000000000001");
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const verifyingContract = "0x0000000000000000000000000000000000001000";
const tokenAddress = "0x0000000000000000000000000000000000000001";
const token = BigInt(tokenAddress);
const tokenId = 0n;
const chainId = 1n;
const signerDelegationTypehashBytes = getSignerDelegationTypehashBytes();
const domain = getShieldedPoolDomain(chainId, verifyingContract);
const domainSeparator = getShieldedPoolDomainSeparator(chainId, verifyingContract);

let api: Barretenberg;
let innerNoir: Noir;
let outerNoir: Noir;
let innerBackend: UltraHonkBackend;
let outerBackend: UltraHonkBackend;

type DelegatedPublicInputs = {
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

type DelegatedFixture = {
  proofData: ProofData;
  publicInputs: DelegatedPublicInputs;
};

function extractDelegatedPublicInputs(result: string[]): DelegatedPublicInputs {
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
    inputNullifiers: [result[12]!, result[13]!],
    outputCommitments: [result[14]!, result[15]!],
  };
}

function fieldHexToDecimal(field: string) {
  return BigInt(field).toString();
}

function fieldHexesToDecimals(fields: string[]) {
  return fields.map(fieldHexToDecimal);
}

function toCircuitInputNotes(inputNotes: InputNote[]) {
  return inputNotes.map(note => ({
    chain_id: note.chain_id.toString(),
    blinding: note.blinding.toString(),
    amount: note.amount.toString(),
    branch_index: note.branch_index.toString(),
    branch_siblings: note.branch_siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.branch_siblings.length).fill("0")),
    branch_root: note.branch_root.toString(),
    master_index: note.master_index.toString(),
    master_siblings: note.master_siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.master_siblings.length).fill("0")),
  }));
}

function toCircuitOutputNotes(outputNotes: OutputNote[]) {
  return outputNotes.map(note => ({
    chain_id: note.chain_id.toString(),
    recipient: note.recipient.toString(),
    blinding: note.blinding.toString(),
    amount: note.amount.toString(),
    transfer_type: note.transfer_type,
  }));
}

function toCircuitSignerNote(signerNote: SignerNote) {
  return {
    index: signerNote.index.toString(),
    siblings: signerNote.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - signerNote.siblings.length).fill("0")),
    total_amount: signerNote.total_amount.toString(),
    nonce: signerNote.nonce.toString(),
    timestamp: signerNote.timestamp.toString(),
    blinding: signerNote.blinding.toString(),
  };
}

function toCircuitSignerDelegation(delegation: SignerDelegation) {
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
      confidential_type: ConfidentialType.NONE,
    },
  };
}

function toCircuitWormholeNote(
  wormholeNote: WormholeNote,
  wormholeProof: { index: number; siblings: bigint[] },
  wormholeBranchRoot: bigint,
  masterProof: { index: number; siblings: bigint[] },
) {
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
      branch_index: wormholeProof.index.toString(),
      branch_siblings: wormholeProof.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - wormholeProof.siblings.length).fill("0")),
      branch_root: wormholeBranchRoot.toString(),
      master_index: BigInt(masterProof.index).toString(),
      master_siblings: masterProof.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - masterProof.siblings.length).fill("0")),
      is_approved: true,
      confidential_type: wormholeNote.confidential_type,
    },
  };
}

function getShieldedTxHash(
  shieldedTx: {
    chainId: bigint;
    wormholeRoot: `0x${string}`;
    wormholeNullifier: `0x${string}`;
    shieldedRoot: `0x${string}`;
    signerRoot: `0x${string}`;
    signerCommitment: `0x${string}`;
    signerNullifier: `0x${string}`;
    nullifiers: `0x${string}`[];
    commitments: bigint[];
    withdrawals: {
      to: Address;
      asset: Address;
      id: bigint;
      amount: bigint;
      confidentialContext: `0x${string}`;
    }[];
  },
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
    message: shieldedTx,
  });
}

async function loadCircuit(path: string) {
  const circuit = await import(path);
  return circuit as CompiledCircuit;
}

async function proveInner(inputs: InputMap) {
  const { witness } = await innerNoir.execute(inputs);
  const proofData = await innerBackend.generateProof(witness, { verifierTarget: RECURSIVE_INNER_TARGET });
  const isValid = await innerBackend.verifyProof(proofData, { verifierTarget: RECURSIVE_INNER_TARGET });
  expect(isValid).toBe(true);
  return proofData;
}

async function createNoWormholeFixture(timestamp: bigint, signerBlinding: bigint, wormholePseudoSecret: bigint, noteBlindings: [bigint, bigint], outputBlindings: [bigint, bigint]) {
  const notes = [
    { owner: owner.address, blinding: noteBlindings[0], token, tokenId, amount: 100n },
    { owner: owner.address, blinding: noteBlindings[1], token, tokenId, amount: 100n },
  ];
  const commitments = notes.map(note => getCommitment(
    note.token,
    note.tokenId,
    { chain_id: chainId, recipient: note.owner, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER },
  ));
  const utxoBranchTree = getMerkleTree(commitments);
  const utxoMasterTree = getMerkleTree([utxoBranchTree.root]);
  const masterUtxoProof = utxoMasterTree.generateProof(0);

  const inputNotes: InputNote[] = notes.map((note, i) => {
    const proof = utxoBranchTree.generateProof(i);
    return {
      chain_id: chainId,
      blinding: note.blinding,
      amount: note.amount,
      branch_index: BigInt(proof.index),
      branch_siblings: proof.siblings,
      branch_root: utxoBranchTree.root,
      master_index: BigInt(masterUtxoProof.index),
      master_siblings: masterUtxoProof.siblings,
    };
  });

  const outputNotes: OutputNote[] = [
    { chain_id: chainId, recipient, blinding: outputBlindings[0], amount: 150n, transfer_type: TransferType.TRANSFER },
    { chain_id: chainId, recipient: owner.address, blinding: outputBlindings[1], amount: 50n, transfer_type: TransferType.TRANSFER },
  ];

  const delegation: SignerDelegation = {
    chainId,
    owner: owner.address,
    delegate: delegate.address,
    recipient: zeroAddress,
    recipientLocked: false,
    startTime: 0n,
    endTime: 0n,
    token: tokenAddress,
    tokenId,
    amount: 150n,
    amountType: 0,
    maxCumulativeAmount: 0n,
    maxNonce: 0n,
    timeInterval: 0n,
    transferType: 0,
  };

  const signerNote: SignerNote = {
    index: 0n,
    siblings: [],
    total_amount: 0n,
    nonce: 0n,
    timestamp: 0n,
    blinding: signerBlinding - 1n,
  };

  const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation);
  const expectedWormholeNullifier = getWormholePseudoNullifier(chainId, owner.address, token, tokenId, wormholePseudoSecret);
  const expectedInputNullifiers = inputNotes.map(note => getNullifier(chainId, utxoBranchTree.root, owner.address, token, tokenId, note));
  const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, signerNote);
  const updatedSignerNote: SignerNote = {
    ...signerNote,
    total_amount: 150n,
    nonce: 1n,
    timestamp,
    blinding: signerBlinding,
  };
  const expectedSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, updatedSignerNote);

  const shieldedTx = {
    chainId,
    wormholeRoot: toHex(0n, { size: 32 }),
    wormholeNullifier: toHex(expectedWormholeNullifier, { size: 32 }),
    shieldedRoot: toHex(utxoMasterTree.root, { size: 32 }),
    signerRoot: toHex(0n, { size: 32 }),
    signerCommitment: toHex(expectedSignerCommitment, { size: 32 }),
    signerNullifier: toHex(expectedSignerNullifier, { size: 32 }),
    nullifiers: expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })),
    commitments: outputNotes.map(note => getCommitment(token, tokenId, note)),
    withdrawals: [],
  };

  const messageHash = getShieldedTxHash(shieldedTx);
  const signature = await delegate.sign({ hash: messageHash });
  const publicKey = await recoverPublicKey({ hash: messageHash, signature });
  const delegationSignature = await owner.sign({ hash: delegationHash });
  const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: delegationSignature });
  const publicHashes = getDelegatedPublicInputHashes(domainSeparator, messageHash);

  const proofData = await proveInner({
    eip712_domain_lo: publicHashes.eip712DomainLo.toString(),
    eip712_domain_hi: publicHashes.eip712DomainHi.toString(),
    pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
    pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
    signature: [...hexToBytes(signature).slice(0, 64)],
    hashed_message: [...hexToBytes(messageHash)],
    chain_id: chainId.toString(),
    timestamp: timestamp.toString(),
    shielded_root: utxoMasterTree.root.toString(),
    wormhole_root: "0",
    signer_root: "0",
    signer_note: toCircuitSignerNote(signerNote),
    signer_blinding: signerBlinding.toString(),
    delegation_typehash: signerDelegationTypehashBytes,
    delegation: toCircuitSignerDelegation(delegation),
    owner_pub_key_x: [...hexToBytes(ownerPublicKey).slice(1, 33)],
    owner_pub_key_y: [...hexToBytes(ownerPublicKey).slice(33, 65)],
    delegation_signature: [...hexToBytes(delegationSignature).slice(0, 64)],
    token: token.toString(),
    token_id: tokenId.toString(),
    input_notes: toCircuitInputNotes(inputNotes),
    output_notes: toCircuitOutputNotes(outputNotes),
    wormhole_note: emptyWormholeNote(),
    wormhole_pseudo_secret: { _is_some: true, _value: wormholePseudoSecret.toString() },
  });

  const actual = extractDelegatedPublicInputs(proofData.publicInputs);
  expect(actual.eip712DomainLo).toBe(toHex(publicHashes.eip712DomainLo, { size: 32 }));
  expect(actual.eip712DomainHi).toBe(toHex(publicHashes.eip712DomainHi, { size: 32 }));
  expect(actual.chainId).toBe(toHex(chainId, { size: 32 }));
  expect(actual.timestamp).toBe(toHex(timestamp, { size: 32 }));
  expect(actual.shieldedRoot).toBe(toHex(utxoMasterTree.root, { size: 32 }));
  expect(actual.wormholeRoot).toBe(toHex(0n, { size: 32 }));
  expect(actual.signerRoot).toBe(toHex(0n, { size: 32 }));
  expect(actual.signerCommitment).toBe(toHex(expectedSignerCommitment, { size: 32 }));
  expect(actual.signerNullifier).toBe(toHex(expectedSignerNullifier, { size: 32 }));
  expect(actual.wormholeNullifier).toBe(toHex(expectedWormholeNullifier, { size: 32 }));

  return { proofData, publicInputs: actual };
}

async function createIncludedWormholeFixture(timestamp: bigint) {
  const notes = [{ owner: owner.address, blinding: 333333333n, token, tokenId, amount: 100n }];
  const commitments = notes.map(note => getCommitment(
    note.token,
    note.tokenId,
    { chain_id: chainId, recipient: note.owner, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER },
  ));
  const utxoBranchTree = getMerkleTree(commitments);
  const utxoMasterTree = getMerkleTree([utxoBranchTree.root]);
  const masterUtxoProof = utxoMasterTree.generateProof(0);

  const wormholeSecret = 42069n;
  const burnCommitment = getWormholeBurnCommitment({
    dst_chain_id: chainId,
    src_chain_id: chainId,
    entry_id: 1n,
    recipient: owner.address,
    wormhole_secret: wormholeSecret,
    token,
    token_id: tokenId,
    from: owner.address,
    to: owner.address,
    amount: 100n,
    confidential_type: ConfidentialType.NONE,
    approved: true,
  });
  const wormholeBranchTree = getMerkleTree([burnCommitment]);
  const wormholeMasterTree = getMerkleTree([wormholeBranchTree.root]);

  const inputNotes: InputNote[] = notes.map((note, i) => {
    const proof = utxoBranchTree.generateProof(i);
    return {
      chain_id: chainId,
      blinding: note.blinding,
      amount: note.amount,
      branch_index: BigInt(proof.index),
      branch_siblings: proof.siblings,
      branch_root: utxoBranchTree.root,
      master_index: BigInt(masterUtxoProof.index),
      master_siblings: masterUtxoProof.siblings,
    };
  }).concat([
    {
      chain_id: chainId,
      blinding: 0n,
      amount: 0n,
      branch_index: 0n,
      branch_siblings: Array(MERKLE_TREE_DEPTH).fill(0n),
      branch_root: utxoBranchTree.root,
      master_index: BigInt(masterUtxoProof.index),
      master_siblings: masterUtxoProof.siblings,
    },
  ]);

  const wormholeProof = wormholeBranchTree.generateProof(0);
  const masterWormholeProof = wormholeMasterTree.generateProof(0);
  const wormholeNote: WormholeNote = {
    dst_chain_id: chainId,
    src_chain_id: chainId,
    entry_id: 1n,
    recipient: owner.address,
    wormhole_secret: wormholeSecret,
    token,
    token_id: tokenId,
    from: owner.address,
    to: owner.address,
    amount: 100n,
    confidential_type: ConfidentialType.NONE,
  };

  const outputNotes: OutputNote[] = [
    { chain_id: chainId, recipient, blinding: 444444444n, amount: 150n, transfer_type: TransferType.TRANSFER },
    { chain_id: chainId, recipient: owner.address, blinding: 555555555n, amount: 50n, transfer_type: TransferType.TRANSFER },
  ];

  const delegation: SignerDelegation = {
    chainId,
    owner: owner.address,
    delegate: delegate.address,
    recipient: zeroAddress,
    recipientLocked: false,
    startTime: 0n,
    endTime: 0n,
    token: tokenAddress,
    tokenId,
    amount: 150n,
    amountType: 0,
    maxCumulativeAmount: 0n,
    maxNonce: 0n,
    timeInterval: 0n,
    transferType: 0,
  };

  const signerNote: SignerNote = {
    index: 0n,
    siblings: [],
    total_amount: 0n,
    nonce: 0n,
    timestamp: 0n,
    blinding: 1001n,
  };

  const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation);
  const signerBlinding = 1002n;
  const expectedWormholeNullifier = getWormholeNullifier(wormholeNote);
  const expectedInputNullifiers = inputNotes.map(note => getNullifier(chainId, utxoBranchTree.root, owner.address, token, tokenId, note));
  const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, signerNote);
  const updatedSignerNote: SignerNote = {
    ...signerNote,
    total_amount: 150n,
    nonce: 1n,
    timestamp,
    blinding: signerBlinding,
  };
  const expectedSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, updatedSignerNote);

  const shieldedTx = {
    chainId,
    wormholeRoot: toHex(wormholeMasterTree.root, { size: 32 }),
    wormholeNullifier: toHex(expectedWormholeNullifier, { size: 32 }),
    shieldedRoot: toHex(utxoMasterTree.root, { size: 32 }),
    signerRoot: toHex(0n, { size: 32 }),
    signerCommitment: toHex(expectedSignerCommitment, { size: 32 }),
    signerNullifier: toHex(expectedSignerNullifier, { size: 32 }),
    nullifiers: expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })),
    commitments: outputNotes.map(note => getCommitment(token, tokenId, note)),
    withdrawals: [],
  };

  const messageHash = getShieldedTxHash(shieldedTx);
  const signature = await delegate.sign({ hash: messageHash });
  const publicKey = await recoverPublicKey({ hash: messageHash, signature });
  const delegationSignature = await owner.sign({ hash: delegationHash });
  const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: delegationSignature });
  const publicHashes = getDelegatedPublicInputHashes(domainSeparator, messageHash);

  const proofData = await proveInner({
    eip712_domain_lo: publicHashes.eip712DomainLo.toString(),
    eip712_domain_hi: publicHashes.eip712DomainHi.toString(),
    pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
    pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
    signature: [...hexToBytes(signature).slice(0, 64)],
    hashed_message: [...hexToBytes(messageHash)],
    chain_id: chainId.toString(),
    timestamp: timestamp.toString(),
    shielded_root: utxoMasterTree.root.toString(),
    wormhole_root: wormholeMasterTree.root.toString(),
    signer_root: "0",
    signer_note: toCircuitSignerNote(signerNote),
    signer_blinding: signerBlinding.toString(),
    delegation_typehash: signerDelegationTypehashBytes,
    delegation: toCircuitSignerDelegation(delegation),
    owner_pub_key_x: [...hexToBytes(ownerPublicKey).slice(1, 33)],
    owner_pub_key_y: [...hexToBytes(ownerPublicKey).slice(33, 65)],
    delegation_signature: [...hexToBytes(delegationSignature).slice(0, 64)],
    token: token.toString(),
    token_id: tokenId.toString(),
    input_notes: toCircuitInputNotes(inputNotes),
    output_notes: toCircuitOutputNotes(outputNotes),
    wormhole_note: toCircuitWormholeNote(wormholeNote, wormholeProof, wormholeBranchTree.root, masterWormholeProof),
    wormhole_pseudo_secret: { _is_some: false, _value: "0" },
  });

  const actual = extractDelegatedPublicInputs(proofData.publicInputs);
  expect(actual.wormholeRoot).toBe(toHex(wormholeMasterTree.root, { size: 32 }));
  expect(actual.wormholeNullifier).toBe(toHex(expectedWormholeNullifier, { size: 32 }));
  expect(actual.signerCommitment).toBe(toHex(expectedSignerCommitment, { size: 32 }));

  return { proofData, publicInputs: actual };
}

async function proveBatch(fixtures: [DelegatedFixture, DelegatedFixture]) {
  const recursiveArtifacts = await innerBackend.generateRecursiveProofArtifacts(
    fixtures[0].proofData.proof,
    fixtures[0].proofData.publicInputs.length,
    { verifierTarget: RECURSIVE_INNER_TARGET },
  );

  expect(recursiveArtifacts.vkAsFields).toHaveLength(115);
  const proofs = fixtures.map(fixture => fieldHexesToDecimals(deflattenFields(fixture.proofData.proof)));
  expect(proofs[0]).toHaveLength(457);
  expect(proofs[1]).toHaveLength(457);

  const batchInputs = {
    eip712_domain_lo: fieldHexToDecimal(fixtures[0].publicInputs.eip712DomainLo),
    eip712_domain_hi: fieldHexToDecimal(fixtures[0].publicInputs.eip712DomainHi),
    chain_id: fieldHexToDecimal(fixtures[0].publicInputs.chainId),
    timestamps: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.timestamp)),
    shielded_roots: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.shieldedRoot)),
    wormhole_roots: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.wormholeRoot)),
    signer_roots: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.signerRoot)),
    message_hash_his: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.hashedMessageHi)),
    message_hash_los: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.hashedMessageLo)),
    signer_commitments: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.signerCommitment)),
    signer_nullifiers: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.signerNullifier)),
    wormhole_nullifiers: fixtures.map(fixture => fieldHexToDecimal(fixture.publicInputs.wormholeNullifier)),
    input_nullifiers: fixtures.map(fixture => fieldHexesToDecimals(fixture.publicInputs.inputNullifiers)),
    output_commitments: fixtures.map(fixture => fieldHexesToDecimals(fixture.publicInputs.outputCommitments)),
    proofs,
    verification_key: fieldHexesToDecimals(recursiveArtifacts.vkAsFields),
    key_hash: fieldHexToDecimal(recursiveArtifacts.vkHash),
  };

  const { witness } = await outerNoir.execute(batchInputs);
  console.time("prove");
  const batchProof = await outerBackend.generateProof(witness, { verifierTarget: OUTER_TARGET });
  console.timeEnd("prove");
  console.time("verify");
  const isValid = await outerBackend.verifyProof(batchProof, { verifierTarget: OUTER_TARGET });
  console.timeEnd("verify");
  expect(isValid).toBe(true);

  return batchProof;
}

describe("batch delegated utxo recursive proof", () => {
  beforeAll(async () => {
    const [innerCircuit, outerCircuit] = await Promise.all([
      loadCircuit("../circuits/main/delegated_utxo_2x2/target/delegated_utxo_2x2.json"),
      loadCircuit("../circuits/main/batch_delegated_utxo_2x2/target/batch_delegated_utxo_2x2.json"),
    ]);

    api = await Barretenberg.new();
    innerNoir = new Noir(innerCircuit);
    outerNoir = new Noir(outerCircuit);
    innerBackend = new UltraHonkBackend(innerCircuit.bytecode, api);
    outerBackend = new UltraHonkBackend(outerCircuit.bytecode, api);
  });

  afterAll(async () => {
    await api.destroy();
  });

  it("aggregates two delegated proofs without wormholes", async () => {
    const fixtureA = await createNoWormholeFixture(1000n, 999n, 69n, [123456789n, 987654321n], [111111111n, 222222222n]);
    const fixtureB = await createNoWormholeFixture(1001n, 1999n, 96n, [123123123n, 321321321n], [333333333n, 444444444n]);

    const batchProof = await proveBatch([fixtureA, fixtureB]);
    expect(batchProof.publicInputs).toHaveLength(BATCH_PUBLIC_INPUT_COUNT);
  }, { timeout: 120000 });

  it("aggregates delegated proofs with mixed wormhole handling", async () => {
    const fixtureA = await createNoWormholeFixture(1000n, 2999n, 123n, [101010101n, 202020202n], [303030303n, 404040404n]);
    const fixtureB = await createIncludedWormholeFixture(1002n);

    const batchProof = await proveBatch([fixtureA, fixtureB]);
    expect(batchProof.publicInputs).toHaveLength(BATCH_PUBLIC_INPUT_COUNT);
    expect(bytesToHex(batchProof.proof).length).toBeGreaterThan(2);
  }, { timeout: 120000 });
});
