"use client";

import { useMemo } from "react";
import { futuresAnalytics } from "@/lib/futures-analytics";
import { fmtSignedUsd, fmtUsd } from "@/lib/format";
import type { FuturesPosition } from "@/lib/types";

export default function FuturesAnalyticsPanel({ positions }: { positions: FuturesPosition[] }) {
  const stats = useMemo(() => futuresAnalytics(positions), [positions]);
  const curve = useMemo(() => {
    if (!stats.curve.length) return null;
    const points = [{ time: stats.curve[0].time - 1, equity: 0 }, ...stats.curve];
    const values = points.map((point) => point.equity);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const padding = Math.max((max - min) * 0.12, 1);
    const yMin = min - padding;
    const yMax = max + padding;
    const x = (index: number) => 8 + (index / Math.max(points.length - 1, 1)) * 584;
    const y = (value: number) => 8 + ((yMax - value) / (yMax - yMin)) * 154;
    return { points, x, y, zeroY: y(0) };
  }, [stats.curve]);

  return (
    <div className="panel futures-analytics-panel">
      <div className="panel-header"><div><span className="panel-title">PERFORMANCE ANALYTICS</span><small>FULLY CLOSED FUTURES TRADES</small></div><span className="position-count">{stats.trades} TRADES</span></div>
      <div className="analytics-kpis">
        <Metric label="NET P&L" value={fmtSignedUsd(stats.netPnl)} tone={stats.netPnl >= 0 ? "green" : "red"} />
        <Metric label="WIN RATE" value={`${stats.winRate.toFixed(1)}%`} />
        <Metric label="EXPECTANCY" value={fmtSignedUsd(stats.expectancy)} />
        <Metric label="PROFIT FACTOR" value={stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)} />
        <Metric label="PAYOFF RATIO" value={stats.payoffRatio === null ? "—" : stats.payoffRatio.toFixed(2)} />
        <Metric label="MAX DRAWDOWN" value={fmtUsd(stats.maxDrawdown)} tone="red" />
        <Metric label="AVERAGE R" value={stats.averageR === null ? "—" : `${stats.averageR >= 0 ? "+" : ""}${stats.averageR.toFixed(2)}R`} />
        <Metric label="AVG HOLD" value={`${stats.averageHoldHours.toFixed(1)}H`} />
      </div>
      <div className="analytics-body">
        <div className="equity-curve">
          <div className="analytics-subhead"><span>CUMULATIVE REALIZED P&L</span><b>{fmtSignedUsd(stats.netPnl)}</b></div>
          {curve ? <svg viewBox="0 0 600 170" role="img" aria-label="Cumulative realized futures profit and loss"><line x1="8" x2="592" y1={curve.zeroY} y2={curve.zeroY} className="equity-zero" /><polyline points={curve.points.map((point, index) => `${curve.x(index)},${curve.y(point.equity)}`).join(" ")} className={`equity-line ${stats.netPnl >= 0 ? "positive" : "negative"}`} />{curve.points.slice(1).map((point, index) => <circle key={point.time} cx={curve.x(index + 1)} cy={curve.y(point.equity)} r="3" className="equity-point"><title>{new Date(point.time).toLocaleString()} · {fmtSignedUsd(point.equity)}</title></circle>)}</svg> : <div className="analytics-empty">CLOSE A TRADE TO BUILD THE CURVE</div>}
        </div>
        <div className="analytics-breakdown">
          <div className="analytics-subhead"><span>ASSET / SIDE</span><b>{stats.wins}W · {stats.losses}L</b></div>
          {stats.breakdown.length ? <table><thead><tr><th>GROUP</th><th>TRADES</th><th>WIN %</th><th>P&L</th></tr></thead><tbody>{stats.breakdown.map((group) => <tr key={group.key}><td>{group.key}</td><td>{group.trades}</td><td>{group.winRate.toFixed(0)}%</td><td className={group.pnl >= 0 ? "profit-positive" : "profit-negative"}>{fmtSignedUsd(group.pnl)}</td></tr>)}</tbody></table> : <div className="analytics-empty">NO CLOSED TRADES YET</div>}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return <div className={`analytics-metric ${tone ? `tone-${tone}` : ""}`}><span>{label}</span><b>{value}</b></div>;
}
