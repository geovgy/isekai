import "server-only";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  MarketFulfillmentExecutionPayload,
  MarketSignerNoteStatePayload,
} from "@/src/types";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import { ConvexHttpClient } from "convex/browser";
import { zeroAddress, type Address, type Hex } from "viem";

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
  recipient: Address;
  recipientLocked: boolean;
  startTime: string;
  endTime: string;
  token: Address;
  tokenLocked: boolean;
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
  "pending",
  "fulfilled",
  "cancelled",
] as const;

export type MarketOrderStatus = (typeof MARKET_ORDER_STATUSES)[number];
const FULFILL_LINK_PREFIX = "fulfill:";

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
  fulfillerSignerDelegation?: MarketSignerDelegation | null;
  fulfillerSignature?: string | null;
  fulfillerShieldedMasterRoot?: string | null;
  fulfillerInputNotes?: MarketInputNote[] | null;
  fulfillerOutputNotes?: MarketOutputNote[] | null;
  fulfillerWormholeNote?: MarketWormholeNote | null;
  executionTxHash?: string | null;
  executionBlockNumber?: string | null;
  makerSignerStateBefore?: MarketSignerNoteStatePayload | null;
  makerSignerStateAfter?: MarketSignerNoteStatePayload | null;
  fulfillerSignerStateBefore?: MarketSignerNoteStatePayload | null;
  fulfillerSignerStateAfter?: MarketSignerNoteStatePayload | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompleteMarketFulfillmentInput {
  id: string;
  makerOutputNotes: MarketOutputNote[] | null;
  signerDelegation: MarketSignerDelegation;
  signature: Hex | string;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
  execution: MarketFulfillmentExecutionPayload;
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
      return "open";
    case "pending":
      return "pending";
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

function hasFulfillerData(record: {
  fulfillerSignerDelegation?: MarketSignerDelegation | null;
  fulfillerSignature?: string | null;
  fulfillerShieldedMasterRoot?: string | null;
  fulfillerInputNotes?: MarketInputNote[] | null;
  fulfillerOutputNotes?: MarketOutputNote[] | null;
  fulfillerWormholeNote?: MarketWormholeNote | null;
}) {
  return Boolean(
    record.fulfillerSignerDelegation
      || record.fulfillerSignature
      || record.fulfillerShieldedMasterRoot
      || (record.fulfillerInputNotes && record.fulfillerInputNotes.length > 0)
      || (record.fulfillerOutputNotes && record.fulfillerOutputNotes.length > 0)
      || record.fulfillerWormholeNote,
  );
}

function deriveOfferStatus(record: {
  offerStatus: string;
  fulfillerSignerDelegation?: MarketSignerDelegation | null;
  fulfillerSignature?: string | null;
  fulfillerShieldedMasterRoot?: string | null;
  fulfillerInputNotes?: MarketInputNote[] | null;
  fulfillerOutputNotes?: MarketOutputNote[] | null;
  fulfillerWormholeNote?: MarketWormholeNote | null;
}) {
  const normalized = toMarketOrderStatus(record.offerStatus) ?? record.offerStatus;
  if (normalized === "fulfilled" || normalized === "cancelled") {
    return normalized;
  }
  if (hasFulfillerData(record)) {
    return "pending";
  }
  return normalized;
}

function getFulfillSourceOrderId(record: {
  offer: MarketOffer;
  offerStatus: string;
}) {
  if (record.offerStatus !== "pending") {
    return null;
  }
  const marker = typeof record.offer.status === "string" ? record.offer.status : null;
  if (!marker?.startsWith(FULFILL_LINK_PREFIX)) {
    return null;
  }
  const sourceId = marker.slice(FULFILL_LINK_PREFIX.length).trim();
  return sourceId.length > 0 ? sourceId : null;
}

function trimTrailingZeroSiblings(siblings: string[]) {
  let end = siblings.length;
  while (end > 0 && BigInt(siblings[end - 1]!) === 0n) {
    end -= 1;
  }
  return siblings.slice(0, end);
}

function computeRootFromProof(leaf: bigint, index: bigint, siblings: string[]) {
  let node = leaf;
  let currentIndex = index;
  for (const siblingString of trimTrailingZeroSiblings(siblings)) {
    const sibling = BigInt(siblingString);
    node = currentIndex % 2n === 0n
      ? poseidon2Hash([node, sibling])
      : poseidon2Hash([sibling, node]);
    currentIndex /= 2n;
  }
  return node;
}

export function inferShieldedMasterRootFromInputNotes(inputNotes: MarketInputNote[] | null | undefined) {
  const notes = (inputNotes ?? []).filter(note => BigInt(note.amount) > 0n);
  if (notes.length === 0) {
    return null;
  }

  const roots = new Set(
    notes.map(note =>
      computeRootFromProof(
        BigInt(note.branch_root),
        BigInt(note.master_index),
        note.master_siblings,
      ).toString(),
    ),
  );

  if (roots.size !== 1) {
    throw new Error("Inconsistent shielded master roots derived from stored input notes");
  }

  return [...roots][0] ?? null;
}

function safeInferShieldedMasterRootFromInputNotes(inputNotes: MarketInputNote[] | null | undefined) {
  try {
    return inferShieldedMasterRootFromInputNotes(inputNotes);
  } catch {
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
  fulfillerSignerDelegation?: MarketSignerDelegation | null;
  fulfillerSignature?: string | null;
  fulfillerShieldedMasterRoot?: string | null;
  fulfillerInputNotes?: MarketInputNote[] | null;
  fulfillerOutputNotes?: MarketOutputNote[] | null;
  fulfillerWormholeNote?: MarketWormholeNote | null;
  executionTxHash?: string | null;
  executionBlockNumber?: string | null;
  makerSignerStateBefore?: MarketSignerNoteStatePayload | null;
  makerSignerStateAfter?: MarketSignerNoteStatePayload | null;
  fulfillerSignerStateBefore?: MarketSignerNoteStatePayload | null;
  fulfillerSignerStateAfter?: MarketSignerNoteStatePayload | null;
  createdAt: number;
  updatedAt: number;
}): MarketOfferRequestRecord {
  return {
    id: record.id ?? record._id ?? "",
    makerAddress: record.makerAddress ?? null,
    offer: record.offer,
    offerStatus: deriveOfferStatus(record),
    signerDelegation: record.signerDelegation,
    signature: record.signature,
    shieldedMasterRoot: record.shieldedMasterRoot ?? safeInferShieldedMasterRootFromInputNotes(record.inputNotes),
    inputNotes: record.inputNotes,
    outputNotes: record.outputNotes,
    wormholeNote: record.wormholeNote,
    fulfillerSignerDelegation: record.fulfillerSignerDelegation ?? null,
    fulfillerSignature: record.fulfillerSignature ?? null,
    fulfillerShieldedMasterRoot:
      record.fulfillerShieldedMasterRoot
      ?? safeInferShieldedMasterRootFromInputNotes(record.fulfillerInputNotes)
      ?? null,
    fulfillerInputNotes: record.fulfillerInputNotes ?? null,
    fulfillerOutputNotes: record.fulfillerOutputNotes ?? null,
    fulfillerWormholeNote: record.fulfillerWormholeNote ?? null,
    executionTxHash: record.executionTxHash ?? null,
    executionBlockNumber: record.executionBlockNumber ?? null,
    makerSignerStateBefore: record.makerSignerStateBefore ?? null,
    makerSignerStateAfter: record.makerSignerStateAfter ?? null,
    fulfillerSignerStateBefore: record.fulfillerSignerStateBefore ?? null,
    fulfillerSignerStateAfter: record.fulfillerSignerStateAfter ?? null,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}

function mergeLinkedPendingOrders(records: Parameters<typeof mapRecord>[0][]) {
  const pendingBySourceId = new Map<string, Parameters<typeof mapRecord>[0]>();

  for (const record of records) {
    const sourceId = getFulfillSourceOrderId(record);
    if (!sourceId) continue;
    const current = pendingBySourceId.get(sourceId);
    if (!current || record.updatedAt > current.updatedAt) {
      pendingBySourceId.set(sourceId, record);
    }
  }

  return records.flatMap(record => {
    const sourceId = getFulfillSourceOrderId(record);
    if (sourceId) {
      return [];
    }

    const pendingChild = pendingBySourceId.get(record.id ?? record._id ?? "");
    if (!pendingChild) {
      return [record];
    }

    return [{
      ...record,
      offerStatus: "pending",
      fulfillerSignerDelegation: pendingChild.signerDelegation,
      fulfillerSignature: pendingChild.signature,
      fulfillerShieldedMasterRoot: pendingChild.shieldedMasterRoot,
      fulfillerInputNotes: pendingChild.inputNotes,
      fulfillerOutputNotes: pendingChild.outputNotes,
      fulfillerWormholeNote: pendingChild.wormholeNote,
      executionTxHash: pendingChild.executionTxHash ?? null,
      executionBlockNumber: pendingChild.executionBlockNumber ?? null,
      makerSignerStateBefore: pendingChild.makerSignerStateBefore ?? null,
      makerSignerStateAfter: pendingChild.makerSignerStateAfter ?? null,
      fulfillerSignerStateBefore: pendingChild.fulfillerSignerStateBefore ?? null,
      fulfillerSignerStateAfter: pendingChild.fulfillerSignerStateAfter ?? null,
      updatedAt: pendingChild.updatedAt,
    }];
  });
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
    notes.shieldedMasterRoot ??
    notes.shielded_master_root ??
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

export async function attachMakerOfferBundle(input: {
  id: string;
  signerDelegation: MarketSignerDelegation;
  signature: Hex | string;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
}) {
  const record = await getConvexClient().mutation(api.marketOffers.attachMakerBundle as never, {
    id: input.id as Id<"marketOrders">,
    signerDelegation: input.signerDelegation,
    signature: String(input.signature),
    shieldedMasterRoot: input.shieldedMasterRoot,
    inputNotes: input.inputNotes,
    outputNotes: input.outputNotes,
    wormholeNote: input.wormholeNote,
  } as never);

  return record ? mapRecord(record as Parameters<typeof mapRecord>[0]) : null;
}

export async function attachFulfillerOfferBundle(input: {
  id: string;
  signerDelegation: MarketSignerDelegation;
  signature: Hex | string;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
}) {
  const record = await getConvexClient().mutation(api.marketOffers.attachFulfillerBundle, {
    id: input.id as Id<"marketOrders">,
    signerDelegation: input.signerDelegation,
    signature: String(input.signature),
    shieldedMasterRoot: input.shieldedMasterRoot,
    inputNotes: input.inputNotes,
    outputNotes: input.outputNotes,
    wormholeNote: input.wormholeNote,
  });

  return record ? mapRecord(record as Parameters<typeof mapRecord>[0]) : null;
}

export async function listMarketOfferRequests(
  filters?: MarketOrderStatus[],
): Promise<MarketOfferRequestRecord[]> {
  const records = await getConvexClient().query(api.marketOffers.listOffers, {
    filters: filters ?? [],
  });

  return mergeLinkedPendingOrders(records as Parameters<typeof mapRecord>[0][]).map(mapRecord);
}

export async function getMarketOfferRequest(id: string) {
  const records = await listMarketOfferRequests();
  return records.find(record => record.id === id) ?? null;
}

export async function createPendingFulfillMarketOffer(input: {
  sourceOrderId: string;
  makerAddress: Address;
  offer: MarketOffer;
  signerDelegation: MarketSignerDelegation;
  signature: Hex | string;
  shieldedMasterRoot: string | null;
  inputNotes: MarketInputNote[] | null;
  outputNotes: MarketOutputNote[] | null;
  wormholeNote: MarketWormholeNote | null;
}) {
  return saveMarketOfferRequest({
    makerAddress: input.makerAddress,
    offer: {
      ...input.offer,
      status: `${FULFILL_LINK_PREFIX}${input.sourceOrderId}`,
    },
    offerStatus: "pending",
    signerDelegation: input.signerDelegation,
    signature: input.signature,
    shieldedMasterRoot: input.shieldedMasterRoot,
    inputNotes: input.inputNotes,
    outputNotes: input.outputNotes,
    wormholeNote: input.wormholeNote,
  });
}

export async function completeMarketFulfillment(input: CompleteMarketFulfillmentInput) {
  const record = await getConvexClient().mutation(api.marketOffers.completeFulfillment as never, {
    id: input.id as Id<"marketOrders">,
    makerOutputNotes: input.makerOutputNotes,
    signerDelegation: input.signerDelegation,
    signature: String(input.signature),
    shieldedMasterRoot: input.shieldedMasterRoot,
    inputNotes: input.inputNotes,
    outputNotes: input.outputNotes,
    wormholeNote: input.wormholeNote,
    executionTxHash: input.execution.txHash,
    executionBlockNumber: input.execution.blockNumber,
    makerSignerStateBefore: input.execution.makerSignerStateBefore,
    makerSignerStateAfter: input.execution.makerSignerStateAfter,
    fulfillerSignerStateBefore: input.execution.fulfillerSignerStateBefore,
    fulfillerSignerStateAfter: input.execution.fulfillerSignerStateAfter,
  } as never);

  return record ? mapRecord(record as Parameters<typeof mapRecord>[0]) : null;
}

function getDelegationKey(delegation: MarketSignerDelegation | null | undefined) {
  if (!delegation) {
    return null;
  }

  return JSON.stringify({
    chainId: delegation.chainId,
    owner: delegation.owner.toLowerCase(),
    delegate: delegation.delegate.toLowerCase(),
    recipient: typeof delegation.recipient === "string" ? delegation.recipient.toLowerCase() : zeroAddress,
    recipientLocked: delegation.recipientLocked === true,
    token: delegation.token.toLowerCase(),
    tokenLocked: delegation.tokenLocked === true,
    tokenId: delegation.tokenId,
    amount: delegation.amount,
    amountType: delegation.amountType,
    maxCumulativeAmount: delegation.maxCumulativeAmount,
    maxNonce: delegation.maxNonce,
    timeInterval: delegation.timeInterval,
    transferType: delegation.transferType,
  });
}

export async function findLatestSignerStateForDelegation(args: {
  role: "maker" | "fulfiller";
  delegation: MarketSignerDelegation;
  excludeOrderId?: string;
}) {
  const delegationKey = getDelegationKey(args.delegation);
  if (!delegationKey) {
    return null;
  }

  const records = await listMarketOfferRequests();
  const fulfilled = records
    .filter((record) => record.id !== args.excludeOrderId && record.offerStatus === "fulfilled")
    .filter((record) => {
      const candidateDelegation = args.role === "maker"
        ? record.signerDelegation
        : record.fulfillerSignerDelegation ?? null;
      return getDelegationKey(candidateDelegation) === delegationKey;
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const latest = fulfilled[0];
  if (!latest) {
    return null;
  }

  return args.role === "maker"
    ? latest.makerSignerStateAfter ?? null
    : latest.fulfillerSignerStateAfter ?? null;
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
