import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCloses, recordLiveClose } from "@/lib/marketdata";
import { getPrices } from "@/lib/prices";
import { computeSignal } from "@/lib/indicators";
import { ASSETS, type AssetSignal, type SignalsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fold the live price into today's candle so signals reflect "now".
  const { prices } = await getPrices();
  await Promise.all(
    ASSETS.map((asset) => (prices[asset] > 0 ? recordLiveClose(asset, prices[asset]) : null)),
  );

  const signals: AssetSignal[] = [];
  for (const asset of ASSETS) {
    const closes = (await getCloses(asset)).map((c) => c.close);
    const sig = computeSignal(closes);
    signals.push({
      asset,
      signal: sig.type,
      reason: sig.reason,
      strength: sig.strength,
      rsi: sig.rsi,
      smaShort: sig.smaShort,
      smaLong: sig.smaLong,
      lastClose: closes.length ? closes[closes.length - 1] : null,
      history: closes.length,
    });
  }

  const body: SignalsResponse = { signals, generatedAt: Date.now() };
  return NextResponse.json(body);
}
