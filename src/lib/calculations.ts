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
