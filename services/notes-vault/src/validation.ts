import { z } from "zod";
import { masterTreeStatuses, shieldedStatuses, TransferType, wormholeStatuses } from "./types";

const addressSchema = z.custom<`0x${string}`>(
  value => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value),
  "Expected a checksummed or lowercase 20-byte hex address",
);
const bigintStringSchema = z.string().regex(/^\d+$/, "Expected a non-negative integer string");

const optionalStringSchema = z.string().min(1).optional();

const shieldedNotePayloadSchema = z.object({
  account: addressSchema,
  asset: addressSchema,
  assetId: optionalStringSchema,
  blinding: z.string().min(1),
  amount: z.string().min(1),
  transferType: z.nativeEnum(TransferType),
});

const wormholeEntryPayloadSchema = z.object({
  to: addressSchema,
  from: addressSchema,
  wormhole_secret: z.string().min(1),
  token: addressSchema,
  token_id: z.string().min(1),
  amount: z.string().min(1),
});

export const accountParamsSchema = z.object({
  account: addressSchema,
});

export const idParamsSchema = accountParamsSchema.extend({
  id: z.string().min(1),
});

export const requestIdParamsSchema = accountParamsSchema.extend({
  requestId: z.string().min(1),
});

export const shieldedNoteSchema = z.object({
  id: z.string().min(1),
  treeNumber: z.number().int().nonnegative(),
  leafIndex: z.number().int().nonnegative(),
  srcChainId: z.number().int().nonnegative(),
  dstChainId: z.number().int().nonnegative(),
  from: addressSchema.optional(),
  note: shieldedNotePayloadSchema,
  status: z.enum(shieldedStatuses).optional(),
  usedAt: optionalStringSchema,
  committedAt: optionalStringSchema,
  memo: optionalStringSchema,
  blockNumber: z.number().int().nonnegative().optional(),
  blockTimestamp: z.number().int().nonnegative().optional(),
  masterTreeStatus: z.enum(masterTreeStatuses).optional(),
});

export const wormholeNoteSchema = z.object({
  id: z.string().min(1),
  entryId: z.string().min(1),
  treeNumber: z.number().int().nonnegative(),
  leafIndex: z.number().int().nonnegative(),
  srcChainId: z.number().int().nonnegative(),
  dstChainId: z.number().int().nonnegative(),
  entry: wormholeEntryPayloadSchema,
  status: z.enum(wormholeStatuses).optional(),
  usedAt: optionalStringSchema,
  memo: optionalStringSchema,
  blockNumber: z.number().int().nonnegative().optional(),
  blockTimestamp: z.number().int().nonnegative().optional(),
  masterTreeStatus: z.enum(masterTreeStatuses).optional(),
});

export const shieldedNotePatchSchema = z.object({
  treeNumber: z.number().int().nonnegative().optional(),
  leafIndex: z.number().int().nonnegative().optional(),
  srcChainId: z.number().int().nonnegative().optional(),
  dstChainId: z.number().int().nonnegative().optional(),
  from: addressSchema.optional(),
  note: shieldedNotePayloadSchema.partial().optional(),
  status: z.enum(shieldedStatuses).optional(),
  usedAt: optionalStringSchema,
  committedAt: optionalStringSchema,
  memo: optionalStringSchema,
  blockNumber: z.number().int().nonnegative().optional(),
  blockTimestamp: z.number().int().nonnegative().optional(),
  masterTreeStatus: z.enum(masterTreeStatuses).optional(),
});

export const wormholeNotePatchSchema = z.object({
  entryId: z.string().min(1).optional(),
  treeNumber: z.number().int().nonnegative().optional(),
  leafIndex: z.number().int().nonnegative().optional(),
  srcChainId: z.number().int().nonnegative().optional(),
  dstChainId: z.number().int().nonnegative().optional(),
  entry: wormholeEntryPayloadSchema.partial().optional(),
  status: z.enum(wormholeStatuses).optional(),
  usedAt: optionalStringSchema,
  memo: optionalStringSchema,
  blockNumber: z.number().int().nonnegative().optional(),
  blockTimestamp: z.number().int().nonnegative().optional(),
  masterTreeStatus: z.enum(masterTreeStatuses).optional(),
});

const queryNumberSchema = z.coerce.number().int().nonnegative().optional();

export const shieldedListQuerySchema = z.object({
  srcChainId: queryNumberSchema,
  dstChainId: queryNumberSchema,
  status: z.enum(shieldedStatuses).optional(),
  masterTreeStatus: z.enum(masterTreeStatuses).optional(),
});

export const wormholeListQuerySchema = z.object({
  srcChainId: queryNumberSchema,
  dstChainId: queryNumberSchema,
  status: z.enum(wormholeStatuses).optional(),
  masterTreeStatus: z.enum(masterTreeStatuses).optional(),
});

export const shieldedBatchCreateSchema = z.object({
  notes: z.array(shieldedNoteSchema),
});

export const wormholeBatchCreateSchema = z.object({
  notes: z.array(wormholeNoteSchema),
});

export const createShieldedTransferRequestSchema = z.object({
  token: addressSchema,
  tokenId: bigintStringSchema.optional(),
  amount: bigintStringSchema,
  srcChainId: z.number().int().nonnegative(),
  dstChainId: z.number().int().nonnegative(),
  receiver: addressSchema.optional(),
});

export const updateShieldedTransferRequestStatusSchema = z.object({
  status: z.string().min(1),
  markUsed: z.boolean().optional(),
});
