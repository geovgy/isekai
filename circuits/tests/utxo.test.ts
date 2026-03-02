import { describe, it, expect } from "bun:test";
import { getMerkleTree } from "../src/merkle";
import { getCommitment, getNullifier, getWormholeBurnCommitment, getWormholeNullifier, getWormholePseudoNullifier } from "../src/joinsplits";
import { Prover } from "../src/prover";
import { privateKeyToAccount } from "viem/accounts";
import { ConfidentialType, TransferType, type InputNote, type OutputNote, type WormholeNote } from "../src/types";
import { createPublicClient, getAddress, hashMessage, hexToBytes, http, parseAbi, recoverPublicKey, toHex, type Abi } from "viem";
import type { ProofData } from "@aztec/bb.js";
import { sepolia } from "viem/chains";
import { readContract } from "viem/actions";

const MERKLE_TREE_DEPTH = 20

function extractPublicInputs(result: string[], inputLength: number, outputLength: number) {
  return {
    chainId: result[0]!,
    shieldedRoot: result[1]!,
    wormholeRoot: result[2]!,
    hashedMessageHi: result[3]!,
    hashedMessageLo: result[4]!,
    wormholeNullifier: result[5]!,
    inputNullifiers: result.slice(6, 6 + inputLength),
    outputCommitments: result.slice(6 + inputLength, 6 + inputLength + outputLength),
  }
}

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

