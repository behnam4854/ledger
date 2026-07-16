import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getCloses } from "@/lib/marketdata";
import { ASSETS, type Asset, type CandlesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assetParam = (req.nextUrl.searchParams.get("asset") ?? "").toUpperCase();
  if (!ASSETS.includes(assetParam as Asset)) {
    return NextResponse.json({ error: "Unknown asset" }, { status: 400 });
  }
  const asset = assetParam as Asset;

  const closes = await getCloses(asset);
  const body: CandlesResponse = {
    asset,
    candles: closes.map((c) => ({ asset, date: c.date, close: String(c.close) })),
  };
  return NextResponse.json(body);
}
