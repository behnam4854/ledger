import { NextResponse } from "next/server";
import { getPrices } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET() {
  const { prices, fresh, updatedAt } = await getPrices();
  return NextResponse.json({
    prices,
    status: fresh ? "live" : "stale",
    updatedAt,
  });
}
