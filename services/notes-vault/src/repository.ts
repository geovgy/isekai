import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { shieldedNotes, shieldedTransferRequests, wormholeNotes } from "./schema";
import type {
  MasterTreeStatus,
  NoteDBShieldedEntry,
  NoteDBWormholeEntry,
  ShieldedTransferRequest,
  ShieldedStatus,
  WormholeStatus,
} from "./types";

type ShieldedFilters = {
  srcChainId?: number;
  dstChainId?: number;
  status?: ShieldedStatus;
  masterTreeStatus?: MasterTreeStatus;
};

type WormholeFilters = {
  srcChainId?: number;
  dstChainId?: number;
  status?: WormholeStatus;
  masterTreeStatus?: MasterTreeStatus;
};

function toShieldedRow(account: string, note: NoteDBShieldedEntry) {
  return {
    account,
    id: note.id,
    treeNumber: note.treeNumber,
    leafIndex: note.leafIndex,
    srcChainId: note.srcChainId,
    dstChainId: note.dstChainId,
    from: note.from,
    note: note.note,
    status: note.status,
    usedAt: note.usedAt,
    committedAt: note.committedAt,
    memo: note.memo,
    blockNumber: note.blockNumber,
    blockTimestamp: note.blockTimestamp,
    masterTreeStatus: note.masterTreeStatus,
  };
}

function toWormholeRow(account: string, note: NoteDBWormholeEntry) {
  return {
    account,
    id: note.id,
    entryId: note.entryId,
    treeNumber: note.treeNumber,
    leafIndex: note.leafIndex,
    srcChainId: note.srcChainId,
    dstChainId: note.dstChainId,
    entry: note.entry,
    status: note.status,
    usedAt: note.usedAt,
    memo: note.memo,
    blockNumber: note.blockNumber,
    blockTimestamp: note.blockTimestamp,
    masterTreeStatus: note.masterTreeStatus,
  };
}

function fromShieldedRow(row: typeof shieldedNotes.$inferSelect): NoteDBShieldedEntry {
  return {
    id: row.id,
    treeNumber: row.treeNumber,
    leafIndex: row.leafIndex,
    srcChainId: row.srcChainId,
    dstChainId: row.dstChainId,
    from: row.from as NoteDBShieldedEntry["from"],
    note: row.note as NoteDBShieldedEntry["note"],
    status: row.status as NoteDBShieldedEntry["status"],
    usedAt: row.usedAt ?? undefined,
    committedAt: row.committedAt ?? undefined,
    memo: row.memo ?? undefined,
    blockNumber: row.blockNumber ?? undefined,
    blockTimestamp: row.blockTimestamp ?? undefined,
    masterTreeStatus: row.masterTreeStatus as NoteDBShieldedEntry["masterTreeStatus"],
  };
}

function fromWormholeRow(row: typeof wormholeNotes.$inferSelect): NoteDBWormholeEntry {
  return {
    id: row.id,
    entryId: row.entryId,
    treeNumber: row.treeNumber,
    leafIndex: row.leafIndex,
    srcChainId: row.srcChainId,
    dstChainId: row.dstChainId,
    entry: row.entry as NoteDBWormholeEntry["entry"],
    status: row.status as NoteDBWormholeEntry["status"],
    usedAt: row.usedAt ?? undefined,
    memo: row.memo ?? undefined,
    blockNumber: row.blockNumber ?? undefined,
    blockTimestamp: row.blockTimestamp ?? undefined,
    masterTreeStatus: row.masterTreeStatus as NoteDBWormholeEntry["masterTreeStatus"],
  };
}

function toShieldedTransferRequestRow(account: string, request: ShieldedTransferRequest) {
  return {
    account,
    id: request.id,
    receiver: request.receiver,
    token: request.token,
    tokenId: request.tokenId,
    amount: request.amount,
    srcChainId: request.srcChainId,
    dstChainId: request.dstChainId,
    status: request.status,
    shieldedInputNotes: request.shieldedInputNotes,
    wormholeInputNote: request.wormholeInputNote,
    outputNotes: request.outputNotes,
    usedAt: request.usedAt,
  };
}

