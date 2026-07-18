import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getUserCoins, prisma } from "@/lib/db";
import { getFuturesMarkHistory } from "@/lib/futures-market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const asset = (req.nextUrl.searchParams.get("asset") ?? "").trim().toUpperCase();
  const requestedInterval = req.nextUrl.searchParams.get("interval") ?? "1h";
  const interval = requestedInterval === "4h" || requestedInterval === "1d" ? requestedInterval : "1h";
  const coins = await getUserCoins(Number(session.user.id));
  if (!coins.some((coin) => coin.symbol === asset)) {
    return NextResponse.json({ error: "Unknown futures asset" }, { status: 404 });
  }
  try {
    return NextResponse.json(await getFuturesMarkHistory(asset, interval));
  } catch {
    const rows = await prisma.candle.findMany({
      where: { asset },
      orderBy: { date: "desc" },
      take: 120,
    });
    const candles = rows.reverse().map((row) => ({
      time: new Date(`${row.date}T00:00:00Z`).getTime(),
      close: Number(row.close),
    })).filter((row) => row.close > 0);
    return NextResponse.json({ candles, source: "COINGECKO_FALLBACK" });
  }
}
