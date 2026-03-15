import { describe, expect, it } from "bun:test";
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
  getShieldedPoolDomainSeparator,
  getSignerCommitment,
  getSignerDelegationHash,
  getSignerDelegationTypehashBytes,
  getSignerNullifier,
} from "../src/signers";
import { Prover } from "../src/prover";
import { privateKeyToAccount } from "viem/accounts";
import {
  ConfidentialType,
  TransferType,
  type InputNote,
  type OutputNote,
  type SignerDelegation,
  type SignerNote,
  type WormholeNote,
} from "../src/types";
import { hexToBytes, toHex, zeroAddress, recoverPublicKey } from "viem";

const MERKLE_TREE_DEPTH = 20;
const BATCH_SIZE = 4;
const WORMHOLE_NOTE_COUNT = 1;
const INPUT_NOTE_COUNT = 2;
const OUTPUT_NOTE_COUNT = 2;
const BATCH_PUBLIC_INPUT_COUNT = 46;

const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const delegate = privateKeyToAccount("0x1000000000000000000000000000000000000000000000000000000000000001");
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const verifyingContract = "0x0000000000000000000000000000000000001000";
const tokenAddress = "0x0000000000000000000000000000000000000001";
const token = BigInt(tokenAddress);
const tokenId = 0n;
const chainId = 1n;
const signerDelegationTypehashBytes = getSignerDelegationTypehashBytes();
const domainSeparator = getShieldedPoolDomainSeparator(chainId, verifyingContract);

type BatchTransactionFixture = {
  shieldedRoot: bigint;
  wormholeRoot: bigint;
  signerRoot: bigint;
  transaction: {
    signer_note: ReturnType<typeof toCircuitSignerNote>;
    signer_blinding: string;
    delegation: ReturnType<typeof toCircuitSignerDelegation>;
    owner_pub_key_x: number[];
    owner_pub_key_y: number[];
    delegation_signature: number[];
    token: string;
    token_id: string;
    input_notes: ReturnType<typeof toCircuitInputNotes>;
    output_notes: ReturnType<typeof toCircuitOutputNotes>;
    wormhole_notes: [ReturnType<typeof emptyWormholeNote>];
    wormhole_pseudo_secrets: [{ _is_some: boolean; _value: string }];
  };
  expected: {
    signerCommitment: bigint;
    signerNullifier: bigint;
    wormholeNullifiers: [bigint];
    inputNullifiers: [bigint, bigint];
    outputCommitments: [bigint, bigint];
  };
};

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

function buildDelegation(amount: bigint): SignerDelegation {
  return {
    chainId,
    owner: owner.address,
    delegate: delegate.address,
    recipient: zeroAddress,
    recipientLocked: false,
    startTime: 0n,
    endTime: 0n,
    token: tokenAddress,
    tokenId,
    amount,
    amountType: 0,
    maxCumulativeAmount: 0n,
    maxNonce: 0n,
    timeInterval: 0n,
    transferType: 0,
  };
}

function zeroInputNote(branchRoot: bigint, masterIndex: bigint, masterSiblings: bigint[]): InputNote {
  return {
    chain_id: chainId,
    blinding: 0n,
    amount: 0n,
    branch_index: 0n,
    branch_siblings: Array(MERKLE_TREE_DEPTH).fill(0n),
    branch_root: branchRoot,
    master_index: masterIndex,
    master_siblings: masterSiblings,
  };
}

