import { describe, it, expect } from "bun:test";
import { getMerkleTree } from "../src/merkle";
import { getCommitment, getNullifier, getWormholeBurnCommitment, getWormholeNullifier, getWormholePseudoNullifier } from "../src/joinsplits";
import { getDelegatedPublicInputHashes, getShieldedPoolDomain, getShieldedPoolDomainSeparator, getSignerCommitment, getSignerDelegationHash, getSignerDelegationTypehash, getSignerDelegationTypehashBytes, getSignerNullifier } from "../src/signers";
import { Prover } from "../src/prover";
import { privateKeyToAccount } from "viem/accounts";
import { ConfidentialType, TransferType, type InputNote, type OutputNote, type SignerDelegation, type SignerNote, type WormholeNote } from "../src/types";
import { bytesToHex, createPublicClient, getAddress, hashTypedData, hexToBytes, http, keccak256, recoverPublicKey, toHex, type Abi, type Address } from "viem";
import type { ProofData } from "@aztec/bb.js";
import { sepolia } from "viem/chains";

const MERKLE_TREE_DEPTH = 20

const verifierAbi = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "_proof", type: "bytes" },
      { name: "_publicInputs", type: "bytes32[]" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "error",
    name: "ProofLengthWrong",
    inputs: [],
  },
  {
    type: "error",
    name: "ProofLengthWrongWithLogN",
    inputs: [
      { name: "logN", type: "uint256" },
      { name: "actualLength", type: "uint256" },
      { name: "expectedLength", type: "uint256" }
    ],
  },
  {
    type: "error",
    name: "PublicInputsLengthWrong",
    inputs: [],
  },
  {
    type: "error",
    name: "SumcheckFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "ShpleminiFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "GeminiChallengeInSubgroup",
    inputs: [],
  },
  {
    type: "error",
    name: "ConsistencyCheckFailed",
    inputs: [],
  }
] as const satisfies Abi

const shieldedTxTypes = {
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
} as const

function extractPublicInputs(result: string[], inputLength: number, outputLength: number) {
  const decodeByteArray = (values: string[]) => bytesToHex(Uint8Array.from(values.map(value => Number(BigInt(value)))))
  return {
    eip712DomainLo: decodeByteArray(result.slice(0, 16)),
    eip712DomainHi: decodeByteArray(result.slice(16, 32)),
    hashedMessage: decodeByteArray(result.slice(32, 64)),
    chainId: result[64]!,
    timestamp: result[65]!,
    shieldedRoot: result[66]!,
    wormholeRoot: result[67]!,
    signerRoot: result[68]!,
    returnedHashedMessageHi: result[69]!,
    returnedHashedMessageLo: result[70]!,
    signerCommitment: result[71]!,
    signerNullifier: result[72]!,
    wormholeNullifier: result[73]!,
    inputNullifiers: result.slice(74, 74 + inputLength),
    outputCommitments: result.slice(74 + inputLength, 74 + inputLength + outputLength),
  }
}

async function verifyOnchain(proofData: ProofData) {
  if (!process.env.DELEGATED_UTXO_2X2_VERIFIER_ADDRESS) {
    return console.log("Skipping onchain verify - DELEGATED_UTXO_2X2_VERIFIER_ADDRESS is not set")
  }
  const chain = sepolia
  const contractAddress = getAddress(process.env.DELEGATED_UTXO_2X2_VERIFIER_ADDRESS!)
  console.log("Verifying onchain...")
  console.log("Chain:", chain.name)
  console.log("Solidity verifier address:", process.env.DELEGATED_UTXO_2X2_VERIFIER_ADDRESS)
  try {
    const client = createPublicClient({
      chain,
      transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
    })

    const valid = await client.readContract({
      address: contractAddress,
      functionName: "verify",
      abi: verifierAbi,
      args: [toHex(proofData.proof), proofData.publicInputs as readonly `0x${string}`[]],
    })
    console.log("Result:", valid)
    return valid
  } catch (error) {
    console.error((error as any).shortMessage + "\n" + (error as any).metaMessages[0])
    return false
  }
}

