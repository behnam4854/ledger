"use client";

import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { fmtUsd } from "@/lib/format";

type Interval = "1h" | "4h" | "1d";

interface ChartPosition {
  id: number;
  side: "LONG" | "SHORT";
  entryPrice: string;
  stopLoss: string | null;
  takeProfit: string | null;
  liquidationPrice: number;
}

export default function FuturesChart({ asset, markPrice, positions }: {
  asset: string;
  markPrice: number;
  positions: ChartPosition[];
}) {
  const [interval, setInterval] = useState<Interval>("1h");
  const [candles, setCandles] = useState<{ time: number; close: number }[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hovered, setHovered] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.fetchFuturesChart(asset, interval)
      .then((data) => {
        if (!active) return;
        setCandles(data.candles);
        setSource(data.source);
      })
      .catch((reason) => {
        if (!active) return;
        setCandles([]);
        setError(reason instanceof Error ? reason.message : "Chart data unavailable");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [asset, interval]);

  useEffect(() => {
    if (!positions.some((position) => position.id === selectedId)) setSelectedId(positions[0]?.id ?? null);
  }, [positions, selectedId]);

  const selected = positions.find((position) => position.id === selectedId) ?? null;
  const chart = useMemo(() => {
    const points = [...candles];
    if (markPrice > 0) points.push({ time: Date.now(), close: markPrice });
    if (points.length < 2) return null;
    const overlays = selected ? [
      { label: "ENTRY", value: Number(selected.entryPrice), color: "var(--text-bright)" },
      { label: "SL", value: Number(selected.stopLoss), color: "var(--red)" },
      { label: "TP", value: Number(selected.takeProfit), color: "var(--green)" },
      { label: "LIQ", value: selected.liquidationPrice, color: "var(--amber)" },
    ].filter((line) => line.value > 0) : [];
    const values = [...points.map((point) => point.close), ...overlays.map((line) => line.value)];
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.002);
    const min = rawMin - padding;
    const max = rawMax + padding;
    const x = (index: number) => 56 + (index / Math.max(points.length - 1, 1)) * 890;
    const y = (value: number) => 18 + ((max - value) / Math.max(max - min, 1)) * 260;
    return { points, overlays, min, max, x, y };
  }, [candles, markPrice, selected]);

  const activePoint = chart && hovered !== null ? chart.points[hovered] : null;

  return (
    <div className="panel futures-chart-panel">
      <div className="panel-header chart-header">
        <div>
          <span className="panel-title">MARK PRICE CHART · {asset}/USDT</span>
          <small>{source === "BINANCE_FUTURES" ? "BINANCE FUTURES MARK KLINES" : source ? "COINGECKO DAILY FALLBACK" : "LOADING MARKET HISTORY"}</small>
        </div>
        <div className="chart-controls">
          {positions.length > 0 && (
            <select aria-label="Chart position overlay" value={selectedId ?? ""} onChange={(event) => setSelectedId(Number(event.target.value))}>
              {positions.map((position) => <option key={position.id} value={position.id}>#{position.id} {position.side} OVERLAYS</option>)}
            </select>
          )}
          <div className="chart-timeframes">
            {(["1h", "4h", "1d"] as Interval[]).map((value) => (
              <button type="button" key={value} className={interval === value ? "active" : ""} onClick={() => setInterval(value)}>{value.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>
      {loading && <div className="chart-empty">LOADING MARK-PRICE HISTORY…</div>}
      {!loading && (error || !chart) && <div className="chart-empty">{error || "NOT ENOUGH CHART DATA"}</div>}
      {!loading && chart && (
        <div className="chart-canvas-wrap">
          <svg className="futures-chart-svg" viewBox="0 0 1000 310" role="img" aria-label={`${asset} futures mark-price chart`}
            onMouseLeave={() => setHovered(null)}
            onMouseMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const viewX = ((event.clientX - bounds.left) / bounds.width) * 1000;
              const index = Math.round(((viewX - 56) / 890) * (chart.points.length - 1));
              setHovered(Math.max(0, Math.min(chart.points.length - 1, index)));
            }}>
            {[0, 1, 2, 3, 4].map((step) => {
              const value = chart.max - ((chart.max - chart.min) * step) / 4;
              const y = chart.y(value);
              return <g key={step}><line x1="56" x2="946" y1={y} y2={y} className="chart-grid-line" /><text x="4" y={y + 4} className="chart-axis-label">{fmtUsd(value)}</text></g>;
            })}
            <polyline className="chart-price-line" points={chart.points.map((point, index) => `${chart.x(index)},${chart.y(point.close)}`).join(" ")} />
            {chart.overlays.map((line) => {
              const y = chart.y(line.value);
              return <g key={line.label}><line x1="56" x2="946" y1={y} y2={y} stroke={line.color} className="chart-overlay-line" /><text x="952" y={y + 4} fill={line.color} className="chart-overlay-label">{line.label}</text></g>;
            })}
            {activePoint && hovered !== null && <g><line x1={chart.x(hovered)} x2={chart.x(hovered)} y1="18" y2="278" className="chart-crosshair" /><circle cx={chart.x(hovered)} cy={chart.y(activePoint.close)} r="5" className="chart-hover-dot" /></g>}
          </svg>
          {activePoint && <div className="chart-tooltip"><b>{fmtUsd(activePoint.close)}</b><span>{new Date(activePoint.time).toLocaleString()}</span></div>}
        </div>
      )}
    </div>
  );
}