function fromShieldedTransferRequestRow(
  row: typeof shieldedTransferRequests.$inferSelect,
): ShieldedTransferRequest {
  return {
    id: row.id,
    account: row.account as ShieldedTransferRequest["account"],
    receiver: row.receiver as ShieldedTransferRequest["receiver"],
    token: row.token as ShieldedTransferRequest["token"],
    tokenId: row.tokenId ?? undefined,
    amount: row.amount,
    srcChainId: row.srcChainId,
    dstChainId: row.dstChainId,
    status: row.status,
    shieldedInputNotes: row.shieldedInputNotes as ShieldedTransferRequest["shieldedInputNotes"],
    wormholeInputNote: row.wormholeInputNote as ShieldedTransferRequest["wormholeInputNote"],
    outputNotes: row.outputNotes as ShieldedTransferRequest["outputNotes"],
    usedAt: row.usedAt ?? undefined,
  };
}

export async function listShieldedNotes(account: string, filters: ShieldedFilters = {}) {
  const conditions = [eq(shieldedNotes.account, account)];

  if (filters.srcChainId != null) conditions.push(eq(shieldedNotes.srcChainId, filters.srcChainId));
  if (filters.dstChainId != null) conditions.push(eq(shieldedNotes.dstChainId, filters.dstChainId));
  if (filters.status != null) conditions.push(eq(shieldedNotes.status, filters.status));
  if (filters.masterTreeStatus != null) {
    conditions.push(eq(shieldedNotes.masterTreeStatus, filters.masterTreeStatus));
  }

  const rows = await db
    .select()
    .from(shieldedNotes)
    .where(and(...conditions))
    .orderBy(shieldedNotes.srcChainId, shieldedNotes.treeNumber, shieldedNotes.leafIndex);

  return rows.map(fromShieldedRow);
}

export async function getShieldedNote(account: string, id: string) {
  const row = await db.query.shieldedNotes.findFirst({
    where: (table, { and, eq }) => and(eq(table.account, account), eq(table.id, id)),
  });

  return row ? fromShieldedRow(row) : null;
}

export async function createShieldedNote(account: string, note: NoteDBShieldedEntry) {
  await db.insert(shieldedNotes).values(toShieldedRow(account, note));
  return note;
}

export async function createShieldedNotes(account: string, notes: NoteDBShieldedEntry[]) {
  if (notes.length === 0) return [];
  await db.insert(shieldedNotes).values(notes.map(note => toShieldedRow(account, note)));
  return notes;
}

export async function replaceShieldedNote(account: string, id: string, note: NoteDBShieldedEntry) {
  const result = await db
    .update(shieldedNotes)
    .set(toShieldedRow(account, note))
    .where(and(eq(shieldedNotes.account, account), eq(shieldedNotes.id, id)))
    .returning();

  return result[0] ? fromShieldedRow(result[0]) : null;
}

export async function patchShieldedNote(
  account: string,
  id: string,
  patch: Partial<NoteDBShieldedEntry>,
) {
  const existing = await getShieldedNote(account, id);
  if (!existing) return null;

  const merged: NoteDBShieldedEntry = {
    ...existing,
    ...patch,
    note: patch.note ? { ...existing.note, ...patch.note } : existing.note,
  };

  return replaceShieldedNote(account, id, merged);
}

export async function deleteShieldedNote(account: string, id: string) {
  const result = await db
    .delete(shieldedNotes)
    .where(and(eq(shieldedNotes.account, account), eq(shieldedNotes.id, id)))
    .returning();

  return result[0] ? fromShieldedRow(result[0]) : null;
}

export async function listWormholeNotes(account: string, filters: WormholeFilters = {}) {
  const conditions = [eq(wormholeNotes.account, account)];

  if (filters.srcChainId != null) conditions.push(eq(wormholeNotes.srcChainId, filters.srcChainId));
  if (filters.dstChainId != null) conditions.push(eq(wormholeNotes.dstChainId, filters.dstChainId));
  if (filters.status != null) conditions.push(eq(wormholeNotes.status, filters.status));
  if (filters.masterTreeStatus != null) {
    conditions.push(eq(wormholeNotes.masterTreeStatus, filters.masterTreeStatus));
  }

  const rows = await db
    .select()
    .from(wormholeNotes)
    .where(and(...conditions))
    .orderBy(wormholeNotes.srcChainId, wormholeNotes.treeNumber, wormholeNotes.leafIndex);

  return rows.map(fromWormholeRow);
}

export async function getWormholeNote(account: string, id: string) {
  const row = await db.query.wormholeNotes.findFirst({
    where: (table, { and, eq }) => and(eq(table.account, account), eq(table.id, id)),
  });

  return row ? fromWormholeRow(row) : null;
}

