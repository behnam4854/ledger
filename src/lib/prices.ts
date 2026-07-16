// Server-side CoinGecko pricing with a shared in-memory cache.

import { CORE_COINS, type CoinDefinition, type PriceMap } from "./types";

const CACHE_TTL_MS = 10_000;

interface PriceCache {
  byCoinGeckoId: Record<string, number>;
  updatedAt: number | null;
}

const cache: PriceCache = { byCoinGeckoId: {}, updatedAt: null };
const inFlight = new Map<string, Promise<void>>();

async function fetchFromCoinGecko(coins: CoinDefinition[]): Promise<Record<string, number>> {
  const ids = [...new Set(coins.map((coin) => coin.coingeckoId))].join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null) throw new Error("Invalid response");

  const record = data as Record<string, { usd?: number }>;
  const prices: Record<string, number> = {};
  for (const coin of coins) {
    const usd = record[coin.coingeckoId]?.usd;
    if (typeof usd === "number" && usd > 0) prices[coin.coingeckoId] = usd;
  }
  return prices;
}

function toSymbolPrices(coins: CoinDefinition[]): PriceMap {
  return Object.fromEntries(
    coins.map((coin) => [coin.symbol, cache.byCoinGeckoId[coin.coingeckoId] ?? 0]),
  );
}

/** Returns prices for the supplied user coin list, refreshing stale cache data. */
export async function getPrices(
  coins: CoinDefinition[] = CORE_COINS,
): Promise<{ prices: PriceMap; fresh: boolean; updatedAt: number | null }> {
  const now = Date.now();
  const hasEveryCoin = coins.every((coin) => cache.byCoinGeckoId[coin.coingeckoId] > 0);
  if (hasEveryCoin && cache.updatedAt !== null && now - cache.updatedAt < CACHE_TTL_MS) {
    return { prices: toSymbolPrices(coins), fresh: true, updatedAt: cache.updatedAt };
  }

  // Collapse identical concurrent refreshes while allowing different user coin
  // lists to fetch independently.
  const requestKey = coins.map((coin) => coin.coingeckoId).sort().join(",");
  let request = inFlight.get(requestKey);
  if (!request) {
    request = (async () => {
      try {
        const prices = await fetchFromCoinGecko(coins);
        cache.byCoinGeckoId = { ...cache.byCoinGeckoId, ...prices };
        cache.updatedAt = Date.now();
      } finally {
        inFlight.delete(requestKey);
      }
    })();
    inFlight.set(requestKey, request);
  }

  try {
    await request;
    return { prices: toSymbolPrices(coins), fresh: true, updatedAt: cache.updatedAt };
  } catch {
    return { prices: toSymbolPrices(coins), fresh: false, updatedAt: cache.updatedAt };
  }
}

interface CoinGeckoCoinResponse {
  id?: string;
  symbol?: string;
  name?: string;
  market_data?: { current_price?: { usd?: number } };
}

/** Fetch verified coin identity and pricing directly from CoinGecko. */
export async function fetchCoinGeckoCoin(
  coingeckoId: string,
): Promise<{ coingeckoId: string; symbol: string; name: string } | null> {
  const query = "localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}?${query}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

  const data = (await res.json()) as CoinGeckoCoinResponse;
  const symbol = String(data.symbol ?? "").trim().toUpperCase();
  const name = String(data.name ?? "").trim();
  const usd = data.market_data?.current_price?.usd;
  if (data.id !== coingeckoId || !symbol || !name || typeof usd !== "number" || !(usd > 0)) {
    return null;
  }
  return { coingeckoId, symbol, name };
}
