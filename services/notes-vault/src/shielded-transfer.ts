import { randomBytes } from "node:crypto";
import { isAddressEqual, type Address } from "viem";
import { listShieldedNotes, listWormholeNotes } from "./repository";
import type {
  NoteDBShieldedEntry,
  NoteDBWormholeEntry,
  ShieldedTransferRequestOutputNote,
} from "./types";
import { TransferType } from "./types";

function getRandomBlinding() {
  return BigInt(`0x${randomBytes(32).toString("hex")}`).toString();
}

export function createShieldedTransferOutputNotes(args: {
  dstChainId: number;
  srcChainId: number;
  sender: Address;
  receiver: Address;
  amount: bigint;
  notes: {
    wormhole?: NoteDBWormholeEntry;
    shielded?: NoteDBShieldedEntry[];
  };
}): ShieldedTransferRequestOutputNote[] {
  const totalAmountIn =
    (args.notes.shielded?.reduce((total, note) => total + BigInt(note.note.amount), 0n) ?? 0n) +
    BigInt(args.notes.wormhole?.entry.amount ?? "0");

  if (totalAmountIn < args.amount) {
    throw new Error(`amount exceeds total amount from input notes: ${totalAmountIn} < ${args.amount}`);
  }

  return [
    {
      chain_id: args.srcChainId,
      recipient: args.sender,
      blinding: getRandomBlinding(),
      amount: (totalAmountIn - args.amount).toString(),
      transfer_type: TransferType.TRANSFER,
    },
    {
      chain_id: args.dstChainId,
      recipient: args.receiver,
      blinding: getRandomBlinding(),
      amount: args.amount.toString(),
      transfer_type: TransferType.TRANSFER,
    },
  ];
}

export async function getShieldedTransferInputEntries(args: {
  account: Address;
  srcChainId: number;
  token: Address;
  tokenId?: string;
  amount: bigint;
}) {
  const wormholeDeposits = (await listWormholeNotes(args.account)).filter(w => (
    w.dstChainId === args.srcChainId &&
    w.status === "approved" &&
    w.masterTreeStatus === "included" &&
    !w.usedAt &&
    isAddressEqual(w.entry.token, args.token) &&
    BigInt(w.entry.token_id ?? "0") === BigInt(args.tokenId ?? "0")
  ));

  const onlyWormhole = wormholeDeposits.find(w => BigInt(w.entry.amount ?? "0") >= args.amount);
  if (onlyWormhole) {
    return {
      wormhole: onlyWormhole,
      shielded: [] as NoteDBShieldedEntry[],
    };
  }

  const shieldedNotes = (await listShieldedNotes(args.account)).filter(s => (
    s.dstChainId === args.srcChainId &&
    s.status === "available" &&
    s.masterTreeStatus === "included" &&
    isAddressEqual(s.note.asset, args.token) &&
    BigInt(s.note.assetId ?? "0") === BigInt(args.tokenId ?? "0") &&
    isAddressEqual(s.note.account, args.account)
  ));

  const shieldedBalance = shieldedNotes.reduce((total, input) => total + BigInt(input.note.amount ?? "0"), 0n);
  if (shieldedBalance < args.amount) {
    let hasFunds = false;
    for (const wormholeNote of wormholeDeposits) {
      const depositAmount = BigInt(wormholeNote.entry.amount ?? "0");
      if (depositAmount + shieldedBalance >= args.amount) {
        hasFunds = true;
        break;
      }
    }
    if (!hasFunds) {
      throw new Error("Insufficient funds for transfer");
    }
  }

  let wormhole: NoteDBWormholeEntry | undefined;
  let shielded: NoteDBShieldedEntry[] = [];

  if (wormholeDeposits.length > 0) {
    for (const wormholeNote of wormholeDeposits) {
      const depositAmount = BigInt(wormholeNote.entry.amount ?? "0");
      for (const note1 of shieldedNotes) {
        const note1Amount = BigInt(note1.note.amount ?? "0");
        if (note1Amount + depositAmount >= args.amount) {
          wormhole = wormholeNote;
          shielded = [note1];
          break;
        }

        const otherNotes = shieldedNotes.filter(n => n.id !== note1.id && n.treeNumber === note1.treeNumber);
        for (const note2 of otherNotes) {
          const note2Amount = BigInt(note2.note.amount ?? "0");
          if (note1Amount + note2Amount + depositAmount >= args.amount) {
            wormhole = wormholeNote;
            shielded = [note1, note2];
            break;
          }
        }

        if (wormhole) break;
      }

      if (wormhole) break;
    }
  } else {
    for (const note1 of shieldedNotes) {
      if (BigInt(note1.note.amount ?? "0") >= args.amount) {
        shielded = [note1];
        break;
      }

      const otherNotes = shieldedNotes.filter(n => n.id !== note1.id && n.treeNumber === note1.treeNumber);
      for (const note2 of otherNotes) {
        if (BigInt(note1.note.amount ?? "0") + BigInt(note2.note.amount ?? "0") >= args.amount) {
          shielded = [note1, note2];
          break;
        }
      }

      if (shielded.length > 0) break;
    }
  }

  if (!wormhole && shielded.length === 0) {
    throw new Error("No available notes for transfer");
  }

  return { wormhole, shielded };
}
