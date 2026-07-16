// Prisma client singleton — avoids exhausting connections during Next.js HMR.

import { PrismaClient } from "@prisma/client";
import { CORE_COINS, type CoinDefinition } from "./types";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

const USD_KEY = "usd_balance";
const DEFAULT_USD = 10000;
export const FUTURES_USD_KEY = "futures_paper_balance";
export const DEFAULT_FUTURES_USD = 10000;

export async function getUsdBalance(userId: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { userId_key: { userId, key: USD_KEY } } });
  if (!row) return DEFAULT_USD;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : DEFAULT_USD;
}

export async function setUsdBalance(userId: number, value: number): Promise<number> {
  const safe = Number.isFinite(value) ? value : 0;
  await prisma.setting.upsert({
    where: { userId_key: { userId, key: USD_KEY } },
    create: { userId, key: USD_KEY, value: String(safe) },
    update: { value: String(safe) },
  });
  return safe;
}

export async function getFuturesBalance(userId: number): Promise<number> {
  const row = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: FUTURES_USD_KEY } },
  });
  if (!row) return DEFAULT_FUTURES_USD;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : DEFAULT_FUTURES_USD;
}

export async function getUserCoins(userId: number): Promise<CoinDefinition[]> {
  const custom = await prisma.coin.findMany({
    where: { userId },
    orderBy: { symbol: "asc" },
    select: { symbol: true, name: true, coingeckoId: true },
  });
  return [
    ...CORE_COINS,
    ...custom.map((coin) => ({ ...coin, builtIn: false })),
  ];
}
