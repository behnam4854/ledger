import type { FuturesPosition } from "./types";

export interface FuturesAnalytics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  averageWin: number;
  averageLoss: number;
  payoffRatio: number | null;
  expectancy: number;
  maxDrawdown: number;
  averageR: number | null;
  averageHoldHours: number;
  curve: { time: number; equity: number }[];
  breakdown: { key: string; trades: number; wins: number; pnl: number; winRate: number }[];
}

export function futuresAnalytics(positions: FuturesPosition[]): FuturesAnalytics {
  const closed = positions
    .filter((position) => position.status === "CLOSED" && position.closedAt)
    .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());
  const pnls = closed.map((position) => Number(position.realizedPnl ?? 0));
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = losses.reduce((sum, pnl) => sum + pnl, 0);
  const netPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? grossLoss / losses.length : 0;
  const curve: FuturesAnalytics["curve"] = [];
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const position of closed) {
    equity += Number(position.realizedPnl ?? 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    curve.push({ time: new Date(position.closedAt!).getTime(), equity });
  }
  const rMultiples = closed
    .filter((position) => Number(position.plannedRisk) > 0)
    .map((position) => Number(position.realizedPnl ?? 0) / Number(position.plannedRisk));
  const averageHoldHours = closed.length
    ? closed.reduce((sum, position) => sum + Math.max(0, new Date(position.closedAt!).getTime() - new Date(position.openedAt).getTime()) / 3_600_000, 0) / closed.length
    : 0;
  const groups = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const position of closed) {
    const key = `${position.asset} ${position.side}`;
    const group = groups.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    const pnl = Number(position.realizedPnl ?? 0);
    group.trades += 1;
    group.wins += pnl > 0 ? 1 : 0;
    group.pnl += pnl;
    groups.set(key, group);
  }
  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null,
    averageWin,
    averageLoss,
    payoffRatio: averageLoss < 0 ? averageWin / Math.abs(averageLoss) : null,
    expectancy: closed.length ? netPnl / closed.length : 0,
    maxDrawdown,
    averageR: rMultiples.length ? rMultiples.reduce((sum, value) => sum + value, 0) / rMultiples.length : null,
    averageHoldHours,
    curve,
    breakdown: [...groups.entries()].map(([key, group]) => ({
      key,
      ...group,
      winRate: group.trades ? (group.wins / group.trades) * 100 : 0,
    })).sort((a, b) => b.pnl - a.pnl),
  };
}
