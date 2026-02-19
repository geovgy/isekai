import { Address, bytesToBigInt, isAddressEqual } from "viem"
import { NoteDB } from "@/src/storage/notes-db"
import { NoteDBShieldedEntry, NoteDBWormholeEntry, OutputNote, TransferType } from "@/src/types"
import { randomBytes } from "@aztec/bb.js";
import { getRandomBlinding } from "../joinsplits";

export function createShieldedTransferOutputNotes(args: {
  chainId: bigint,
  sender: Address,
  receiver: Address,
  amount: bigint,
  transferType: TransferType,
  notes: {
    wormhole?: NoteDBWormholeEntry | undefined,
    shielded?: NoteDBShieldedEntry[],
  },
}): OutputNote[] {
  const { chainId, sender, receiver, amount, transferType, notes } = args

  const totalAmountIn = 
    (notes.shielded?.reduce((total, note) => total + BigInt(note.note.amount), BigInt(0)) ?? 0n)
    + BigInt(notes.wormhole?.entry.amount ?? 0n);
  
  if (totalAmountIn < amount) {
    throw new Error(`amount exceeds total amount from input notes: ${totalAmountIn} < ${amount}`)
  }

  return [
    { chain_id: chainId, recipient: sender, blinding: getRandomBlinding(), amount: totalAmountIn - amount, transfer_type: TransferType.TRANSFER },
    { chain_id: chainId, recipient: receiver, blinding: getRandomBlinding(), amount, transfer_type: transferType },
  ]
}

export async function getShieldedTransferInputEntries(
  _db: NoteDB, 
  args: {
    chainId: number,
    sender: Address,
    receiver: Address,
    token: Address,
    tokenId?: bigint,
    amount: bigint,
  }
): Promise<{ wormhole: NoteDBWormholeEntry | undefined, shielded: NoteDBShieldedEntry[] }> {
  const wormholeDeposits = (await _db.getWormholeNotes()).filter(w => (
    w.dstChainId === args.chainId
    && w.status === "approved"
    && w.masterTreeStatus === "included"
    && !w.usedAt
    && isAddressEqual(w.entry.token, args.token)
    && BigInt(w.entry.token_id ?? "0") === BigInt(args.tokenId ?? "0")
  ))

  const onlyWormhole = wormholeDeposits.find(w => BigInt(w.entry.amount ?? "0") >= args.amount)

  if (onlyWormhole) {
    return {
      wormhole: onlyWormhole,
      shielded: []
    }
  }

  const shieldedNotes = (await _db.getShieldedNotes()).filter(s => (
    s.dstChainId === args.chainId
    && s.status === "available"
    && s.masterTreeStatus === "included"
    && isAddressEqual(s.note.asset, args.token)
    && BigInt(s.note.assetId ?? "0") === BigInt(args.tokenId ?? "0")
    && isAddressEqual(s.note.account, args.sender)
  ))

  const shieldedBalance = shieldedNotes.reduce((total, input) => total + BigInt(input.note.amount ?? "0"), BigInt(0))
  if (shieldedBalance < args.amount) {
    let hasFunds = false
    for (const w of wormholeDeposits) {
      const depositAmount = BigInt(w.entry.amount ?? "0")
      if (depositAmount + shieldedBalance >= args.amount) {
        hasFunds = true
        break
      }
    }
    if (!hasFunds) {
      throw new Error(`Insufficient funds for transfer`)
    }
  }
  
  let wormhole: NoteDBWormholeEntry | undefined = undefined
  let shielded: NoteDBShieldedEntry[] = []
  if (wormholeDeposits.length > 0) {
    for (const wormholeNote of wormholeDeposits) {
      const depositAmount = BigInt(wormholeNote.entry.amount ?? "0")
      for (const note1 of shieldedNotes) {
        const note1Amount = BigInt(note1.note.amount ?? "0")
        if (note1Amount + depositAmount >= args.amount) {
          wormhole = wormholeNote
          shielded = [note1]
          break
        }
        const otherNotes = shieldedNotes.filter(n => n.id !== note1.id && n.treeNumber === note1.treeNumber)
        for (const note2 of otherNotes) {
          const note2Amount = BigInt(note2.note.amount ?? "0")
          if (note1Amount + note2Amount + depositAmount >= args.amount) {
            wormhole = wormholeNote
            shielded = [note1, note2]
            break
          }
        }
      }
    }  
  } else {
    for (const note1 of shieldedNotes) {
      if (BigInt(note1.note.amount ?? "0") >= args.amount) {
        shielded.push(note1)
        break
      }
      const otherNotes = shieldedNotes.filter(n => n.id !== note1.id && n.treeNumber === note1.treeNumber)
      for (const note2 of otherNotes) {
        if (BigInt(note1.note.amount ?? "0") + BigInt(note2.note.amount ?? "0") >= args.amount) {
          shielded.push(note1, note2)
          break
        }
      }
    }
  }

  if (!wormhole && !shielded.length) {
    throw new Error(`No available notes for transfer`)
  }
  
  return { wormhole, shielded }
}