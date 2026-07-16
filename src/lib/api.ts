// Typed client-side wrappers around the JSON API.

import type {
  Asset,
  CandlesResponse,
  CoinDefinition,
  FuturesAccountResponse,
  FuturesSide,
  Portfolio,
  PricesResponse,
  SignalsResponse,
} from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchPortfolio(): Promise<Portfolio> {
  return jsonOrThrow<Portfolio>(await fetch("/api/portfolio", { cache: "no-store" }));
}

export async function fetchPrices(): Promise<PricesResponse> {
  return jsonOrThrow<PricesResponse>(await fetch("/api/prices", { cache: "no-store" }));
}

export async function fetchCoins(): Promise<CoinDefinition[]> {
  const data = await jsonOrThrow<{ coins: CoinDefinition[] }>(
    await fetch("/api/coins", { cache: "no-store" }),
  );
  return data.coins;
}

export async function addCoin(url: string): Promise<CoinDefinition> {
  const data = await jsonOrThrow<{ coin: CoinDefinition }>(
    await fetch("/api/coins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );
  return data.coin;
}

export async function fetchSignals(): Promise<SignalsResponse> {
  return jsonOrThrow<SignalsResponse>(await fetch("/api/signals", { cache: "no-store" }));
}

export async function fetchFuturesAccount(): Promise<FuturesAccountResponse> {
  return jsonOrThrow<FuturesAccountResponse>(await fetch("/api/futures", { cache: "no-store" }));
}

export async function openFuturesPosition(input: {
  asset: string;
  side: FuturesSide;
  margin: string;
  leverage: number;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
}): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/futures/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function closeFuturesPosition(id: number, exitPrice: string): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/futures/positions/${id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exitPrice }),
    }),
  );
}

export async function fetchCandles(asset: Asset): Promise<CandlesResponse> {
  return jsonOrThrow<CandlesResponse>(
    await fetch(`/api/candles?asset=${asset}`, { cache: "no-store" }),
  );
}

export async function backfillCandles(days = 365): Promise<{ total: number }> {
  return jsonOrThrow<{ total: number }>(
    await fetch("/api/candles/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    }),
  );
}

export interface BuyInput {
  wallet: string;
  asset: string;
  amount: string;
  price: string;
  date: string;
}

export async function createBuy(input: BuyInput): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/buys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteBuy(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`/api/buys/${id}`, { method: "DELETE" }));
}

export interface SellInput {
  buyId: number;
  amount: string;
  sellPrice: string;
  sellDate: string;
}

export async function createSell(input: SellInput): Promise<void> {
  await jsonOrThrow(
    await fetch("/api/sells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteSell(id: number): Promise<void> {
  await jsonOrThrow(await fetch(`/api/sells/${id}`, { method: "DELETE" }));
}

export async function updateUsd(action: "add" | "withdraw", amount: number): Promise<number> {
  const data = await jsonOrThrow<{ usd: number }>(
    await fetch("/api/usd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, amount }),
    }),
  );
  return data.usd;
}

export interface ImportPayload {
  buys: { wallet: string; asset: string; amount: string; price: string; date: string }[];
  sells: { asset: string; amount: string; sellPrice: string; sellDate: string; profit: string }[];
}

export async function importData(
  payload: ImportPayload,
): Promise<{ importedBuys: number; importedSells: number; skippedSells: number }> {
  return jsonOrThrow(
    await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}
