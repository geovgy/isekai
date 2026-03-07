import {
  cancelOpenMarketOfferRequest,
  getMarketOfferRequestStatus,
} from "@/src/server/market-offer-requests";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const requestId = body.id ?? body.requestId;
    if (typeof requestId !== "string" || requestId.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid `id`" },
        { status: 400 },
      );
    }

    const updated = await cancelOpenMarketOfferRequest(requestId);
    if (updated) {
      return NextResponse.json(updated);
    }

    const existing = await getMarketOfferRequestStatus(requestId);
    if (!existing) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        error: `Only open orders can be cancelled. Current status is \`${existing.offerStatus}\`.`,
      },
      { status: 409 },
    );
  } catch (error) {
    console.error("Failed to cancel market offer request", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel market offer request",
      },
      { status: 500 },
    );
  }
}