async function createNoWormholeTransaction(args: {
  timestamp: bigint;
  signerBlinding: bigint;
  wormholePseudoSecret: bigint;
  noteBlindings: [bigint, bigint];
  outputBlindings: [bigint, bigint];
}): Promise<BatchTransactionFixture> {
  const notes = [
    { blinding: args.noteBlindings[0], amount: 100n },
    { blinding: args.noteBlindings[1], amount: 100n },
  ];
  const commitments = notes.map(note => getCommitment(
    token,
    tokenId,
    { chain_id: chainId, recipient: owner.address, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER },
  ));
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
    { chain_id: chainId, recipient, blinding: args.outputBlindings[0], amount: 150n, transfer_type: TransferType.TRANSFER },
    { chain_id: chainId, recipient: owner.address, blinding: args.outputBlindings[1], amount: 50n, transfer_type: TransferType.TRANSFER },
  ];
  const signerNote: SignerNote = {
    index: 0n,
    siblings: [],
    total_amount: 0n,
    nonce: 0n,
    timestamp: 0n,
    blinding: args.signerBlinding - 1n,
  };
  const delegation = buildDelegation(150n);
  const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation);
  const ownerSignature = await owner.sign({ hash: delegationHash });
  const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: ownerSignature });

  const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, signerNote);
  const expectedSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, {
    ...signerNote,
    total_amount: 150n,
    nonce: 1n,
    timestamp: args.timestamp,
    blinding: args.signerBlinding,
  });
  const expectedWormholeNullifier = getWormholePseudoNullifier(chainId, owner.address, token, tokenId, args.wormholePseudoSecret);
  const expectedInputNullifiers = inputNotes.map(note => getNullifier(chainId, utxoBranchTree.root, owner.address, token, tokenId, note)) as [bigint, bigint];
  const expectedOutputCommitments = outputNotes.map(note => getCommitment(token, tokenId, note)) as [bigint, bigint];

  return {
    shieldedRoot: utxoMasterTree.root,
    wormholeRoot: 0n,
    signerRoot: 0n,
    transaction: {
      signer_note: toCircuitSignerNote(signerNote),
      signer_blinding: args.signerBlinding.toString(),
      delegation: toCircuitSignerDelegation(delegation),
      owner_pub_key_x: [...hexToBytes(ownerPublicKey).slice(1, 33)],
      owner_pub_key_y: [...hexToBytes(ownerPublicKey).slice(33, 65)],
      delegation_signature: [...hexToBytes(ownerSignature).slice(0, 64)],
      token: token.toString(),
      token_id: tokenId.toString(),
      input_notes: toCircuitInputNotes(inputNotes),
      output_notes: toCircuitOutputNotes(outputNotes),
      wormhole_notes: [emptyWormholeNote()],
      wormhole_pseudo_secrets: [{ _is_some: true, _value: args.wormholePseudoSecret.toString() }],
    },
    expected: {
      signerCommitment: expectedSignerCommitment,
      signerNullifier: expectedSignerNullifier,
      wormholeNullifiers: [expectedWormholeNullifier],
      inputNullifiers: expectedInputNullifiers,
      outputCommitments: expectedOutputCommitments,
    },
  };
}

