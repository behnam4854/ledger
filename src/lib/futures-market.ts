import type { CoinDefinition, FuturesMarketQuote, PriceMap } from "./types";

interface BinancePremium {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate?: string;
  nextFundingTime?: number;
}

interface BinanceTicker {
  symbol: string;
  price: string;
  time?: number;
}

async function binanceJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`https://fapi.binance.com${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Binance futures returned ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getFuturesMarkHistory(
  symbol: string,
  interval: "1h" | "4h" | "1d",
  limit = 120,
): Promise<{ candles: { time: number; close: number }[]; source: "BINANCE_FUTURES" }> {
  const exchangeSymbol = `${symbol.replace(/[^A-Z0-9]/g, "")}USDT`;
  const rows = await binanceJson<unknown[][]>(
    `/fapi/v1/markPriceKlines?symbol=${encodeURIComponent(exchangeSymbol)}&interval=${interval}&limit=${Math.min(Math.max(limit, 20), 300)}`,
  );
  const candles = rows.map((row) => ({ time: Number(row[0]), close: Number(row[4]) }))
    .filter((row) => Number.isFinite(row.time) && row.close > 0);
  if (candles.length < 2) throw new Error("No futures chart data");
  return { candles, source: "BINANCE_FUTURES" };
}

/** Build a futures quote set with a CoinGecko fallback for unsupported symbols. */
export async function getFuturesMarket(
  coins: CoinDefinition[],
  spotPrices: PriceMap,
): Promise<{ quotes: Record<string, FuturesMarketQuote>; updatedAt: number }> {
  const [premiumResult, tickerResult] = await Promise.allSettled([
    binanceJson<BinancePremium[]>("/fapi/v1/premiumIndex"),
    binanceJson<BinanceTicker[]>("/fapi/v2/ticker/price"),
  ]);
  const premiums = premiumResult.status === "fulfilled" && Array.isArray(premiumResult.value)
    ? new Map(premiumResult.value.map((item) => [item.symbol, item]))
    : new Map<string, BinancePremium>();
  const tickers = tickerResult.status === "fulfilled" && Array.isArray(tickerResult.value)
    ? new Map(tickerResult.value.map((item) => [item.symbol, item]))
    : new Map<string, BinanceTicker>();

  const quotes: Record<string, FuturesMarketQuote> = {};
  for (const coin of coins) {
    const fallback = spotPrices[coin.symbol] ?? 0;
    const exchangeSymbol = `${coin.symbol.replace(/[^A-Z0-9]/g, "")}USDT`;
    const premium = premiums.get(exchangeSymbol);
    const ticker = tickers.get(exchangeSymbol);
    const markPrice = Number(premium?.markPrice);
    const indexPrice = Number(premium?.indexPrice);
    const lastPrice = Number(ticker?.price);
    const exchangeReady = markPrice > 0 && indexPrice > 0;
    quotes[coin.symbol] = {
      symbol: coin.symbol,
      exchangeSymbol: exchangeReady ? exchangeSymbol : null,
      markPrice: exchangeReady ? markPrice : fallback,
      indexPrice: exchangeReady ? indexPrice : fallback,
      lastPrice: lastPrice > 0 ? lastPrice : fallback,
      fundingRate: premium?.lastFundingRate ? Number(premium.lastFundingRate) * 100 : null,
      nextFundingTime: premium?.nextFundingTime ?? null,
      source: exchangeReady ? "BINANCE_FUTURES" : "COINGECKO_FALLBACK",
    };
  }
  return { quotes, updatedAt: Date.now() };
}
