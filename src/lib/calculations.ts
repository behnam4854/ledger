// Pure, dependency-light financial calculations.
//
// Every value that represents money or a quantity is handled as a decimal
// string and computed with decimal.js, so there is no binary floating-point
// drift across many transactions. Functions here are pure and unit-testable.

import Decimal from "decimal.js";
import type { Asset, Buy, BuyWithRemaining, PriceMap, Sell } from "./types";

// Quantities below this are treated as a fully-closed position.
const EPSILON = new Decimal("0.000001");

export function dec(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/** Remaining (un-sold) quantity of a buy given the sells linked to it. */
export function computeRemaining(buy: Buy, sells: Sell[]): string {
  let remaining = dec(buy.amount);
  for (const sell of sells) {
    if (sell.buyId === buy.id) {
      remaining = remaining.minus(sell.amount);
    }
  }
  if (remaining.isNegative()) remaining = dec(0);
  return remaining.toString();
}

/** Attach `remaining` to every buy. */
export function withRemaining(buys: Buy[], sells: Sell[]): BuyWithRemaining[] {
  return buys.map((buy) => ({ ...buy, remaining: computeRemaining(buy, sells) }));
}

/** Realized profit for selling `amount` of `buy` at `sellPrice` per unit. */
export function realizedProfit(
  buyPrice: Decimal.Value,
  amount: Decimal.Value,
  sellPrice: Decimal.Value,
): string {
  return dec(amount).times(sellPrice).minus(dec(amount).times(buyPrice)).toString();
}

export function isOpen(remaining: Decimal.Value): boolean {
  return dec(remaining).greaterThan(EPSILON);
}

export interface PortfolioStats {
  totalCost: number;
  totalProceeds: number;
  realizedPnl: number;
  openPositions: number;
}

export function portfolioStats(buys: Buy[], sells: Sell[]): PortfolioStats {
  let totalCost = dec(0);
  for (const b of buys) totalCost = totalCost.plus(dec(b.amount).times(b.price));

  let totalProceeds = dec(0);
  let realizedPnl = dec(0);
  for (const s of sells) {
    totalProceeds = totalProceeds.plus(dec(s.amount).times(s.sellPrice));
    realizedPnl = realizedPnl.plus(s.profit);
  }

  const openPositions = withRemaining(buys, sells).filter((b) => isOpen(b.remaining)).length;

  return {
    totalCost: totalCost.toNumber(),
    totalProceeds: totalProceeds.toNumber(),
    realizedPnl: realizedPnl.toNumber(),
    openPositions,
  };
}

/** Total unrealized P&L across all open positions at the given live prices. */
export function unrealizedPnl(buys: BuyWithRemaining[], prices: PriceMap): number {
  let total = dec(0);
  for (const buy of buys) {
    if (!isOpen(buy.remaining)) continue;
    const price = prices[buy.asset as Asset];
    if (!price || price <= 0) continue;
    total = total.plus(dec(buy.remaining).times(price).minus(dec(buy.remaining).times(buy.price)));
  }
  return total.toNumber();
}

/** Unrealized P&L for a single open buy, or null if no live price is available. */
export function unrealizedForBuy(buy: BuyWithRemaining, price: number): number | null {
  if (!price || price <= 0) return null;
  return dec(buy.remaining).times(price).minus(dec(buy.remaining).times(buy.price)).toNumber();
}

/** Current holdings broken down per asset. */
export interface AssetAllocation {
  asset: string;
  qty: number; // remaining units still held
  value: number; // current market value (0 when no live price)
  cost: number; // cost basis of the remaining units
}

export interface PortfolioValuation {
  holdingsValue: number; // live market value of all open positions
  openCostBasis: number; // cost basis of all open positions
  byAsset: AssetAllocation[]; // sorted by value (then cost) descending
  priced: boolean; // true if at least one open position had a live price
}

/**
 * Value every open position at live prices and roll it up per asset.
 * Pure and decimal-exact, like the rest of this module.
 */
export function portfolioValuation(buys: BuyWithRemaining[], prices: PriceMap): PortfolioValuation {
  const byAsset = new Map<string, { qty: Decimal; value: Decimal; cost: Decimal }>();
  let holdingsValue = dec(0);
  let openCostBasis = dec(0);
  let priced = false;

  for (const buy of buys) {
    if (!isOpen(buy.remaining)) continue;
    const remaining = dec(buy.remaining);
    const cost = remaining.times(buy.price);
    openCostBasis = openCostBasis.plus(cost);

    const entry = byAsset.get(buy.asset) ?? { qty: dec(0), value: dec(0), cost: dec(0) };
    entry.qty = entry.qty.plus(remaining);
    entry.cost = entry.cost.plus(cost);

    const price = prices[buy.asset as Asset];
    if (price && price > 0) {
      const value = remaining.times(price);
      entry.value = entry.value.plus(value);
      holdingsValue = holdingsValue.plus(value);
      priced = true;
    }
    byAsset.set(buy.asset, entry);
  }

  const allocations: AssetAllocation[] = [...byAsset.entries()]
    .map(([asset, e]) => ({
      asset,
      qty: e.qty.toNumber(),
      value: e.value.toNumber(),
      cost: e.cost.toNumber(),
    }))
    .sort((a, b) => b.value - a.value || b.cost - a.cost);

  return {
    holdingsValue: holdingsValue.toNumber(),
    openCostBasis: openCostBasis.toNumber(),
    byAsset: allocations,
    priced,
  };
}
