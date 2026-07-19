import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";

interface CoinGeckoSearchCoin {
  id?: string;
  symbol?: string;
  name?: string;
  market_cap_rank?: number | null;
  thumb?: string;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 60) return NextResponse.json({ coins: [] });

  try {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);

    const data = (await response.json()) as { coins?: CoinGeckoSearchCoin[] };
    const coins = (data.coins ?? []).slice(0, 8).flatMap((coin) => {
      const id = String(coin.id ?? "").trim();
      const symbol = String(coin.symbol ?? "").trim().toUpperCase();
      const name = String(coin.name ?? "").trim();
      if (!id || !symbol || !name) return [];
      return [{
        id,
        symbol,
        name,
        rank: typeof coin.market_cap_rank === "number" ? coin.market_cap_rank : null,
        thumb: typeof coin.thumb === "string" ? coin.thumb : null,
      }];
    });
    return NextResponse.json({ coins });
  } catch {
    return NextResponse.json({ error: "Coin search is temporarily unavailable" }, { status: 502 });
  }
}
