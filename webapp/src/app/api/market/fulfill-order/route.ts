import {
  completeMarketFulfillment,
  getMarketOfferRequest,
  normalizeNotes,
  type MarketSignerDelegation,
} from "@/src/server/market-offer-requests";
import { executeMarketFulfillment } from "@/src/server/market-fulfill-execution";
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
    const existing = await getMarketOfferRequest(marketOfferId);
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!existing.makerAddress) {
      return NextResponse.json({ error: "Order maker address not found" }, { status: 409 });
    }

    const executionResult = await executeMarketFulfillment({
      orderId: marketOfferId,
      existing,
      fulfillerDelegation: signerDelegation as MarketSignerDelegation,
      fulfillerSignature: signature,
      fulfillerNotes: normalizedNotes,
    });
    const updated = await completeMarketFulfillment({
      id: marketOfferId,
      ...executionResult.completionInput,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to mark fulfilled market order" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        id: updated.id,
        offerStatus: "fulfilled",
        updatedAt: updated.updatedAt,
        persisted: true,
        txHash: executionResult.txHash,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Invalid fulfill order request";
    return NextResponse.json(
      {
        error: message,
      },
      { status: 400 },
    );
  }
}
