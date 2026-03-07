import {
  MARKET_ORDER_STATUSES,
  listMarketOfferRequests,
  parseMarketOrderStatusFilters,
} from "@/src/server/market-offer-requests";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const requestedFilters = [
      ...request.nextUrl.searchParams.getAll("filter"),
      ...request.nextUrl.searchParams.getAll("status"),
    ];
    const { filters, invalid } = parseMarketOrderStatusFilters(requestedFilters);

    if (invalid.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid filter value(s): ${invalid.join(", ")}`,
          allowed: MARKET_ORDER_STATUSES,
        },
        { status: 400 },
      );
    }

    const orders = await listMarketOfferRequests(filters);

    return NextResponse.json({
      filters,
      orders,
    });
  } catch (error) {
    console.error("Failed to list market offer requests", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to list market offer requests",
      },
      { status: 500 },
    );
  }
}
