import { describe, it, expect } from "bun:test";
import { getMerkleTree } from "../src/merkle";
import { getCommitment, getNullifier, getWormholeBurnCommitment, getWormholeNullifier, getWormholePseudoNullifier } from "../src/joinsplits";
import { Prover } from "../src/prover";
import { privateKeyToAccount } from "viem/accounts";
import { ConfidentialType, TransferType, type InputNote, type OutputNote, type WormholeNote } from "../src/types";
import { BN254_PRIME } from "../src/constants";
import { hashMessage, hexToBytes, pad, recoverPublicKey, toHex } from "viem";

const MERKLE_TREE_DEPTH = 20

function extractPublicInputs(result: string[]) {
  return {
    wormholeRoot: result[0]!,
    wormholeCommitment: result[1]!,
    wormholeNullifier: result[2]!,
    wormholeSender: result[3]!,
  }
}

describe("ragequit", () => {
  const token = 1n
  const tokenId = 0n
  const sender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
  const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
  
  it("should get ragequit proof", async () => {
    const wormholeSecret = 42069n
    const wormholeNote: WormholeNote = {
      dst_chain_id: 1n,
      src_chain_id: 1n,
      entry_id: 1n,
      recipient,
      wormhole_secret: wormholeSecret,
      token,
      token_id: tokenId,
      from: sender,
      to: recipient,
      amount: BigInt(100e18),
      confidential_type: ConfidentialType.NONE,
    }

    const burnCommitment = getWormholeBurnCommitment({
      ...wormholeNote,
      approved: false,
    })

    const wormholeTree = getMerkleTree([burnCommitment])
    const wormholeMasterTree = getMerkleTree([wormholeTree.root])

    const wormholeProof = wormholeTree.generateProof(0)
    const wormholeMasterProof = wormholeMasterTree.generateProof(0)

    const circuitInputs = {
      wormhole_master_root: wormholeTree.root.toString(),
      wormhole_note: { 
        dst_chain_id: wormholeNote.dst_chain_id.toString(),
        src_chain_id: wormholeNote.src_chain_id.toString(),
        entry_id: wormholeNote.entry_id.toString(),
        recipient: wormholeNote.recipient.toString(), 
        wormhole_secret: wormholeNote.wormhole_secret.toString(), 
        token: token.toString(),
        token_id: tokenId.toString(),
        to: wormholeNote.to.toString(),
        from: wormholeNote.from.toString(), 
        amount: wormholeNote.amount.toString(), 
        branch_index: wormholeProof.index.toString(),
        branch_siblings: wormholeProof.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - wormholeProof.siblings.length).fill("0")),
        branch_root: wormholeProof.root.toString(),
        master_index: wormholeMasterProof.index.toString(),
        master_siblings: wormholeMasterProof.siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - wormholeMasterProof.siblings.length).fill("0")),
        is_approved: false,
        confidential_type: wormholeNote.confidential_type,
      },
    }

    const prover = new Prover("ragequit")
    
    console.time("prove")
    const result = await prover.prove(circuitInputs)
    console.timeEnd("prove")

    console.time("verify")
    const isValid = await prover.verify(result)
    console.timeEnd("verify")
    expect(isValid).toBe(true)
    
    // Confirm proof outputs
    const expectedWormholeNullifier = getWormholeNullifier(wormholeNote)

    const actual = extractPublicInputs(result.publicInputs)
    expect(actual.wormholeRoot, "wormhole root public input mismatch").toBe(toHex(wormholeMasterTree.root, { size: 32 }))
    expect(actual.wormholeCommitment, "wormhole commitment public input mismatch").toBe(toHex(burnCommitment, { size: 32 }))
    expect(actual.wormholeNullifier, "wormhole nullifier public input mismatch").toBe(toHex(expectedWormholeNullifier, { size: 32 }))
    expect(actual.wormholeSender, "wormhole sender public input mismatch").toBe(pad(wormholeNote.from, { size: 32 }).toLowerCase())
  });
});