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
  maintenanceMargin: string;
  liquidationDistancePercent: number;
}

export interface RiskSizedOrder {
  riskAmount: string;
  quantity: string;
  notional: string;
  margin: string;
}

/** Calculate an execution fee from a USD notional and a basis-point rate. */
export function futuresFee(notional: Decimal.Value, rateBps: Decimal.Value): string {
  const value = new Decimal(notional);
  const rate = new Decimal(rateBps);
  if (!value.isFinite() || !rate.isFinite() || value.isNegative() || rate.isNegative()) return "0";
  return value.times(rate).div(10_000).toString();
}

/** Count only fully completed funding intervals. */
export function completedFundingIntervals(
  openedAt: Date | string | number,
  at: Date | string | number,
  intervalHours: number,
): number {
  const elapsedMs = new Date(at).getTime() - new Date(openedAt).getTime();
  if (!Number.isFinite(elapsedMs) || !Number.isInteger(intervalHours) || intervalHours <= 0) return 0;
  return Math.max(0, Math.floor(elapsedMs / (intervalHours * 60 * 60 * 1000)));
}

/** Signed funding P&L: a positive rate is paid by longs and received by shorts. */
export function futuresFunding(input: {
  notional: Decimal.Value;
  ratePercent: Decimal.Value;
  intervals: number;
  side: FuturesSide;
}): string {
  const notional = new Decimal(input.notional);
  const rate = new Decimal(input.ratePercent);
  if (!notional.isFinite() || !rate.isFinite() || notional.isNegative() || input.intervals <= 0) return "0";
  const sideSign = input.side === "LONG" ? -1 : 1;
  return notional.times(rate).div(100).times(Math.floor(input.intervals)).times(sideSign).toString();
}

/** Size a position so an entry-to-stop move loses a fixed account percentage. */
export function riskSizedOrder(input: {
  accountEquity: Decimal.Value;
  riskPercent: Decimal.Value;
  entryPrice: Decimal.Value;
  stopLoss: Decimal.Value;
  leverage: number;
}): RiskSizedOrder | null {
  const equity = new Decimal(input.accountEquity);
  const riskPercent = new Decimal(input.riskPercent);
  const entry = new Decimal(input.entryPrice);
  const stop = new Decimal(input.stopLoss);
  const leverage = new Decimal(input.leverage);
  if (
    !equity.isFinite() || !riskPercent.isFinite() || !entry.isFinite() || !stop.isFinite() ||
    equity.lessThanOrEqualTo(0) || riskPercent.lessThanOrEqualTo(0) || riskPercent.greaterThan(100) ||
    entry.lessThanOrEqualTo(0) || stop.lessThanOrEqualTo(0) || entry.equals(stop) ||
    !leverage.isInteger() || leverage.lessThanOrEqualTo(0)
  ) return null;

  const riskAmount = equity.times(riskPercent).div(100);
  const quantity = riskAmount.div(entry.minus(stop).abs());
  const notional = quantity.times(entry);
  return {
    riskAmount: riskAmount.toString(),
    quantity: quantity.toString(),
    notional: notional.toString(),
    margin: notional.div(leverage).toString(),
  };
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
  maintenanceMarginRatePercent?: Decimal.Value;
  exitFeeRateBps?: Decimal.Value;
  fundingPnl?: Decimal.Value;
}): FuturesMetrics {
  const entry = new Decimal(input.entryPrice);
  const mark = new Decimal(input.markPrice);
  const margin = new Decimal(input.margin);
  const leverage = new Decimal(input.leverage);
  const leveragedNotional = margin.times(leverage);
  const quantity = input.quantity === undefined ? leveragedNotional.div(entry) : new Decimal(input.quantity);
  const notional = quantity.times(entry);
  const maintenanceRate = new Decimal(input.maintenanceMarginRatePercent ?? 0).div(100);
  const exitFeeRate = new Decimal(input.exitFeeRateBps ?? 0).div(10_000);
  const fundingPnl = new Decimal(input.fundingPnl ?? 0);
  const direction = input.side === "LONG" ? new Decimal(1) : new Decimal(-1);
  const rawPnl = mark.minus(entry).times(quantity).times(direction);
  const pnl = Decimal.max(rawPnl, margin.negated());
  const exitFee = mark.times(quantity).times(exitFeeRate);
  const equity = Decimal.max(margin.plus(pnl).minus(exitFee).plus(fundingPnl), 0);
  const maintenanceMargin = mark.times(quantity).times(maintenanceRate);
  const collateral = margin.plus(fundingPnl);
  const liquidationPrice = input.side === "LONG"
    ? entry.times(quantity).minus(collateral).div(quantity.times(new Decimal(1).minus(exitFeeRate).minus(maintenanceRate)))
    : collateral.plus(entry.times(quantity)).div(quantity.times(new Decimal(1).plus(exitFeeRate).plus(maintenanceRate)));
  const safeLiquidationPrice = Decimal.max(liquidationPrice, 0);
  const liquidated = equity.lessThanOrEqualTo(maintenanceMargin);
  const liquidationDistancePercent = mark.isZero()
    ? 0
    : safeLiquidationPrice.minus(mark).abs().div(mark).times(100).toNumber();

  return {
    notional: notional.toString(),
    quantity: quantity.toString(),
    liquidationPrice: safeLiquidationPrice.toString(),
    pnl: pnl.toString(),
    equity: equity.toString(),
    roe: margin.isZero() ? 0 : pnl.div(margin).times(100).toNumber(),
    liquidated,
    maintenanceMargin: maintenanceMargin.toString(),
    liquidationDistancePercent,
  };
}
