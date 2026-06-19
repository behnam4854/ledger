// Typed client-side wrappers around the JSON API.

import type { Portfolio, PricesResponse } from "./types";

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
