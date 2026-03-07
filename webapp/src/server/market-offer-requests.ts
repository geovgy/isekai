import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import postgres from "postgres";
import type { Address, Hex } from "viem";

interface MarketOfferItem {
  dstChainId: string;
  token: string;
  tokenId: string;
  amount: string;
}

export interface MarketOffer {
  ask: MarketOfferItem;
  for: MarketOfferItem;
  status?: string | null;
  [key: string]: unknown;
}

// Matches the EIP-712 SignerDelegation shape used in `contracts` and `circuits`.
export interface MarketSignerDelegation {
  chainId: string;
  owner: Address;
  delegate: Address;
  startTime: string;
  endTime: string;
  token: Address;
  tokenId: string;
  amount: string;
  amountType: number;
  maxCumulativeAmount: string;
  maxNonce: string;
  timeInterval: string;
  transferType: number;
  [key: string]: unknown;
}

// String-friendly versions of the note payloads used in `circuits/src/types.ts`
// and `webapp/src/types.ts`.
export interface MarketInputNote {
  chain_id: string;
  blinding: string;
  amount: string;
  branch_index: string;
  branch_siblings: string[];
  branch_root: string;
  master_index: string;
  master_siblings: string[];
}

export interface MarketOutputNote {
  chain_id: string;
  recipient: Address | string;
  blinding: string;
  amount: string;
  transfer_type: number;
}

export interface MarketWormholeNote {
  dst_chain_id: string;
  src_chain_id: string;
  entry_id: string;
  recipient: Address;
  wormhole_secret: string;
  amount: string;
  // `webapp/src/types.ts`
  asset_id?: string;
  sender?: Address;
  // `circuits/src/types.ts`
  token?: string;
  token_id?: string;
  to?: Address;
  from?: Address;
  confidential_type?: number;
  // Present when a deposit/proof-oriented shape is sent instead of the base note.
  master_root?: string;
  branch_root?: string;
  branch_index?: string;
  branch_siblings?: string[];
  master_index?: string;
  master_siblings?: string[];
  is_approved?: boolean;
  [key: string]: unknown;
}

export interface MarketRequestNotes {
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
}

export const MARKET_ORDER_STATUSES = [
  "open",
  "fulfilled",
  "cancelled",
] as const;

export type MarketOrderStatus = (typeof MARKET_ORDER_STATUSES)[number];

export interface SaveMarketOfferRequestInput {
  offer: MarketOffer;
  offerStatus: MarketOrderStatus;
  makerAddress: Address;
  signerDelegation: MarketSignerDelegation;
  signature: Hex | string;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
}

export interface MarketOfferRequestRecord {
  id: string;
  makerAddress: Address;
  offer: MarketOffer;
  offerStatus: string;
  signerDelegation: MarketSignerDelegation | null;
  signature: string | null;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
  createdAt: Date;
  updatedAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDatabaseUrl() {
  const databaseUrl =
    process.env.MARKET_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;

  if (!databaseUrl) {
    throw new Error(
      "Database connection not configured. Set MARKET_DATABASE_URL, DATABASE_URL, or POSTGRES_URL.",
    );
  }

  return databaseUrl;
}

export const marketOfferRequests = pgTable("market_offer_requests", {
  id: text("id").primaryKey(),
  makerAddress: text("maker_address").$type<Address>().notNull(),
  offer: jsonb("offer").$type<MarketOffer>().notNull(),
  offerStatus: text("offer_status").notNull(),
  signerDelegation: jsonb("signer_delegation").$type<MarketSignerDelegation | null>(),
  signature: text("signature"),
  shieldedMasterRoot: text("shielded_master_root"),
  inputNotes: jsonb("input_notes").$type<MarketInputNote[] | null>(),
  outputNotes: jsonb("output_notes").$type<MarketOutputNote[] | null>(),
  wormholeNote: jsonb("wormhole_note").$type<MarketWormholeNote | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => drizzleSql`now()`),
});

let sqlClient: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof createDb> | undefined;

function getSql() {
  if (!sqlClient) {
    const databaseSslMode = process.env.DATABASE_SSL ?? process.env.PGSSLMODE;
    sqlClient = postgres(getDatabaseUrl(), {
      ssl: databaseSslMode && databaseSslMode !== "disable" ? "require" : undefined,
    });
  }

  return sqlClient;
}

