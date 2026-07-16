// Pure technical-analysis primitives — the quant layer.
//
// Like calculations.ts, everything here is pure and decimal-exact (decimal.js),
// so the same functions can drive the live "Signals" strip and the backtester
// with identical, reproducible numbers. Functions take a plain array of closing
// prices (oldest → newest) and return an array aligned to the input: the warmup
// period before an indicator is defined is filled with `null`.

import Decimal from "decimal.js";

export type SignalType = "BUY" | "SELL" | "HOLD";

/** A single computed trading signal for one asset at one point in time. */
export interface Signal {
  type: SignalType;
  reason: string; // human-readable explanation of why
  strength: number; // 0..1 — how strong the conviction is
  rsi: number | null;
  smaShort: number | null;
  smaLong: number | null;
}

function dec(v: Decimal.Value): Decimal {
  return new Decimal(v);
}

/** Simple Moving Average. Result[i] is the mean of closes[i-period+1..i]. */
export function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0) return out;

  let window = dec(0);
  for (let i = 0; i < closes.length; i++) {
    window = window.plus(closes[i]);
    if (i >= period) window = window.minus(closes[i - period]);
    if (i >= period - 1) out[i] = window.div(period).toNumber();
  }
  return out;
}

/** Exponential Moving Average, seeded with the SMA of the first `period`. */
export function ema(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length < period) return out;

  const k = dec(2).div(period + 1); // smoothing factor
  let seed = dec(0);
  for (let i = 0; i < period; i++) seed = seed.plus(closes[i]);
  let prev = seed.div(period);
  out[period - 1] = prev.toNumber();

  for (let i = period; i < closes.length; i++) {
    // ema = close * k + prevEma * (1 - k)
    prev = dec(closes[i]).times(k).plus(prev.times(dec(1).minus(k)));
    out[i] = prev.toNumber();
  }
  return out;
}

/** Relative Strength Index using Wilder's smoothing (classic 14-period). */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let avgGain = dec(0);
  let avgLoss = dec(0);

  // Seed with the simple average of the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const change = dec(closes[i]).minus(closes[i - 1]);
    if (change.isPositive()) avgGain = avgGain.plus(change);
    else avgLoss = avgLoss.plus(change.abs());
  }
  avgGain = avgGain.div(period);
  avgLoss = avgLoss.div(period);
  out[period] = rsiFrom(avgGain, avgLoss);

  // Wilder smoothing for the rest of the series.
  for (let i = period + 1; i < closes.length; i++) {
    const change = dec(closes[i]).minus(closes[i - 1]);
    const gain = change.isPositive() ? change : dec(0);
    const loss = change.isNegative() ? change.abs() : dec(0);
    avgGain = avgGain.times(period - 1).plus(gain).div(period);
    avgLoss = avgLoss.times(period - 1).plus(loss).div(period);
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: Decimal, avgLoss: Decimal): number {
  if (avgLoss.isZero()) return 100; // no losses → maximally overbought
  const rs = avgGain.div(avgLoss);
  return dec(100).minus(dec(100).div(rs.plus(1))).toNumber();
}

/** Last non-null value of an indicator series, or null. */
function last(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i];
  }
  return null;
}

export interface SignalConfig {
  shortPeriod: number; // fast SMA
  longPeriod: number; // slow SMA
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  shortPeriod: 20,
  longPeriod: 50,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
};

/**
 * Combine an SMA trend with RSI into one actionable signal.
 *
 * Rules (intentionally simple and explainable — not financial advice):
 *  - RSI extremes are mean-reversion triggers: oversold → BUY, overbought → SELL.
 *  - Otherwise follow the trend: fast SMA above slow SMA is bullish (BUY bias),
 *    below is bearish (SELL bias); too little data or a flat trend is HOLD.
 */
export function computeSignal(
  closes: number[],
  config: SignalConfig = DEFAULT_SIGNAL_CONFIG,
): Signal {
  const smaShort = last(sma(closes, config.shortPeriod));
  const smaLong = last(sma(closes, config.longPeriod));
  const rsiNow = last(rsi(closes, config.rsiPeriod));

  const base: Pick<Signal, "rsi" | "smaShort" | "smaLong"> = {
    rsi: rsiNow,
    smaShort,
    smaLong,
  };

  if (rsiNow !== null && rsiNow <= config.rsiOversold) {
    const strength = clamp01((config.rsiOversold - rsiNow) / config.rsiOversold + 0.5);
    return { type: "BUY", reason: `Oversold (RSI ${rsiNow.toFixed(0)})`, strength, ...base };
  }
  if (rsiNow !== null && rsiNow >= config.rsiOverbought) {
    const strength = clamp01((rsiNow - config.rsiOverbought) / (100 - config.rsiOverbought) + 0.5);
    return { type: "SELL", reason: `Overbought (RSI ${rsiNow.toFixed(0)})`, strength, ...base };
  }

  if (smaShort !== null && smaLong !== null) {
    const spread = (smaShort - smaLong) / smaLong; // relative gap
    if (spread > 0.005) {
      return {
        type: "BUY",
        reason: `Uptrend (SMA${config.shortPeriod} > SMA${config.longPeriod})`,
        strength: clamp01(Math.abs(spread) * 10 + 0.2),
        ...base,
      };
    }
    if (spread < -0.005) {
      return {
        type: "SELL",
        reason: `Downtrend (SMA${config.shortPeriod} < SMA${config.longPeriod})`,
        strength: clamp01(Math.abs(spread) * 10 + 0.2),
        ...base,
      };
    }
  }

  return {
    type: "HOLD",
    reason: closes.length < config.longPeriod ? "Not enough history" : "No clear trend",
    strength: 0.1,
    ...base,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
