import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const marketOfferItem = v.object({
  dstChainId: v.string(),
  token: v.string(),
  tokenId: v.string(),
  amount: v.string(),
});

const signerDelegation = v.object({
  chainId: v.string(),
  owner: v.string(),
  delegate: v.string(),
  startTime: v.string(),
  endTime: v.string(),
  token: v.string(),
  tokenId: v.string(),
  amount: v.string(),
  amountType: v.number(),
  maxCumulativeAmount: v.string(),
  maxNonce: v.string(),
  timeInterval: v.string(),
  transferType: v.number(),
});

export const createOffer = mutation({
  args: {
    makerAddress: v.string(),
    offer: v.object({
      ask: marketOfferItem,
      for: marketOfferItem,
      status: v.optional(v.union(v.string(), v.null())),
    }),
    offerStatus: v.string(),
    signerDelegation: v.union(signerDelegation, v.null()),
    signature: v.union(v.string(), v.null()),
    shieldedMasterRoot: v.union(v.string(), v.null()),
    inputNotes: v.union(v.array(v.any()), v.null()),
    outputNotes: v.union(v.array(v.any()), v.null()),
    wormholeNote: v.union(v.any(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("marketOrders", {
      makerAddress: args.makerAddress,
      offer: args.offer,
      offerStatus: args.offerStatus,
      signerDelegation: args.signerDelegation,
      signature: args.signature,
      shieldedMasterRoot: args.shieldedMasterRoot,
      inputNotes: args.inputNotes,
      outputNotes: args.outputNotes,
      wormholeNote: args.wormholeNote,
      createdAt: now,
      updatedAt: now,
    });

    const record = await ctx.db.get(id);
    if (!record) {
      throw new Error("Failed to create market order");
    }

    return { ...record, id: record._id };
  },
});

export const listOffers = query({
  args: {
    filters: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const filters = new Set(args.filters ?? []);
    const records = await ctx.db.query("marketOrders").order("desc").collect();

    return records
      .filter(record => filters.size === 0 || filters.has(record.offerStatus))
      .map(record => ({
        ...record,
        id: record._id,
      }));
  },
});

export const cancelOpenOffer = mutation({
  args: {
    id: v.id("marketOrders"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record || record.offerStatus !== "open") {
      return null;
    }

    const updatedAt = Date.now();
    await ctx.db.patch(args.id, {
      offerStatus: "cancelled",
      signerDelegation: null,
      signature: null,
      shieldedMasterRoot: null,
      inputNotes: null,
      outputNotes: null,
      wormholeNote: null,
      updatedAt,
    });

    const updated = await ctx.db.get(args.id);
    return updated
      ? {
          ...updated,
          id: updated._id,
        }
      : null;
  },
});

export const getOfferStatus = query({
  args: {
    id: v.id("marketOrders"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) {
      return null;
    }

    return {
      id: record._id,
      makerAddress: record.makerAddress,
      offerStatus: record.offerStatus,
    };
  },
});