async function createIncludedWormholeTransaction(args: {
  timestamp: bigint;
  signerBlinding: bigint;
  noteBlinding: bigint;
  outputBlindings: [bigint, bigint];
  wormholeSecret: bigint;
  entryId: bigint;
}): Promise<BatchTransactionFixture> {
  const baseCommitment = getCommitment(
    token,
    tokenId,
    { chain_id: chainId, recipient: owner.address, blinding: args.noteBlinding, amount: 100n, transfer_type: TransferType.TRANSFER },
  );
  const utxoBranchTree = getMerkleTree([baseCommitment]);
  const utxoMasterTree = getMerkleTree([utxoBranchTree.root]);
  const masterProof = utxoMasterTree.generateProof(0);
  const inputProof = utxoBranchTree.generateProof(0);

  const burnCommitment = getWormholeBurnCommitment({
    dst_chain_id: chainId,
    src_chain_id: chainId,
    entry_id: args.entryId,
    recipient: owner.address,
    wormhole_secret: args.wormholeSecret,
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
  const wormholeProof = wormholeBranchTree.generateProof(0);
  const wormholeMasterProof = wormholeMasterTree.generateProof(0);

  const wormholeNote: WormholeNote = {
    dst_chain_id: chainId,
    src_chain_id: chainId,
    entry_id: args.entryId,
    recipient: owner.address,
    wormhole_secret: args.wormholeSecret,
    token,
    token_id: tokenId,
    from: owner.address,
    to: owner.address,
    amount: 100n,
    confidential_type: ConfidentialType.NONE,
  };
  const inputNotes: InputNote[] = [
    {
      chain_id: chainId,
      blinding: args.noteBlinding,
      amount: 100n,
      branch_index: BigInt(inputProof.index),
      branch_siblings: inputProof.siblings,
      branch_root: utxoBranchTree.root,
      master_index: BigInt(masterProof.index),
      master_siblings: masterProof.siblings,
    },
    zeroInputNote(utxoBranchTree.root, BigInt(masterProof.index), masterProof.siblings),
  ];
  const outputNotes: OutputNote[] = [
    { chain_id: chainId, recipient, blinding: args.outputBlindings[0], amount: 150n, transfer_type: TransferType.TRANSFER },
    { chain_id: chainId, recipient: owner.address, blinding: args.outputBlindings[1], amount: 50n, transfer_type: TransferType.TRANSFER },
  ];
  const signerNote: SignerNote = {
    index: 0n,
    siblings: [],
    total_amount: 0n,
    nonce: 0n,
    timestamp: 0n,
    blinding: args.signerBlinding - 1n,
  };
  const delegation = buildDelegation(150n);
  const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation);
  const ownerSignature = await owner.sign({ hash: delegationHash });
  const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: ownerSignature });

  const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, signerNote);
  const expectedSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, {
    ...signerNote,
    total_amount: 150n,
    nonce: 1n,
    timestamp: args.timestamp,
    blinding: args.signerBlinding,
  });
  const expectedWormholeNullifier = getWormholeNullifier(wormholeNote);
  const expectedInputNullifiers = inputNotes.map(note => getNullifier(chainId, utxoBranchTree.root, owner.address, token, tokenId, note)) as [bigint, bigint];
  const expectedOutputCommitments = outputNotes.map(note => getCommitment(token, tokenId, note)) as [bigint, bigint];

  return {
    shieldedRoot: utxoMasterTree.root,
    wormholeRoot: wormholeMasterTree.root,
    signerRoot: 0n,
    transaction: {
      signer_note: toCircuitSignerNote(signerNote),
      signer_blinding: args.signerBlinding.toString(),
      delegation: toCircuitSignerDelegation(delegation),
      owner_pub_key_x: [...hexToBytes(ownerPublicKey).slice(1, 33)],
      owner_pub_key_y: [...hexToBytes(ownerPublicKey).slice(33, 65)],
      delegation_signature: [...hexToBytes(ownerSignature).slice(0, 64)],
      token: token.toString(),
      token_id: tokenId.toString(),
      input_notes: toCircuitInputNotes(inputNotes),
      output_notes: toCircuitOutputNotes(outputNotes),
      wormhole_notes: [toCircuitWormholeNote(wormholeNote, wormholeProof, wormholeBranchTree.root, wormholeMasterProof)],
      wormhole_pseudo_secrets: [{ _is_some: false, _value: "0" }],
    },
    expected: {
      signerCommitment: expectedSignerCommitment,
      signerNullifier: expectedSignerNullifier,
      wormholeNullifiers: [expectedWormholeNullifier],
      inputNullifiers: expectedInputNullifiers,
      outputCommitments: expectedOutputCommitments,
    },
  };
}

