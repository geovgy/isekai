import "server-only";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
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
  asset_id?: string;
  sender?: Address;
  token?: string;
  token_id?: string;
  to?: Address;
  from?: Address;
  confidential_type?: number;
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
  signerDelegation: MarketSignerDelegation | null;
  signature: Hex | string | null;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
}

export interface MarketOfferRequestRecord {
  id: string;
  makerAddress: Address | null;
  offer: MarketOffer;
  offerStatus: string;
  signerDelegation: MarketSignerDelegation | null;
  signature: string | null;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getConvexUrl() {
  const convexUrl =
    process.env.CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error(
      "Convex connection not configured. Set CONVEX_URL or NEXT_PUBLIC_CONVEX_URL.",
    );
  }

  return convexUrl;
}

let convexClient: ConvexHttpClient | undefined;

function getConvexClient() {
  if (!convexClient) {
    convexClient = new ConvexHttpClient(getConvexUrl());
  }

  return convexClient;
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

function mapRecord(record: {
  _id?: string;
  id?: string;
  makerAddress?: Address | null;
  offer: MarketOffer;
  offerStatus: string;
  signerDelegation: MarketSignerDelegation | null;
  signature: string | null;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
  createdAt: number;
  updatedAt: number;
}): MarketOfferRequestRecord {
  return {
    id: record.id ?? record._id ?? "",
    makerAddress: record.makerAddress ?? null,
    offer: record.offer,
    offerStatus: record.offerStatus,
    signerDelegation: record.signerDelegation,
    signature: record.signature,
    shieldedMasterRoot: record.shieldedMasterRoot,
    inputNotes: record.inputNotes,
    outputNotes: record.outputNotes,
    wormholeNote: record.wormholeNote,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
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
  const record = await getConvexClient().mutation(api.marketOffers.createOffer, {
    makerAddress: input.makerAddress,
    offer: input.offer,
    offerStatus: input.offerStatus,
    signerDelegation: input.signerDelegation,
    signature: input.signature ? String(input.signature) : null,
    shieldedMasterRoot: input.shieldedMasterRoot,
    inputNotes: input.inputNotes,
    outputNotes: input.outputNotes,
    wormholeNote: input.wormholeNote,
  });

  return mapRecord(record as Parameters<typeof mapRecord>[0]);
}

export async function listMarketOfferRequests(
  filters?: MarketOrderStatus[],
): Promise<MarketOfferRequestRecord[]> {
  const records = await getConvexClient().query(api.marketOffers.listOffers, {
    filters: filters ?? [],
  });

  return (records as Parameters<typeof mapRecord>[0][]).map(mapRecord);
}

export async function cancelOpenMarketOfferRequest(id: string) {
  const record = await getConvexClient().mutation(api.marketOffers.cancelOpenOffer, {
    id: id as Id<"marketOrders">,
  });

  return record ? mapRecord(record as Parameters<typeof mapRecord>[0]) : null;
}

export async function getMarketOfferRequestStatus(id: string) {
  const record = await getConvexClient().query(api.marketOffers.getOfferStatus, {
    id: id as Id<"marketOrders">,
  });

  if (!record) {
    return null;
  }

  return {
    id: record.id,
    makerAddress: record.makerAddress,
    offerStatus: record.offerStatus,
  };
}
