import {
  attachMakerOfferBundle,
  getMarketOfferRequestStatus,
  normalizeNotes,
  normalizeOfferStatus,
  saveMarketOfferRequest,
  type MarketOffer,
  type MarketSignerDelegation,
} from "@/src/server/market-offer-requests";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const requestId = body.id ?? body.orderId ?? body.marketOfferId;
    const { offer, makerAddress, signerDelegation, signature, notes } = body;

    if (typeof requestId === "string" && requestId.length > 0) {
      if (!isRecord(signerDelegation)) {
        return NextResponse.json(
          { error: "Missing or invalid `signerDelegation` object" },
          { status: 400 },
        );
      }
      if (typeof signature !== "string" || signature.length === 0) {
        return NextResponse.json(
          { error: "Missing or invalid `signature`" },
          { status: 400 },
        );
      }

      const normalizedNotes = normalizeNotes(notes);
      const updated = await attachMakerOfferBundle({
        id: requestId,
        signerDelegation: signerDelegation as MarketSignerDelegation,
        signature,
        shieldedMasterRoot: normalizedNotes.shieldedMasterRoot,
        inputNotes: normalizedNotes.inputNotes,
        outputNotes: normalizedNotes.outputNotes,
        wormholeNote: normalizedNotes.wormholeNote,
      });

      if (!updated) {
        const existing = await getMarketOfferRequestStatus(requestId);
        return NextResponse.json(
          { error: existing ? "Failed to attach maker bundle" : "Order not found" },
          { status: existing ? 409 : 404 },
        );
      }

      return NextResponse.json(
        {
          id: updated.id,
          offerStatus: updated.offerStatus,
          updatedAt: updated.updatedAt,
        },
        { status: 200 },
      );
    }

    if (!isRecord(offer)) {
      return NextResponse.json(
        { error: "Missing or invalid `offer` object" },
        { status: 400 },
      );
    }

    if (typeof makerAddress !== "string" || makerAddress.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid `makerAddress`" },
        { status: 400 },
      );
    }

    const record = await saveMarketOfferRequest({
      offer: offer as MarketOffer,
      offerStatus: normalizeOfferStatus(body, offer as MarketOffer),
      makerAddress: makerAddress as `0x${string}`,
      signerDelegation: null,
      signature: null,
      shieldedMasterRoot: null,
      inputNotes: null,
      outputNotes: null,
      wormholeNote: null,
    });

    return NextResponse.json(
      {
        id: record.id,
        offerStatus: record.offerStatus,
        createdAt: record.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to persist market offer request", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to persist market offer request",
      },
      { status: 500 },
    );
  }
}