export async function createWormholeNote(account: string, note: NoteDBWormholeEntry) {
  await db.insert(wormholeNotes).values(toWormholeRow(account, note));
  return note;
}

export async function createWormholeNotes(account: string, notes: NoteDBWormholeEntry[]) {
  if (notes.length === 0) return [];
  await db.insert(wormholeNotes).values(notes.map(note => toWormholeRow(account, note)));
  return notes;
}

export async function replaceWormholeNote(account: string, id: string, note: NoteDBWormholeEntry) {
  const result = await db
    .update(wormholeNotes)
    .set(toWormholeRow(account, note))
    .where(and(eq(wormholeNotes.account, account), eq(wormholeNotes.id, id)))
    .returning();

  return result[0] ? fromWormholeRow(result[0]) : null;
}

export async function patchWormholeNote(
  account: string,
  id: string,
  patch: Partial<NoteDBWormholeEntry>,
) {
  const existing = await getWormholeNote(account, id);
  if (!existing) return null;

  const merged: NoteDBWormholeEntry = {
    ...existing,
    ...patch,
    entry: patch.entry ? { ...existing.entry, ...patch.entry } : existing.entry,
  };

  return replaceWormholeNote(account, id, merged);
}

export async function deleteWormholeNote(account: string, id: string) {
  const result = await db
    .delete(wormholeNotes)
    .where(and(eq(wormholeNotes.account, account), eq(wormholeNotes.id, id)))
    .returning();

  return result[0] ? fromWormholeRow(result[0]) : null;
}

export async function createShieldedTransferRequest(
  account: string,
  request: ShieldedTransferRequest,
) {
  const rows = await db
    .insert(shieldedTransferRequests)
    .values(toShieldedTransferRequestRow(account, request))
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create shielded transfer request");
  }

  return fromShieldedTransferRequestRow(row);
}

export async function getShieldedTransferRequest(account: string, id: string) {
  const row = await db.query.shieldedTransferRequests.findFirst({
    where: (table, { and, eq }) => and(eq(table.account, account), eq(table.id, id)),
  });

  return row ? fromShieldedTransferRequestRow(row) : null;
}

export async function updateShieldedTransferRequestStatus(args: {
  account: string;
  id: string;
  status: string;
  markUsed?: boolean;
}) {
  return db.transaction(async tx => {
    const requestRow = await tx.query.shieldedTransferRequests.findFirst({
      where: (table, { and, eq }) => and(eq(table.account, args.account), eq(table.id, args.id)),
    });

    if (!requestRow) {
      return null;
    }

    const request = fromShieldedTransferRequestRow(requestRow);
    const usedAt = args.markUsed ? new Date().toISOString() : request.usedAt;

    const updatedRequestRows = await tx
      .update(shieldedTransferRequests)
      .set({
        status: args.status,
        usedAt,
      })
      .where(
        and(
          eq(shieldedTransferRequests.account, args.account),
          eq(shieldedTransferRequests.id, args.id),
        ),
      )
      .returning();

    const updatedRequestRow = updatedRequestRows[0];
    if (!updatedRequestRow) {
      throw new Error("Failed to update shielded transfer request");
    }

    let updatedShieldedNotes: NoteDBShieldedEntry[] = [];
    let updatedWormholeNote: NoteDBWormholeEntry | null = null;

    if (args.markUsed) {
      for (const note of request.shieldedInputNotes) {
        const [updatedRow] = await tx
          .update(shieldedNotes)
          .set({
            status: "used",
            usedAt,
          })
          .where(and(eq(shieldedNotes.account, args.account), eq(shieldedNotes.id, note.id)))
          .returning();

        if (updatedRow) {
          updatedShieldedNotes.push(fromShieldedRow(updatedRow));
        }
      }

      if (request.wormholeInputNote) {
        const [updatedRow] = await tx
          .update(wormholeNotes)
          .set({
            status: "completed",
            usedAt,
          })
          .where(
            and(
              eq(wormholeNotes.account, args.account),
              eq(wormholeNotes.id, request.wormholeInputNote.id),
            ),
          )
          .returning();

        if (updatedRow) {
          updatedWormholeNote = fromWormholeRow(updatedRow);
        }
      }
    }

    return {
      request: fromShieldedTransferRequestRow(updatedRequestRow),
      updatedShieldedNotes,
      updatedWormholeNote,
    };
  });
}