function getShieldedTxHash(
  domain: ReturnType<typeof getShieldedPoolDomain>,
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
    types: shieldedTxTypes,
    message: shieldedTx,
  })
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
  }))
}

function toCircuitOutputNotes(outputNotes: OutputNote[]) {
  return outputNotes.map(note => ({
    chain_id: note.chain_id.toString(),
    recipient: note.recipient.toString(),
    blinding: note.blinding.toString(),
    amount: note.amount.toString(),
    transfer_type: note.transfer_type,
  }))
}

function toCircuitSignerNote(signerNote: SignerNote) {
  return {
    index: signerNote.index.toString(),
    siblings: signerNote.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - signerNote.siblings.length).fill("0")),
    total_amount: signerNote.total_amount.toString(),
    nonce: signerNote.nonce.toString(),
    timestamp: signerNote.timestamp.toString(),
    blinding: signerNote.blinding.toString(),
  }
}

function toCircuitSignerDelegation(delegation: SignerDelegation) {
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
  }
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
    }
  }
}

function toCircuitWormholeNote(wormholeNote: WormholeNote, wormholeProof: { index: number; siblings: bigint[] }, wormholeBranchRoot: bigint, masterProof: { index: number; siblings: bigint[] }) {
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
    }
  }
}

describe("delegated utxo", () => {
  const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
  const delegate = privateKeyToAccount("0x1000000000000000000000000000000000000000000000000000000000000001")
  const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
  const verifyingContract = "0x0000000000000000000000000000000000001000"
  const tokenAddress = "0x0000000000000000000000000000000000000001"
  const token = BigInt(tokenAddress)
  const tokenId = 0n
  const chainId = 1n
  const timestamp = 1000n
  const signerDelegationTypehash = getSignerDelegationTypehash()
  const signerDelegationTypehashBytes = getSignerDelegationTypehashBytes()
  const domain = getShieldedPoolDomain(chainId, verifyingContract)
  const domainSeparator = getShieldedPoolDomainSeparator(chainId, verifyingContract)

  it("should get 2x2 delegated proof without wormhole", async () => {
    const notes = [
      { owner: owner.address, blinding: 123456789n, token, tokenId, amount: 100n },
      { owner: owner.address, blinding: 987654321n, token, tokenId, amount: 100n },
    ]
    const commitments = notes.map(note => getCommitment(
      note.token, note.tokenId,
      { chain_id: chainId, recipient: note.owner, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER }
    ))
    const utxoBranchTree = getMerkleTree(commitments)
    const utxoMasterTree = getMerkleTree([utxoBranchTree.root])
    const masterUtxoProof = utxoMasterTree.generateProof(0)

    const inputNotes: InputNote[] = notes.map((note, i) => {
      const proof = utxoBranchTree.generateProof(i)
      return {
        chain_id: chainId,
        blinding: note.blinding,
        amount: note.amount,
        branch_index: BigInt(proof.index),
        branch_siblings: proof.siblings,
        branch_root: utxoBranchTree.root,
        master_index: BigInt(masterUtxoProof.index),
        master_siblings: masterUtxoProof.siblings,
      }
    })

    const outputNotes: OutputNote[] = [
      { chain_id: chainId, recipient, blinding: 111111111n, amount: 150n, transfer_type: TransferType.TRANSFER },
      { chain_id: chainId, recipient: owner.address, blinding: 222222222n, amount: 50n, transfer_type: TransferType.TRANSFER },
    ]

    const delegation: SignerDelegation = {
      chainId,
      owner: owner.address,
      delegate: delegate.address,
      startTime: 0n,
      endTime: 0n,
      token: tokenAddress,
      tokenId,
      amount: 200n,
      amountType: 0,
      maxCumulativeAmount: 0n,
      maxNonce: 0n,
      timeInterval: 0n,
      transferType: 0,
    }

    const signerNote: SignerNote = {
      index: 0n,
      siblings: [],
      total_amount: 0n,
      nonce: 0n,
      timestamp: 0n,
      blinding: 777n,
    }
    const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation)
    const signerBlinding = 999n
    const signerRoot = 0n
    const wormholePseudoSecret = 69n
    const expectedWormholeNullifier = getWormholePseudoNullifier(chainId, owner.address, token, tokenId, wormholePseudoSecret)
    const expectedInputNullifiers = inputNotes.map(note => getNullifier(chainId, utxoBranchTree.root, owner.address, token, tokenId, note))
    const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, signerNote)
    const updatedSignerNote: SignerNote = {
      ...signerNote,
      total_amount: 150n,
      nonce: 1n,
      timestamp,
      blinding: signerBlinding,
    }
    const expectedSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, updatedSignerNote)

    const shieldedTx = {
      chainId,
      wormholeRoot: toHex(0n, { size: 32 }),
      wormholeNullifier: toHex(expectedWormholeNullifier, { size: 32 }),
      shieldedRoot: toHex(utxoMasterTree.root, { size: 32 }),
      signerRoot: toHex(signerRoot, { size: 32 }),
      signerCommitment: toHex(expectedSignerCommitment, { size: 32 }),
      signerNullifier: toHex(expectedSignerNullifier, { size: 32 }),
      nullifiers: expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })),
      commitments: outputNotes.map(note => getCommitment(token, tokenId, note)),
      withdrawals: [] as {
        to: Address;
        asset: Address;
        id: bigint;
        amount: bigint;
        confidentialContext: `0x${string}`;
      }[],
    }
    const messageHash = getShieldedTxHash(domain, shieldedTx)
    const signature = await delegate.sign({ hash: messageHash })
    const publicKey = await recoverPublicKey({ hash: messageHash, signature })
    const delegationSignature = await owner.sign({ hash: delegationHash })
    const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: delegationSignature })
    const publicHashes = getDelegatedPublicInputHashes(domainSeparator, messageHash)

    const prover = new Prover("delegated_utxo_2x2")
    const circuitInputs = {
      eip712_domain_lo: [...hexToBytes(toHex(publicHashes.eip712DomainLo, { size: 16 }))],
      eip712_domain_hi: [...hexToBytes(toHex(publicHashes.eip712DomainHi, { size: 16 }))],
      pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
      pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
      signature: [...hexToBytes(signature).slice(0, 64)],
      hashed_message: [...hexToBytes(messageHash)],
      chain_id: chainId.toString(),
      timestamp: timestamp.toString(),
      shielded_root: utxoMasterTree.root.toString(),
      wormhole_root: "0",
      signer_root: signerRoot.toString(),
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
    }

    console.time("prove")
    const result = await prover.prove(circuitInputs)
    console.timeEnd("prove")

    console.time("verify")
    const isValid = await prover.verify(result)
    console.timeEnd("verify")
    expect(isValid).toBe(true)

    const expectedOutputCommitments = outputNotes.map(note => getCommitment(token, tokenId, note))
    const actual = extractPublicInputs(result.publicInputs, inputNotes.length, outputNotes.length)
    const domainBytes = hexToBytes(domainSeparator)

    expect(actual.eip712DomainLo, "eip712 domain lo public input mismatch").toBe(bytesToHex(domainBytes.slice(16, 32)))
    expect(actual.eip712DomainHi, "eip712 domain hi public input mismatch").toBe(bytesToHex(domainBytes.slice(0, 16)))
    expect(actual.hashedMessage, "hashed message public input mismatch").toBe(messageHash)
    expect(actual.chainId, "chain id public input mismatch").toBe(toHex(chainId, { size: 32 }))
    expect(actual.timestamp, "timestamp public input mismatch").toBe(toHex(timestamp, { size: 32 }))
    expect(actual.shieldedRoot, "shielded root public input mismatch").toBe(toHex(utxoMasterTree.root, { size: 32 }))
    expect(actual.wormholeRoot, "wormhole root public input mismatch").toBe(toHex(0n, { size: 32 }))
    expect(actual.signerRoot, "signer root public input mismatch").toBe(toHex(signerRoot, { size: 32 }))
    expect(actual.returnedHashedMessageHi, "returned hashed message hi public input mismatch").toBe(toHex(publicHashes.hashedMessageHi, { size: 32 }))
    expect(actual.returnedHashedMessageLo, "returned hashed message lo public input mismatch").toBe(toHex(publicHashes.hashedMessageLo, { size: 32 }))
    expect(actual.signerCommitment, "signer commitment public input mismatch").toBe(toHex(expectedSignerCommitment, { size: 32 }))
    expect(actual.signerNullifier, "signer nullifier public input mismatch").toBe(toHex(expectedSignerNullifier, { size: 32 }))
    expect(actual.wormholeNullifier, "wormhole nullifier public input mismatch").toBe(toHex(expectedWormholeNullifier, { size: 32 }))
    expect(actual.inputNullifiers, "input nullifiers public input mismatch").toEqual(expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })))
    expect(actual.outputCommitments, "output commitments public input mismatch").toEqual(expectedOutputCommitments.map(commitment => toHex(commitment, { size: 32 })))

    await verifyOnchain(result)
  }, { timeout: 20000 })

  it("should get 2x2 delegated proof with wormhole included", async () => {
    const notes = [
      { owner: owner.address, blinding: 123456789n, token, tokenId, amount: 100n },
    ]
    const commitments = notes.map(note => getCommitment(
      note.token, note.tokenId,
      { chain_id: chainId, recipient: note.owner, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER }
    ))
    const utxoBranchTree = getMerkleTree(commitments)
    const utxoMasterTree = getMerkleTree([utxoBranchTree.root])
    const masterUtxoProof = utxoMasterTree.generateProof(0)

    const wormholeSecret = 42069n
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
    })
    const wormholeBranchTree = getMerkleTree([burnCommitment])
    const wormholeMasterTree = getMerkleTree([wormholeBranchTree.root])

    const inputNotes: InputNote[] = notes.map((note, i) => {
      const proof = utxoBranchTree.generateProof(i)
      return {
        chain_id: chainId,
        blinding: note.blinding,
        amount: note.amount,
        branch_index: BigInt(proof.index),
        branch_siblings: proof.siblings,
        branch_root: utxoBranchTree.root,
        master_index: BigInt(masterUtxoProof.index),
        master_siblings: masterUtxoProof.siblings,
      }
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
    ])

    const wormholeProof = wormholeBranchTree.generateProof(0)
    const masterWormholeProof = wormholeMasterTree.generateProof(0)
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
    }

    const outputNotes: OutputNote[] = [
      { chain_id: chainId, recipient, blinding: 111111111n, amount: 150n, transfer_type: TransferType.TRANSFER },
      { chain_id: chainId, recipient: owner.address, blinding: 222222222n, amount: 50n, transfer_type: TransferType.TRANSFER },
    ]

    const delegation: SignerDelegation = {
      chainId,
      owner: owner.address,
      delegate: delegate.address,
      startTime: 0n,
      endTime: 0n,
      token: tokenAddress,
      tokenId,
      amount: 200n,
      amountType: 0,
      maxCumulativeAmount: 0n,
      maxNonce: 0n,
      timeInterval: 0n,
      transferType: 0,
    }

    const signerNote: SignerNote = {
      index: 0n,
      siblings: [],
      total_amount: 0n,
      nonce: 0n,
      timestamp: 0n,
      blinding: 1001n,
    }
    const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation)
    const signerBlinding = 1002n
    const signerRoot = 0n
    const expectedWormholeNullifier = getWormholeNullifier(wormholeNote)
    const expectedInputNullifiers = inputNotes.map(note => getNullifier(chainId, utxoBranchTree.root, owner.address, token, tokenId, note))
    const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, signerNote)
    const updatedSignerNote: SignerNote = {
      ...signerNote,
      total_amount: 150n,
      nonce: 1n,
      timestamp,
      blinding: signerBlinding,
    }
    const expectedSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, updatedSignerNote)

    const shieldedTx = {
      chainId,
      wormholeRoot: toHex(wormholeMasterTree.root, { size: 32 }),
      wormholeNullifier: toHex(expectedWormholeNullifier, { size: 32 }),
      shieldedRoot: toHex(utxoMasterTree.root, { size: 32 }),
      signerRoot: toHex(signerRoot, { size: 32 }),
      signerCommitment: toHex(expectedSignerCommitment, { size: 32 }),
      signerNullifier: toHex(expectedSignerNullifier, { size: 32 }),
      nullifiers: expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })),
      commitments: outputNotes.map(note => getCommitment(token, tokenId, note)),
      withdrawals: [] as {
        to: Address;
        asset: Address;
        id: bigint;
        amount: bigint;
        confidentialContext: `0x${string}`;
      }[],
    }
    const messageHash = getShieldedTxHash(domain, shieldedTx)
    const signature = await delegate.sign({ hash: messageHash })
    const publicKey = await recoverPublicKey({ hash: messageHash, signature })
    const delegationSignature = await owner.sign({ hash: delegationHash })
    const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: delegationSignature })
    const publicHashes = getDelegatedPublicInputHashes(domainSeparator, messageHash)

    const prover = new Prover("delegated_utxo_2x2")
    const circuitInputs = {
      eip712_domain_lo: [...hexToBytes(toHex(publicHashes.eip712DomainLo, { size: 16 }))],
      eip712_domain_hi: [...hexToBytes(toHex(publicHashes.eip712DomainHi, { size: 16 }))],
      pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
      pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
      signature: [...hexToBytes(signature).slice(0, 64)],
      hashed_message: [...hexToBytes(messageHash)],
      chain_id: chainId.toString(),
      timestamp: timestamp.toString(),
      shielded_root: utxoMasterTree.root.toString(),
      wormhole_root: wormholeMasterTree.root.toString(),
      signer_root: signerRoot.toString(),
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
    }

    console.time("prove wormhole")
    const result = await prover.prove(circuitInputs)
    console.timeEnd("prove wormhole")

    console.time("verify wormhole")
    const isValid = await prover.verify(result)
    console.timeEnd("verify wormhole")
    expect(isValid).toBe(true)

    const expectedOutputCommitments = outputNotes.map(note => getCommitment(token, tokenId, note))
    const actual = extractPublicInputs(result.publicInputs, inputNotes.length, outputNotes.length)
    const domainBytes = hexToBytes(domainSeparator)

    expect(actual.eip712DomainLo).toBe(bytesToHex(domainBytes.slice(16, 32)))
    expect(actual.eip712DomainHi).toBe(bytesToHex(domainBytes.slice(0, 16)))
    expect(actual.hashedMessage).toBe(messageHash)
    expect(actual.chainId).toBe(toHex(chainId, { size: 32 }))
    expect(actual.timestamp).toBe(toHex(timestamp, { size: 32 }))
    expect(actual.shieldedRoot).toBe(toHex(utxoMasterTree.root, { size: 32 }))
    expect(actual.wormholeRoot).toBe(toHex(wormholeMasterTree.root, { size: 32 }))
    expect(actual.signerRoot).toBe(toHex(signerRoot, { size: 32 }))
    expect(actual.returnedHashedMessageHi).toBe(toHex(publicHashes.hashedMessageHi, { size: 32 }))
    expect(actual.returnedHashedMessageLo).toBe(toHex(publicHashes.hashedMessageLo, { size: 32 }))
    expect(actual.signerCommitment).toBe(toHex(expectedSignerCommitment, { size: 32 }))
    expect(actual.signerNullifier).toBe(toHex(expectedSignerNullifier, { size: 32 }))
    expect(actual.wormholeNullifier).toBe(toHex(expectedWormholeNullifier, { size: 32 }))
    expect(actual.inputNullifiers).toEqual(expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })))
    expect(actual.outputCommitments).toEqual(expectedOutputCommitments.map(commitment => toHex(commitment, { size: 32 })))

    await verifyOnchain(result)
  }, { timeout: 20000 })

  it("should get delegated proof using an existing signer note", async () => {
    const notes = [
      { owner: owner.address, blinding: 123456789n, token, tokenId, amount: 100n },
      { owner: owner.address, blinding: 987654321n, token, tokenId, amount: 100n },
    ]
    const commitments = notes.map(note => getCommitment(
      note.token, note.tokenId,
      { chain_id: chainId, recipient: note.owner, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER }
    ))
    const utxoBranchTree = getMerkleTree(commitments)
    const utxoMasterTree = getMerkleTree([utxoBranchTree.root])
    const masterUtxoProof = utxoMasterTree.generateProof(0)

    const inputNotes: InputNote[] = notes.map((note, i) => {
      const proof = utxoBranchTree.generateProof(i)
      return {
        chain_id: chainId,
        blinding: note.blinding,
        amount: note.amount,
        branch_index: BigInt(proof.index),
        branch_siblings: proof.siblings,
        branch_root: utxoBranchTree.root,
        master_index: BigInt(masterUtxoProof.index),
        master_siblings: masterUtxoProof.siblings,
      }
    })

    const firstOutputNotes: OutputNote[] = [
      { chain_id: chainId, recipient, blinding: 111111111n, amount: 150n, transfer_type: TransferType.TRANSFER },
      { chain_id: chainId, recipient: owner.address, blinding: 222222222n, amount: 50n, transfer_type: TransferType.TRANSFER },
    ]
    const secondOutputNotes: OutputNote[] = [
      { chain_id: chainId, recipient, blinding: 333333333n, amount: 100n, transfer_type: TransferType.TRANSFER },
      { chain_id: chainId, recipient: owner.address, blinding: 444444444n, amount: 100n, transfer_type: TransferType.TRANSFER },
    ]

    const delegation: SignerDelegation = {
      chainId,
      owner: owner.address,
      delegate: delegate.address,
      startTime: 0n,
      endTime: 0n,
      token: tokenAddress,
      tokenId,
      amount: 200n,
      amountType: 0,
      maxCumulativeAmount: 300n,
      maxNonce: 0n,
      timeInterval: 0n,
      transferType: 0,
    }

    const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation)
    const initialSignerNote: SignerNote = {
      index: 0n,
      siblings: [],
      total_amount: 0n,
      nonce: 0n,
      timestamp: 0n,
      blinding: 888n,
    }
    const firstSignerBlinding = 999n
    const firstUpdatedSignerNote: SignerNote = {
      ...initialSignerNote,
      total_amount: 150n,
      nonce: 1n,
      timestamp,
      blinding: firstSignerBlinding,
    }
    const firstSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, firstUpdatedSignerNote)
    const signerTree = getMerkleTree([firstSignerCommitment])
    const signerProof = signerTree.generateProof(0)
    const secondSignerNote: SignerNote = {
      ...firstUpdatedSignerNote,
      index: BigInt(signerProof.index),
      siblings: signerProof.siblings,
    }
    const secondSignerBlinding = 1000n
    const expectedWormholeNullifier = getWormholePseudoNullifier(chainId, owner.address, token, tokenId, 123n)
    const expectedInputNullifiers = inputNotes.map(note => getNullifier(chainId, utxoBranchTree.root, owner.address, token, tokenId, note))
    const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, secondSignerNote)
    const finalSignerNote: SignerNote = {
      ...secondSignerNote,
      total_amount: 250n,
      nonce: 2n,
      timestamp: timestamp + 1n,
      blinding: secondSignerBlinding,
    }
    const expectedSignerCommitment = getSignerCommitment(delegate.address, owner.address, delegationHash, finalSignerNote)

    const shieldedTx = {
      chainId,
      wormholeRoot: toHex(0n, { size: 32 }),
      wormholeNullifier: toHex(expectedWormholeNullifier, { size: 32 }),
      shieldedRoot: toHex(utxoMasterTree.root, { size: 32 }),
      signerRoot: toHex(signerTree.root, { size: 32 }),
      signerCommitment: toHex(expectedSignerCommitment, { size: 32 }),
      signerNullifier: toHex(expectedSignerNullifier, { size: 32 }),
      nullifiers: expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })),
      commitments: secondOutputNotes.map(note => getCommitment(token, tokenId, note)),
      withdrawals: [] as {
        to: Address;
        asset: Address;
        id: bigint;
        amount: bigint;
        confidentialContext: `0x${string}`;
      }[],
    }
    const messageHash = getShieldedTxHash(domain, shieldedTx)
    const signature = await delegate.sign({ hash: messageHash })
    const publicKey = await recoverPublicKey({ hash: messageHash, signature })
    const delegationSignature = await owner.sign({ hash: delegationHash })
    const ownerPublicKey = await recoverPublicKey({ hash: delegationHash, signature: delegationSignature })
    const publicHashes = getDelegatedPublicInputHashes(domainSeparator, messageHash)

    const prover = new Prover("delegated_utxo_2x2")
    const circuitInputs = {
      eip712_domain_lo: [...hexToBytes(toHex(publicHashes.eip712DomainLo, { size: 16 }))],
      eip712_domain_hi: [...hexToBytes(toHex(publicHashes.eip712DomainHi, { size: 16 }))],
      pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
      pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
      signature: [...hexToBytes(signature).slice(0, 64)],
      hashed_message: [...hexToBytes(messageHash)],
      chain_id: chainId.toString(),
      timestamp: (timestamp + 1n).toString(),
      shielded_root: utxoMasterTree.root.toString(),
      wormhole_root: "0",
      signer_root: signerTree.root.toString(),
      signer_note: toCircuitSignerNote(secondSignerNote),
      signer_blinding: secondSignerBlinding.toString(),
      delegation_typehash: signerDelegationTypehashBytes,
      delegation: toCircuitSignerDelegation(delegation),
      owner_pub_key_x: [...hexToBytes(ownerPublicKey).slice(1, 33)],
      owner_pub_key_y: [...hexToBytes(ownerPublicKey).slice(33, 65)],
      delegation_signature: [...hexToBytes(delegationSignature).slice(0, 64)],
      token: token.toString(),
      token_id: tokenId.toString(),
      input_notes: toCircuitInputNotes(inputNotes),
      output_notes: toCircuitOutputNotes(secondOutputNotes),
      wormhole_note: emptyWormholeNote(),
      wormhole_pseudo_secret: { _is_some: true, _value: "123".toString() },
    }

    const result = await prover.prove(circuitInputs)
    const isValid = await prover.verify(result)
    expect(isValid).toBe(true)

    const expectedOutputCommitments = secondOutputNotes.map(note => getCommitment(token, tokenId, note))
    const actual = extractPublicInputs(result.publicInputs, inputNotes.length, secondOutputNotes.length)

    expect(actual.signerRoot, "signer root public input mismatch").toBe(toHex(signerTree.root, { size: 32 }))
    expect(actual.signerCommitment, "signer commitment public input mismatch").toBe(toHex(expectedSignerCommitment, { size: 32 }))
    expect(actual.signerNullifier, "signer nullifier public input mismatch").toBe(toHex(expectedSignerNullifier, { size: 32 }))
    expect(actual.wormholeNullifier, "wormhole nullifier public input mismatch").toBe(toHex(expectedWormholeNullifier, { size: 32 }))
    expect(actual.inputNullifiers, "input nullifiers public input mismatch").toEqual(expectedInputNullifiers.map(nullifier => toHex(nullifier, { size: 32 })))
    expect(actual.outputCommitments, "output commitments public input mismatch").toEqual(expectedOutputCommitments.map(commitment => toHex(commitment, { size: 32 })))

    expect(firstOutputNotes[0]!.amount + secondOutputNotes[0]!.amount).toBe(finalSignerNote.total_amount)
  }, { timeout: 20000 })
})
