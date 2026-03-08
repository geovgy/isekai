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

    const { offer, makerAddress, signerDelegation, signature, notes } = body;

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

    if (signerDelegation !== undefined && signerDelegation !== null && !isRecord(signerDelegation)) {
      return NextResponse.json(
        { error: "Invalid `signerDelegation` object" },
        { status: 400 },
      );
    }

    if (signature !== undefined && signature !== null && typeof signature !== "string") {
      return NextResponse.json(
        { error: "Invalid `signature`" },
        { status: 400 },
      );
    }

    const normalizedNotes = normalizeNotes(notes);
    const record = await saveMarketOfferRequest({
      offer: offer as MarketOffer,
      offerStatus: normalizeOfferStatus(body, offer as MarketOffer),
      makerAddress: makerAddress as `0x${string}`,
      signerDelegation: isRecord(signerDelegation)
        ? (signerDelegation as MarketSignerDelegation)
        : null,
      signature: typeof signature === "string" ? signature : null,
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