function extractBatchPublicInputs(result: string[]) {
  return {
    eip712DomainLo: result[0]!,
    eip712DomainHi: result[1]!,
    chainId: result[2]!,
    timestamp: result[3]!,
    shieldedRoots: result.slice(4, 8),
    wormholeRoots: result.slice(8, 12),
    signerRoots: result.slice(12, 16),
    hashedMessageHi: result[16]!,
    hashedMessageLo: result[17]!,
    signerCommitments: result.slice(18, 22),
    signerNullifiers: result.slice(22, 26),
    wormholeNullifiers: [
      [result[26]!],
      [result[27]!],
      [result[28]!],
      [result[29]!],
    ],
    inputNullifiers: [
      [result[30]!, result[31]!],
      [result[32]!, result[33]!],
      [result[34]!, result[35]!],
      [result[36]!, result[37]!],
    ],
    outputCommitments: [
      [result[38]!, result[39]!],
      [result[40]!, result[41]!],
      [result[42]!, result[43]!],
      [result[44]!, result[45]!],
    ],
  };
}

async function proveBatch(fixtures: BatchTransactionFixture[], timestamp: bigint, messageHash: `0x${string}`) {
  const delegateSignature = await delegate.sign({ hash: messageHash });
  const delegatePublicKey = await recoverPublicKey({ hash: messageHash, signature: delegateSignature });
  const publicHashes = getDelegatedPublicInputHashes(domainSeparator, messageHash);

  const inputs = {
    eip712_domain_lo: publicHashes.eip712DomainLo.toString(),
    eip712_domain_hi: publicHashes.eip712DomainHi.toString(),
    pub_key_x: [...hexToBytes(delegatePublicKey).slice(1, 33)],
    pub_key_y: [...hexToBytes(delegatePublicKey).slice(33, 65)],
    signature: [...hexToBytes(delegateSignature).slice(0, 64)],
    hashed_message: [...hexToBytes(messageHash)],
    chain_id: chainId.toString(),
    timestamp: timestamp.toString(),
    delegation_typehash: signerDelegationTypehashBytes,
    shielded_roots: fixtures.map(fixture => fixture.shieldedRoot.toString()),
    wormhole_roots: fixtures.map(fixture => fixture.wormholeRoot.toString()),
    signer_roots: fixtures.map(fixture => fixture.signerRoot.toString()),
    transactions: fixtures.map(fixture => fixture.transaction),
  }
  const prover = new Prover("batch_delegated_utxo_2x2");
  console.time("prove");
  const result = await prover.prove(inputs);
  console.timeEnd("prove");
  console.time("verify");
  const isValid = await prover.verify(result);
  console.timeEnd("verify");
  expect(isValid).toBe(true);

  return {
    result,
    publicHashes,
    actual: extractBatchPublicInputs(result.publicInputs),
  };
}

