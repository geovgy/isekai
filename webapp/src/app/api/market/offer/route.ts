import {
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

    const { offer, signerDelegation, signature, notes } = body;

    if (!isRecord(offer)) {
      return NextResponse.json(
        { error: "Missing or invalid `offer` object" },
        { status: 400 },
      );
    }

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
    const record = await saveMarketOfferRequest({
      offer: offer as MarketOffer,
      offerStatus: normalizeOfferStatus(body, offer as MarketOffer),
      makerAddress: (signerDelegation as MarketSignerDelegation).owner,
      signerDelegation: signerDelegation as MarketSignerDelegation,
      signature,
      shieldedMasterRoot: normalizedNotes.shieldedMasterRoot,
      inputNotes: normalizedNotes.inputNotes,
      outputNotes: normalizedNotes.outputNotes,
      wormholeNote: normalizedNotes.wormholeNote,
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