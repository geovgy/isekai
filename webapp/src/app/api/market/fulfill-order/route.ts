import {
  attachFulfillerOfferBundle,
  getMarketOfferRequestStatus,
  normalizeNotes,
  type MarketSignerDelegation,
} from "@/src/server/market-offer-requests";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as unknown;
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const marketOfferId = body.marketOfferId ?? body.id ?? body.orderId;
    const { signerDelegation, signature, notes } = body;

    if (typeof marketOfferId !== "string" || marketOfferId.length === 0) {
      return NextResponse.json({ error: "Missing or invalid `marketOfferId`" }, { status: 400 });
    }
    if (!isRecord(signerDelegation)) {
      return NextResponse.json({ error: "Missing or invalid `signerDelegation`" }, { status: 400 });
    }
    if (typeof signature !== "string" || signature.length === 0) {
      return NextResponse.json({ error: "Missing or invalid `signature`" }, { status: 400 });
    }

    const normalizedNotes = normalizeNotes(notes ?? {
      shieldedMasterRoot: body.shieldedMasterRoot ?? null,
      inputNotes: body.inputNotes ?? null,
      outputNotes: body.outputNotes ?? null,
      wormholeNote: body.wormholeNote ?? null,
    });
    const updated = await attachFulfillerOfferBundle({
      id: marketOfferId,
      signerDelegation: signerDelegation as MarketSignerDelegation,
      signature,
      shieldedMasterRoot: normalizedNotes.shieldedMasterRoot,
      inputNotes: normalizedNotes.inputNotes,
      outputNotes: normalizedNotes.outputNotes,
      wormholeNote: normalizedNotes.wormholeNote,
    });

    if (!updated) {
      const existing = await getMarketOfferRequestStatus(marketOfferId);
      return NextResponse.json(
        { error: existing ? "Failed to attach fulfiller bundle" : "Order not found" },
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
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid fulfill order request",
      },
      { status: 400 },
    );
  }
}