describe("batch delegated utxo", () => {
  it("proves four batched delegated transfers without wormholes", async () => {
    const timestamp = 1000n;
    const fixtures = await Promise.all([
      createNoWormholeTransaction({ timestamp, signerBlinding: 1001n, wormholePseudoSecret: 69n, noteBlindings: [123456789n, 987654321n], outputBlindings: [111111111n, 222222222n] }),
      createNoWormholeTransaction({ timestamp, signerBlinding: 1002n, wormholePseudoSecret: 96n, noteBlindings: [123123123n, 321321321n], outputBlindings: [333333333n, 444444444n] }),
      createNoWormholeTransaction({ timestamp, signerBlinding: 1003n, wormholePseudoSecret: 123n, noteBlindings: [555555555n, 666666666n], outputBlindings: [777777777n, 888888888n] }),
      createNoWormholeTransaction({ timestamp, signerBlinding: 1004n, wormholePseudoSecret: 456n, noteBlindings: [999999999n, 1010101010n], outputBlindings: [1212121212n, 1313131313n] }),
    ]);

    // The direct batch circuit only constrains that the delegate signed this shared hash.
    const messageHash = toHex(424242n, { size: 32 });
    const { result, publicHashes, actual } = await proveBatch(fixtures, timestamp, messageHash);

    expect(result.publicInputs).toHaveLength(BATCH_PUBLIC_INPUT_COUNT);
    expect(actual.eip712DomainLo).toBe(toHex(publicHashes.eip712DomainLo, { size: 32 }));
    expect(actual.eip712DomainHi).toBe(toHex(publicHashes.eip712DomainHi, { size: 32 }));
    expect(actual.chainId).toBe(toHex(chainId, { size: 32 }));
    expect(actual.timestamp).toBe(toHex(timestamp, { size: 32 }));
    expect(actual.hashedMessageHi).toBe(toHex(publicHashes.hashedMessageHi, { size: 32 }));
    expect(actual.hashedMessageLo).toBe(toHex(publicHashes.hashedMessageLo, { size: 32 }));
    expect(actual.shieldedRoots).toEqual(fixtures.map(fixture => toHex(fixture.shieldedRoot, { size: 32 })));
    expect(actual.wormholeRoots).toEqual(Array(BATCH_SIZE).fill(toHex(0n, { size: 32 })));
    expect(actual.signerRoots).toEqual(Array(BATCH_SIZE).fill(toHex(0n, { size: 32 })));
    expect(actual.signerCommitments).toEqual(fixtures.map(fixture => toHex(fixture.expected.signerCommitment, { size: 32 })));
    expect(actual.signerNullifiers).toEqual(fixtures.map(fixture => toHex(fixture.expected.signerNullifier, { size: 32 })));
    expect(actual.wormholeNullifiers).toEqual(
      fixtures.map(fixture => fixture.expected.wormholeNullifiers.map(value => toHex(value, { size: 32 }))),
    );
    expect(actual.inputNullifiers).toEqual(
      fixtures.map(fixture => fixture.expected.inputNullifiers.map(value => toHex(value, { size: 32 }))),
    );
    expect(actual.outputCommitments).toEqual(
      fixtures.map(fixture => fixture.expected.outputCommitments.map(value => toHex(value, { size: 32 }))),
    );
  }, { timeout: 120000 });

  it("proves a batched mix of wormhole and non-wormhole delegated transfers", async () => {
    const timestamp = 1001n;
    const fixtures = await Promise.all([
      createNoWormholeTransaction({ timestamp, signerBlinding: 2001n, wormholePseudoSecret: 111n, noteBlindings: [200000001n, 200000002n], outputBlindings: [200000003n, 200000004n] }),
      createIncludedWormholeTransaction({ timestamp, signerBlinding: 2002n, noteBlinding: 200000005n, outputBlindings: [200000006n, 200000007n], wormholeSecret: 42069n, entryId: 1n }),
      createNoWormholeTransaction({ timestamp, signerBlinding: 2003n, wormholePseudoSecret: 222n, noteBlindings: [200000008n, 200000009n], outputBlindings: [200000010n, 200000011n] }),
      createIncludedWormholeTransaction({ timestamp, signerBlinding: 2004n, noteBlinding: 200000012n, outputBlindings: [200000013n, 200000014n], wormholeSecret: 77777n, entryId: 2n }),
    ]);

    const messageHash = toHex(989898n, { size: 32 });
    const { result, actual } = await proveBatch(fixtures, timestamp, messageHash);

    expect(result.publicInputs).toHaveLength(BATCH_PUBLIC_INPUT_COUNT);
    expect(actual.wormholeRoots).toEqual(fixtures.map(fixture => toHex(fixture.wormholeRoot, { size: 32 })));
    expect(actual.wormholeNullifiers).toEqual(
      fixtures.map(fixture => fixture.expected.wormholeNullifiers.map(value => toHex(value, { size: 32 }))),
    );
    expect(actual.inputNullifiers).toEqual(
      fixtures.map(fixture => fixture.expected.inputNullifiers.map(value => toHex(value, { size: 32 }))),
    );
    expect(actual.outputCommitments).toEqual(
      fixtures.map(fixture => fixture.expected.outputCommitments.map(value => toHex(value, { size: 32 }))),
    );
  }, { timeout: 120000 });
});
