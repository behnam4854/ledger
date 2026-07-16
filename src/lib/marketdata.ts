// Historical price history — backfill + storage.
//
// CoinGecko's free `market_chart` endpoint gives us daily price points going
// back years at no cost and without an API key. We fold those into one close
// per calendar day and upsert them into the Candle table. The going-forward
// "today" row is kept fresh from the live price (see recordLiveClose).

import { prisma } from "./db";
import { ASSET_TO_COINGECKO_ID, ASSETS, type Asset } from "./types";

const DEFAULT_DAYS = 365;

interface MarketChart {
  prices?: [number, number][]; // [ms timestamp, price]
}

/** Fetch daily closes for one asset from CoinGecko (oldest → newest). */
async function fetchDailyCloses(asset: Asset, days: number): Promise<Map<string, number>> {
  const id = ASSET_TO_COINGECKO_ID[asset];
  const url =
    `https://api.coingecko.com/api/v3/coins/${id}/market_chart` +
    `?vs_currency=usd&days=${days}&interval=daily`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status} for ${asset}`);

  const data = (await res.json()) as MarketChart;
  const points = data.prices ?? [];

  // Collapse to one close per UTC day (last point of the day wins).
  const byDay = new Map<string, number>();
  for (const [ts, price] of points) {
    if (typeof ts !== "number" || typeof price !== "number" || price <= 0) continue;
    const date = new Date(ts).toISOString().slice(0, 10);
    byDay.set(date, price);
  }
  return byDay;
}

export interface BackfillResult {
  asset: Asset;
  upserted: number;
  error?: string;
}

/** Backfill all assets. Failures are isolated per-asset so one bad call
 *  doesn't abort the others (and CoinGecko rate limits are spaced out). */
export async function backfillAll(days = DEFAULT_DAYS): Promise<BackfillResult[]> {
  const results: BackfillResult[] = [];

  for (const asset of ASSETS) {
    try {
      const byDay = await fetchDailyCloses(asset, days);
      let upserted = 0;
      for (const [date, close] of byDay) {
        await prisma.candle.upsert({
          where: { asset_date: { asset, date } },
          create: { asset, date, close: String(close) },
          update: { close: String(close) },
        });
        upserted++;
      }
      results.push({ asset, upserted });
    } catch (err) {
      results.push({ asset, upserted: 0, error: err instanceof Error ? err.message : "failed" });
    }
    // Be polite to the free endpoint between assets.
    await new Promise((r) => setTimeout(r, 1200));
  }

  return results;
}

/** Upsert today's close from a live price (called opportunistically). */
export async function recordLiveClose(asset: Asset, price: number): Promise<void> {
  if (!(price > 0)) return;
  const date = new Date().toISOString().slice(0, 10);
  await prisma.candle.upsert({
    where: { asset_date: { asset, date } },
    create: { asset, date, close: String(price) },
    update: { close: String(price) },
  });
}

/** All stored daily closes for an asset, oldest → newest. */
export async function getCloses(asset: Asset): Promise<{ date: string; close: number }[]> {
  const rows = await prisma.candle.findMany({
    where: { asset },
    orderBy: { date: "asc" },
    select: { date: true, close: true },
  });
  return rows.map((r) => ({ date: r.date, close: Number(r.close) }));
}
