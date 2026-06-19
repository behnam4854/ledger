// Server-side price fetching with a shared in-memory cache.
//
// Fetching on the server (instead of from each browser) means a single cached
// CoinGecko call serves every user, keeps us well under rate limits, and lets
// us add an API key without exposing it to the client.

import { ASSET_TO_COINGECKO_ID, ASSETS, type PriceMap } from "./types";

const CACHE_TTL_MS = 10_000;

interface PriceCache {
  prices: PriceMap;
  updatedAt: number | null;
}

const cache: PriceCache = {
  prices: { BTC: 0, ETH: 0, XAUT: 0 },
  updatedAt: null,
};

let inFlight: Promise<PriceCache> | null = null;

async function fetchFromCoinGecko(): Promise<PriceMap> {
  const ids = Object.values(ASSET_TO_COINGECKO_ID).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null) throw new Error("Invalid response");

  const record = data as Record<string, { usd?: number }>;
  const prices: PriceMap = { ...cache.prices };
  for (const asset of ASSETS) {
    const usd = record[ASSET_TO_COINGECKO_ID[asset]]?.usd;
    if (typeof usd === "number" && usd > 0) prices[asset] = usd;
  }
  return prices;
}

/** Returns cached prices, refreshing from CoinGecko when the cache is stale. */
export async function getPrices(): Promise<{ prices: PriceMap; fresh: boolean; updatedAt: number | null }> {
  const now = Date.now();
  if (cache.updatedAt !== null && now - cache.updatedAt < CACHE_TTL_MS) {
    return { prices: cache.prices, fresh: true, updatedAt: cache.updatedAt };
  }

  // Collapse concurrent refreshes into one upstream request.
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const prices = await fetchFromCoinGecko();
        cache.prices = prices;
        cache.updatedAt = Date.now();
      } finally {
        inFlight = null;
      }
      return cache;
    })();
  }

  try {
    await inFlight;
    return { prices: cache.prices, fresh: true, updatedAt: cache.updatedAt };
  } catch {
    // Upstream failed — serve last-known prices (possibly all-zero on cold start).
    return { prices: cache.prices, fresh: false, updatedAt: cache.updatedAt };
  }
}
