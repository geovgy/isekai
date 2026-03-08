import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

export default defineSchema({
  marketOrders: defineTable({
    makerAddress: v.union(v.string(), v.null()),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_offer_status", ["offerStatus"])
    .index("by_maker_address", ["makerAddress"]),
});
