import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { NoteDBShieldedEntry, NoteDBWormholeEntry, ShieldedTransferRequest, ShieldedTransferRequestOutputNote } from "./types";

export const shieldedNotes = pgTable(
  "shielded_notes",
  {
    account: text("account").notNull(),
    id: text("id").notNull(),
    treeNumber: integer("tree_number").notNull(),
    leafIndex: integer("leaf_index").notNull(),
    srcChainId: integer("src_chain_id").notNull(),
    dstChainId: integer("dst_chain_id").notNull(),
    from: text("from_address"),
    note: jsonb("note").$type<NoteDBShieldedEntry["note"]>().notNull(),
    status: text("status"),
    usedAt: text("used_at"),
    committedAt: text("committed_at"),
    memo: text("memo"),
    blockNumber: integer("block_number"),
    blockTimestamp: integer("block_timestamp"),
    masterTreeStatus: text("master_tree_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  },
  table => [
    primaryKey({
      name: "shielded_notes_account_id_pk",
      columns: [table.account, table.id],
    }),
  ],
);

export const wormholeNotes = pgTable(
  "wormhole_notes",
  {
    account: text("account").notNull(),
    id: text("id").notNull(),
    entryId: text("entry_id").notNull(),
    treeNumber: integer("tree_number").notNull(),
    leafIndex: integer("leaf_index").notNull(),
    srcChainId: integer("src_chain_id").notNull(),
    dstChainId: integer("dst_chain_id").notNull(),
    entry: jsonb("entry").$type<NoteDBWormholeEntry["entry"]>().notNull(),
    status: text("status"),
    usedAt: text("used_at"),
    memo: text("memo"),
    blockNumber: integer("block_number"),
    blockTimestamp: integer("block_timestamp"),
    masterTreeStatus: text("master_tree_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  },
  table => [
    primaryKey({
      name: "wormhole_notes_account_id_pk",
      columns: [table.account, table.id],
    }),
  ],
);

export const shieldedTransferRequests = pgTable(
  "shielded_transfer_requests",
  {
    account: text("account").notNull(),
    id: text("id").notNull(),
    receiver: text("receiver").notNull(),
    token: text("token").notNull(),
    tokenId: text("token_id"),
    amount: text("amount").notNull(),
    srcChainId: integer("src_chain_id").notNull(),
    dstChainId: integer("dst_chain_id").notNull(),
    status: text("status").notNull(),
    shieldedInputNotes: jsonb("shielded_input_notes").$type<ShieldedTransferRequest["shieldedInputNotes"]>().notNull(),
    wormholeInputNote: jsonb("wormhole_input_note").$type<ShieldedTransferRequest["wormholeInputNote"]>(),
    outputNotes: jsonb("output_notes").$type<ShieldedTransferRequestOutputNote[]>().notNull(),
    usedAt: text("used_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  },
  table => [
    primaryKey({
      name: "shielded_transfer_requests_account_id_pk",
      columns: [table.account, table.id],
    }),
  ],
);