function createDb() {
  return drizzle(getSql(), {
    schema: {
      marketOfferRequests,
    },
  });
}

function getDb() {
  if (!db) {
    db = createDb();
  }

  return db;
}

let ensureDatabasePromise: Promise<void> | undefined;

export function ensureMarketOfferRequestsTable() {
  if (!ensureDatabasePromise) {
    ensureDatabasePromise = (async () => {
      const sql = getSql();

      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS market_offer_requests (
          id text PRIMARY KEY,
          maker_address text NOT NULL,
          offer jsonb NOT NULL,
          offer_status text NOT NULL,
          signer_delegation jsonb,
          signature text,
          shielded_master_root text,
          input_notes jsonb,
          output_notes jsonb,
          wormhole_note jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await sql.unsafe(`
        ALTER TABLE market_offer_requests
        ADD COLUMN IF NOT EXISTS maker_address text
      `);

      await sql.unsafe(`
        UPDATE market_offer_requests
        SET maker_address = signer_delegation->>'owner'
        WHERE maker_address IS NULL
      `);

      await sql.unsafe(`
        ALTER TABLE market_offer_requests
        ADD COLUMN IF NOT EXISTS shielded_master_root text
      `);

      await sql.unsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'market_offer_requests'
              AND column_name = 'input_notes_master_root'
          ) THEN
            EXECUTE '
              UPDATE market_offer_requests
              SET shielded_master_root = COALESCE(shielded_master_root, input_notes_master_root)
            ';
          END IF;
        END
        $$;
      `);

      await sql.unsafe(`
        ALTER TABLE market_offer_requests
        ALTER COLUMN signer_delegation DROP NOT NULL,
        ALTER COLUMN signature DROP NOT NULL,
        ALTER COLUMN input_notes DROP NOT NULL,
        ALTER COLUMN output_notes DROP NOT NULL
      `);

      await sql.unsafe(`
        CREATE INDEX IF NOT EXISTS market_offer_requests_offer_status_idx
          ON market_offer_requests (offer_status)
      `);

      await sql.unsafe(`
        CREATE INDEX IF NOT EXISTS market_offer_requests_created_at_idx
          ON market_offer_requests (created_at DESC)
      `);
    })();
  }

  return ensureDatabasePromise;
}

function toMarketOrderStatus(status: string): MarketOrderStatus | null {
  const normalizedStatus = status.trim().toLowerCase();

  switch (normalizedStatus) {
    case "open":
    case "pending":
      return "open";
    case "fulfilled":
    case "complete":
    case "completed":
      return "fulfilled";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

export function normalizeOfferStatus(body: unknown, offer: MarketOffer): MarketOrderStatus {
  if (isRecord(body)) {
    const directStatus = body.offerStatus ?? body.offer_status;
    if (typeof directStatus === "string" && directStatus.length > 0) {
      return toMarketOrderStatus(directStatus) ?? "open";
    }
  }

  if (typeof offer.status === "string" && offer.status.length > 0) {
    return toMarketOrderStatus(offer.status) ?? "open";
  }

  return "open";
}

export function normalizeNotes(notes: unknown): MarketRequestNotes {
  if (!isRecord(notes)) {
    return {
      shieldedMasterRoot: null,
      inputNotes: null,
      outputNotes: null,
      wormholeNote: null,
    };
  }

  const shieldedMasterRoot =
    notes.inputNotesMasterRoot ??
    notes.input_notes_master_root ??
    notes.masterTreeRoot ??
    notes.master_tree_root ??
    notes.shieldedRoot ??
    notes.shielded_root ??
    null;
  const inputNotes = notes.inputNotes ?? notes.input_notes ?? [];
  const outputNotes = notes.outputNotes ?? notes.output_notes ?? [];
  const wormholeNote = notes.wormholeNote ?? notes.wormhole_note ?? null;

  return {
    shieldedMasterRoot:
      typeof shieldedMasterRoot === "string" ? shieldedMasterRoot : null,
    inputNotes: Array.isArray(inputNotes) ? (inputNotes as MarketInputNote[]) : null,
    outputNotes: Array.isArray(outputNotes) ? (outputNotes as MarketOutputNote[]) : null,
    wormholeNote: isRecord(wormholeNote) ? (wormholeNote as MarketWormholeNote) : null,
  };
}

export function parseMarketOrderStatusFilters(
  values: Iterable<string>,
): { filters: MarketOrderStatus[]; invalid: string[] } {
  const filters = new Set<MarketOrderStatus>();
  const invalid = new Set<string>();

  for (const value of values) {
    for (const part of value.split(",")) {
      const candidate = part.trim();
      if (candidate.length === 0) {
        continue;
      }

      const normalizedStatus = toMarketOrderStatus(candidate);
      if (normalizedStatus) {
        filters.add(normalizedStatus);
      } else {
        invalid.add(candidate);
      }
    }
  }

  return {
    filters: [...filters],
    invalid: [...invalid],
  };
}

export async function saveMarketOfferRequest(input: SaveMarketOfferRequestInput) {
  await ensureMarketOfferRequestsTable();

  const [record] = await getDb()
    .insert(marketOfferRequests)
    .values({
      id: randomUUID(),
      makerAddress: input.makerAddress,
      offer: input.offer,
      offerStatus: input.offerStatus,
      signerDelegation: input.signerDelegation,
      signature: input.signature,
      shieldedMasterRoot: input.shieldedMasterRoot,
      inputNotes: input.inputNotes,
      outputNotes: input.outputNotes,
      wormholeNote: input.wormholeNote,
    })
    .returning({
      id: marketOfferRequests.id,
      makerAddress: marketOfferRequests.makerAddress,
      offerStatus: marketOfferRequests.offerStatus,
      createdAt: marketOfferRequests.createdAt,
    });

  return record;
}

export async function listMarketOfferRequests(
  filters?: MarketOrderStatus[],
): Promise<MarketOfferRequestRecord[]> {
  await ensureMarketOfferRequestsTable();

  const query = getDb()
    .select({
      id: marketOfferRequests.id,
      makerAddress: marketOfferRequests.makerAddress,
      offer: marketOfferRequests.offer,
      offerStatus: marketOfferRequests.offerStatus,
      signerDelegation: marketOfferRequests.signerDelegation,
      signature: marketOfferRequests.signature,
      shieldedMasterRoot: marketOfferRequests.shieldedMasterRoot,
      inputNotes: marketOfferRequests.inputNotes,
      outputNotes: marketOfferRequests.outputNotes,
      wormholeNote: marketOfferRequests.wormholeNote,
      createdAt: marketOfferRequests.createdAt,
      updatedAt: marketOfferRequests.updatedAt,
    })
    .from(marketOfferRequests)
    .orderBy(desc(marketOfferRequests.createdAt));

  if (filters && filters.length > 0) {
    return await query.where(inArray(marketOfferRequests.offerStatus, filters));
  }

  return await query;
}

export async function cancelOpenMarketOfferRequest(id: string) {
  await ensureMarketOfferRequestsTable();

  const [record] = await getDb()
    .update(marketOfferRequests)
    .set({
      offerStatus: "cancelled",
      signerDelegation: null,
      signature: null,
      shieldedMasterRoot: null,
      inputNotes: null,
      outputNotes: null,
      wormholeNote: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(marketOfferRequests.id, id),
        eq(marketOfferRequests.offerStatus, "open"),
      ),
    )
    .returning({
      id: marketOfferRequests.id,
      makerAddress: marketOfferRequests.makerAddress,
      offerStatus: marketOfferRequests.offerStatus,
      updatedAt: marketOfferRequests.updatedAt,
    });

  return record ?? null;
}

export async function getMarketOfferRequestStatus(id: string) {
  await ensureMarketOfferRequestsTable();

  const [record] = await getDb()
    .select({
      id: marketOfferRequests.id,
      makerAddress: marketOfferRequests.makerAddress,
      offerStatus: marketOfferRequests.offerStatus,
    })
    .from(marketOfferRequests)
    .where(eq(marketOfferRequests.id, id))
    .limit(1);

  return record ?? null;
}