async function verifyOnchain(proofData: ProofData) {
  if (!process.env.UTXO_2X2_VERIFIER_ADDRESS) {
    return console.log("Skipping onchain verify - UTXO_2X2_VERIFIER_ADDRESS is not set")
  }
  const chain = sepolia
  const contractAddress = getAddress(process.env.UTXO_2X2_VERIFIER_ADDRESS!)
  console.log("Verifying onchain...")
  console.log("Chain:", chain.name)
  console.log("Solidity verifier address:", process.env.UTXO_2X2_VERIFIER_ADDRESS)
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

describe("utxo", () => {
  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
  const assetId = 1n
  const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

  it("should get 2x2 proof without wormhole", async () => {
    const notes = [
      { owner: account.address, blinding: 123456789n, assetId, amount: BigInt(100e18) },
      { owner: account.address, blinding: 987654321n, assetId, amount: BigInt(100e18) },
    ]
    const commitments = notes.map(note => getCommitment(
      note.assetId, 
      { chain_id: 1n, recipient: note.owner, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER }
    ))
    const utxoBranchTree = getMerkleTree(commitments)
    const utxoMasterTree = getMerkleTree([utxoBranchTree.root])

    const masterUtxoProof = utxoMasterTree.generateProof(0)

    const inputNotes: InputNote[] = notes.map((note, i) => {
      const proof = utxoBranchTree.generateProof(i)
      return {
        chain_id: 1n,
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
      { chain_id: 1n, recipient, blinding: 111111111n, amount: BigInt(150e18), transfer_type: TransferType.TRANSFER },
      { chain_id: 1n, recipient: account.address, blinding: 222222222n, amount: BigInt(50e18), transfer_type: TransferType.TRANSFER },
    ]

    const messageHash = hashMessage("This is a fake EIP712 message hash for testing purposes")
    const signature = await account.sign({ hash: messageHash })
    const publicKey = await recoverPublicKey({hash: messageHash, signature})

    const wormholePseudoSecret = 69n

    const circuitInputs = {
      pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
      pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
      signature: [...hexToBytes(signature).slice(0, 64)], // Remove recovery byte (v)
      hashed_message: [...hexToBytes(messageHash)],
      chain_id: "1",
      shielded_root: utxoBranchTree.root.toString(),
      wormhole_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
      asset_id: assetId.toString(),
      owner_address: account.address,
      input_notes: inputNotes.map(note => ({
        chain_id: note.chain_id.toString(),
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        branch_index: note.branch_index.toString(),
        branch_siblings: note.branch_siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.branch_siblings.length).fill("0")),
        branch_root: note.branch_root.toString(),
        master_index: note.master_index.toString(),
        master_siblings: note.master_siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.master_siblings.length).fill("0")),
      })),
      output_notes: outputNotes.map(note => ({
        chain_id: note.chain_id.toString(),
        recipient: note.recipient.toString(),
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        transfer_type: note.transfer_type,
      })),
      wormhole_note: { 
        _is_some: false, 
        _value: { 
          dst_chain_id: "0",
          src_chain_id: "0",
          entry_id: "0",
          recipient: "0", 
          wormhole_secret: "0", 
          asset_id: "0", 
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
      },
      wormhole_pseudo_secret: { _is_some: true, _value: wormholePseudoSecret.toString() },
    }

    const prover = new Prover("utxo_2x2")
    
    console.time("prove")
    const result = await prover.prove(circuitInputs)
    console.timeEnd("prove")

    console.time("verify")
    const isValid = await prover.verify(result)
    console.timeEnd("verify")
    expect(isValid).toBe(true)
    
    // Confirm proof outputs
    const expectedWormholeNullifier = getWormholePseudoNullifier(1n, account.address, assetId, wormholePseudoSecret)
    const expectedNullifiers = inputNotes.map(note => getNullifier(1n, utxoBranchTree.root, account.address, assetId, note))
    const expectedCommitments = outputNotes.map(note => getCommitment(assetId, note))
    const expectedHashedMessageOutputs = {
      hi: BigInt("0x" + messageHash.slice(2, 34)),
      lo: BigInt("0x" + messageHash.slice(34, 66)),
    }

    const actual = extractPublicInputs(result.publicInputs, inputNotes.length, outputNotes.length)

    expect(actual.hashedMessageHi, "hashed message hi public input mismatch").toBe(toHex(expectedHashedMessageOutputs.hi, { size: 32 }))
    expect(actual.hashedMessageLo, "hashed message lo public input mismatch").toBe(toHex(expectedHashedMessageOutputs.lo, { size: 32 }))
    expect(actual.chainId, "chain id public input mismatch").toBe(toHex(1n, { size: 32 }))
    expect(actual.shieldedRoot, "shielded root public input mismatch").toBe(toHex(utxoMasterTree.root, { size: 32 }))
    expect(actual.wormholeRoot, "wormhole root public input mismatch").toBe(toHex(0n, { size: 32 }))
    expect(actual.wormholeNullifier, "wormhole nullifier public input mismatch").toBe(toHex(expectedWormholeNullifier, { size: 32 }))
    expect(actual.inputNullifiers, "input nullifiers public input mismatch").toEqual(expectedNullifiers.map(nullifier => toHex(nullifier, { size: 32 })))
    expect(actual.outputCommitments, "output commitments public input mismatch").toEqual(expectedCommitments.map(commitment => toHex(commitment, { size: 32 })))

    await verifyOnchain(result)
  }, { timeout: 10000 });
  
  it("should get 2x2 proof with wormhole included", async () => {
    const notes = [
      { owner: account.address, blinding: 123456789n, assetId, amount: BigInt(100e18) },
      // { owner: account.address, blinding: 987654321n, assetId, amount: BigInt(100e18) },
    ]
    const commitments = notes.map(note => getCommitment(
      note.assetId, 
      { chain_id: 1n, recipient: note.owner, blinding: note.blinding, amount: note.amount, transfer_type: TransferType.TRANSFER }
    ))
    const utxoBranchTree = getMerkleTree(commitments)
    const utxoMasterTree = getMerkleTree([utxoBranchTree.root])

    const wormholeSecret = 42069n
    const burnCommitment = getWormholeBurnCommitment({
      dst_chain_id: 1n,
      src_chain_id: 1n,
      entry_id: 1n,
      recipient: account.address,
      wormhole_secret: wormholeSecret,
      asset_id: assetId,
      from: account.address,
      to: account.address,
      amount: BigInt(100e18),
      confidential_type: ConfidentialType.NONE,
      approved: true,
    })

    const wormholeBranchTree = getMerkleTree([burnCommitment])
    const wormholeMasterTree = getMerkleTree([wormholeBranchTree.root])

    const masterUtxoProof = utxoMasterTree.generateProof(0)
    
    const inputNotes: InputNote[] = notes.map((note, i) => {
      const proof = utxoBranchTree.generateProof(i)
      return {
        chain_id: 1n,
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
        chain_id: 1n,
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
      dst_chain_id: 1n,
      src_chain_id: 1n,
      entry_id: 1n,
      recipient: account.address,
      wormhole_secret: wormholeSecret,
      asset_id: assetId,
      from: account.address,
      to: account.address,
      amount: BigInt(100e18),
      confidential_type: ConfidentialType.NONE,
    }

    const outputNotes: OutputNote[] = [
      { chain_id: 1n, recipient, blinding: 111111111n, amount: BigInt(150e18), transfer_type: TransferType.TRANSFER },
      { chain_id: 1n, recipient: account.address, blinding: 222222222n, amount: BigInt(50e18), transfer_type: TransferType.TRANSFER },
    ]

    const messageHash = hashMessage("This is a fake EIP712 message hash for testing purposes")
    const signature = await account.sign({ hash: messageHash })
    const publicKey = await recoverPublicKey({hash: messageHash, signature})

    const circuitInputs = {
      pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
      pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
      signature: [...hexToBytes(signature).slice(0, 64)], // Remove recovery byte (v)
      hashed_message: [...hexToBytes(messageHash)],
      chain_id: "1",
      shielded_root: utxoMasterTree.root.toString(),
      wormhole_root: wormholeMasterTree.root.toString(),
      asset_id: assetId.toString(),
      owner_address: account.address,
      input_notes: inputNotes.map(note => ({
        chain_id: note.chain_id.toString(),
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        branch_index: note.branch_index.toString(),
        branch_siblings: note.branch_siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.branch_siblings.length).fill("0")),
        branch_root: note.branch_root.toString(),
        master_index: note.master_index.toString(),
        master_siblings: note.master_siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.master_siblings.length).fill("0")),
      })),
      output_notes: outputNotes.map(note => ({
        chain_id: note.chain_id.toString(),
        recipient: note.recipient.toString(),
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        transfer_type: note.transfer_type,
      })),
      wormhole_note: { 
        _is_some: true, 
        _value: { 
          dst_chain_id: "1",
          src_chain_id: "1",
          entry_id: "1",
          recipient: account.address.toString(), 
          wormhole_secret: wormholeSecret.toString(), 
          asset_id: assetId.toString(), 
          to: account.address.toString(),
          from: account.address.toString(), 
          amount: BigInt(100e18).toString(), 
          branch_index: wormholeProof.index.toString(),
          branch_siblings: wormholeProof.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - wormholeProof.siblings.length).fill("0")),
          branch_root: wormholeBranchTree.root.toString(),
          master_index: BigInt(masterWormholeProof.index).toString(),
          master_siblings: masterWormholeProof.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - masterWormholeProof.siblings.length).fill("0")),
          is_approved: true,
          confidential_type: ConfidentialType.NONE,
        } 
      },
      wormhole_pseudo_secret: { _is_some: false, _value: "0" },
    }

    const prover = new Prover("utxo_2x2")
    
    console.time("prove")
    const result = await prover.prove(circuitInputs)
    console.timeEnd("prove")

    console.time("verify")
    const isValid = await prover.verify(result)
    console.timeEnd("verify")
    expect(isValid).toBe(true)
    
    // Confirm proof outputs
    const expectedWormholeNullifier = getWormholeNullifier(wormholeNote)
    const expectedNullifiers = inputNotes.map(note => getNullifier(1n, utxoBranchTree.root, account.address, assetId, note))
    const expectedCommitments = outputNotes.map(note => getCommitment(assetId, note))
    const expectedHashedMessageOutputs = {
      hi: BigInt("0x" + messageHash.slice(2, 34)),
      lo: BigInt("0x" + messageHash.slice(34, 66)),
    }

    const actual = extractPublicInputs(result.publicInputs, inputNotes.length, outputNotes.length)

    expect(actual.chainId, "chain id public input mismatch").toBe(toHex(1n, { size: 32 }))
    expect(actual.shieldedRoot, "shielded root public input mismatch").toBe(toHex(utxoMasterTree.root, { size: 32 }))
    expect(actual.wormholeRoot, "wormhole root public input mismatch").toBe(toHex(wormholeBranchTree.root, { size: 32 }))
    expect(actual.hashedMessageHi, "hashed message hi public input mismatch").toBe(toHex(expectedHashedMessageOutputs.hi, { size: 32 }))
    expect(actual.hashedMessageLo, "hashed message lo public input mismatch").toBe(toHex(expectedHashedMessageOutputs.lo, { size: 32 }))
    expect(actual.wormholeNullifier, "wormhole nullifier public input mismatch").toBe(toHex(expectedWormholeNullifier, { size: 32 }))
    expect(actual.inputNullifiers, "input nullifiers public input mismatch").toEqual(expectedNullifiers.map(nullifier => toHex(nullifier, { size: 32 })))
    expect(actual.outputCommitments, "output commitments public input mismatch").toEqual(expectedCommitments.map(commitment => toHex(commitment, { size: 32 })))

    await verifyOnchain(result)
  }, { timeout: 10000 });
});