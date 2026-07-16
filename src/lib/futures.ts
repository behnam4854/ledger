import Decimal from "decimal.js";

export type FuturesSide = "LONG" | "SHORT";

export interface FuturesMetrics {
  notional: string;
  quantity: string;
  liquidationPrice: string;
  pnl: string;
  equity: string;
  roe: number;
  liquidated: boolean;
}

/**
 * Simplified isolated-margin paper futures math. It intentionally excludes
 * exchange-specific maintenance margin, funding, fees, and insurance funds.
 */
export function futuresMetrics(input: {
  side: FuturesSide;
  entryPrice: Decimal.Value;
  markPrice: Decimal.Value;
  margin: Decimal.Value;
  leverage: number;
  quantity?: Decimal.Value;
}): FuturesMetrics {
  const entry = new Decimal(input.entryPrice);
  const mark = new Decimal(input.markPrice);
  const margin = new Decimal(input.margin);
  const leverage = new Decimal(input.leverage);
  const notional = margin.times(leverage);
  const quantity = input.quantity === undefined ? notional.div(entry) : new Decimal(input.quantity);
  const direction = input.side === "LONG" ? new Decimal(1) : new Decimal(-1);
  const rawPnl = mark.minus(entry).times(quantity).times(direction);
  const pnl = Decimal.max(rawPnl, margin.negated());
  const equity = Decimal.max(margin.plus(pnl), 0);
  const liquidationPrice = input.side === "LONG"
    ? entry.times(new Decimal(1).minus(new Decimal(1).div(leverage)))
    : entry.times(new Decimal(1).plus(new Decimal(1).div(leverage)));
  const liquidated = input.side === "LONG"
    ? mark.lessThanOrEqualTo(liquidationPrice)
    : mark.greaterThanOrEqualTo(liquidationPrice);

  return {
    notional: notional.toString(),
    quantity: quantity.toString(),
    liquidationPrice: Decimal.max(liquidationPrice, 0).toString(),
    pnl: pnl.toString(),
    equity: equity.toString(),
    roe: margin.isZero() ? 0 : pnl.div(margin).times(100).toNumber(),
    liquidated,
  };
}
