"use client";

import { useMemo } from "react";
import { completedFundingIntervals, futuresFee, futuresFunding, futuresMetrics } from "@/lib/futures";
import { fmtSignedUsd, fmtUsd } from "@/lib/format";
import { portfolioValuation } from "@/lib/calculations";
import type { FuturesAccountResponse, FuturesActivity, Portfolio, PriceMap } from "@/lib/types";

interface DashboardProps {
  portfolio: Portfolio;
  futures: FuturesAccountResponse;
  futuresActivity: FuturesActivity[];
  prices: PriceMap;
}

interface ExposureRow { asset: string; spot: number; long: number; short: number; total: number }
interface HistoryRow { id: string; time: number; label: string; detail: string; value: number | null; tone: "positive" | "negative" | "neutral" }

export default function UnifiedDashboard({ portfolio, futures, futuresActivity, prices }: DashboardProps) {
  const dashboard = useMemo(() => {
    const spot = portfolioValuation(portfolio.buys, prices);
    const spotRealized = portfolio.sells.reduce((sum, sell) => sum + Number(sell.profit), 0);
    const spotCost = portfolio.buys.reduce((sum, buy) => sum + Number(buy.amount) * Number(buy.price), 0);
    const remainingCost = portfolio.buys.reduce((sum, buy) => sum + Number(buy.remaining) * Number(buy.price), 0);
    const spotUnrealized = spot.holdingsValue - remainingCost;
    let futuresOpenEquity = 0;
    let futuresUnrealized = 0;
    let futuresRealized = 0;
    let futuresCapital = 0;
    const exposure = new Map<string, ExposureRow>();

    for (const asset of spot.byAsset) {
      if (asset.value > 0) exposure.set(asset.asset, { asset: asset.asset, spot: asset.value, long: 0, short: 0, total: asset.value });
    }
    for (const position of futures.positions) {
      futuresCapital += Number(position.initialMargin ?? position.margin);
      if (position.status === "CLOSED") {
        futuresRealized += Number(position.realizedPnl ?? 0);
        continue;
      }
      const markPrice = prices[position.asset] || Number(position.entryPrice);
      const intervals = completedFundingIntervals(position.openedAt, Date.now(), position.fundingIntervalHours ?? 8);
      const funding = Number(futuresFunding({
        notional: Number(position.quantity) * Number(position.entryPrice),
        ratePercent: position.fundingRate ?? "0",
        intervals,
        side: position.side,
      }));
      const metrics = futuresMetrics({
        side: position.side,
        entryPrice: position.entryPrice,
        markPrice,
        margin: position.margin,
        leverage: position.leverage,
        quantity: position.quantity,
        maintenanceMarginRatePercent: position.maintenanceMarginRate ?? "0.5",
        exitFeeRateBps: position.feeRateBps ?? "0",
        fundingPnl: funding,
      });
      const exitFee = Number(futuresFee(Number(position.quantity) * markPrice, position.feeRateBps ?? "0"));
      const netPnl = Number(metrics.pnl) - Number(position.entryFee ?? 0) - exitFee + funding;
      futuresUnrealized += netPnl;
      futuresOpenEquity += Math.max(Number(position.margin) + Number(metrics.pnl) - exitFee + funding, 0);
      const row = exposure.get(position.asset) ?? { asset: position.asset, spot: 0, long: 0, short: 0, total: 0 };
      const notional = Math.abs(Number(position.quantity) * markPrice);
      row[position.side === "LONG" ? "long" : "short"] += notional;
      row.total = row.spot + row.long + row.short;
      exposure.set(position.asset, row);
    }

    const spotEquity = portfolio.usd + spot.holdingsValue;
    const futuresEquity = futures.balance + futuresOpenEquity;
    const combinedEquity = spotEquity + futuresEquity;
    const combinedPnl = spotRealized + spotUnrealized + futuresRealized + futuresUnrealized;
    const exposureRows = [...exposure.values()].sort((a, b) => b.total - a.total);
    const grossExposure = exposureRows.reduce((sum, row) => sum + row.total, 0);
    const investedCapital = spotCost + futuresCapital;
    const returnPct = investedCapital > 0 ? (combinedPnl / investedCapital) * 100 : 0;

    const spotHistory: HistoryRow[] = [
      ...portfolio.buys.map((buy) => ({
        id: `buy-${buy.id}`, time: new Date(buy.date).getTime(), label: `BOUGHT ${buy.asset}`,
        detail: `${buy.amount} ${buy.asset} · ${buy.wallet}`, value: -Number(buy.amount) * Number(buy.price), tone: "neutral" as const,
      })),
      ...portfolio.sells.map((sell) => {
        const buy = portfolio.buys.find((item) => item.id === sell.buyId);
        const profit = Number(sell.profit);
        return { id: `sell-${sell.id}`, time: new Date(sell.sellDate).getTime(), label: `SOLD ${buy?.asset ?? "ASSET"}`,
          detail: `${sell.amount} ${buy?.asset ?? ""} · realized ${fmtSignedUsd(profit)}`, value: Number(sell.amount) * Number(sell.sellPrice), tone: profit >= 0 ? "positive" as const : "negative" as const };
      }),
    ];
    const futuresHistory: HistoryRow[] = futuresActivity.map((activity) => {
      const pnl = Number(activity.details.realizedPnl);
      return {
        id: `future-${activity.id}`, time: new Date(activity.createdAt).getTime(),
        label: activity.action.replaceAll("_", " "), detail: `${activity.asset} ${activity.side} · position #${activity.positionId}`,
        value: Number.isFinite(pnl) ? pnl : null,
        tone: Number.isFinite(pnl) ? (pnl >= 0 ? "positive" : "negative") : "neutral",
      };
    });

    return {
      spotEquity, futuresEquity, combinedEquity, combinedPnl, returnPct, spotRealized, spotUnrealized,
      futuresRealized, futuresUnrealized, futuresOpen: futures.positions.filter((position) => position.status === "OPEN").length,
      exposureRows, grossExposure,
      history: [...spotHistory, ...futuresHistory].sort((a, b) => b.time - a.time).slice(0, 8),
    };
  }, [futures, futuresActivity, portfolio, prices]);

  const positive = dashboard.combinedPnl >= 0;
  return (
    <section className="panel unified-dashboard" data-testid="unified-dashboard">
      <div className="panel-header unified-dashboard-head">
        <div><span className="panel-title">UNIFIED DASHBOARD</span><small>SPOT + FUTURES COMMAND CENTER</small></div>
        <span className={`unified-return ${positive ? "positive" : "negative"}`}>{dashboard.returnPct >= 0 ? "+" : ""}{dashboard.returnPct.toFixed(2)}% <small>COMBINED RETURN</small></span>
      </div>
      <div className="unified-hero">
        <div className="unified-total">
          <span>COMBINED EQUITY</span>
          <strong>{fmtUsd(dashboard.combinedEquity)}</strong>
          <b className={positive ? "profit-positive" : "profit-negative"}>{fmtSignedUsd(dashboard.combinedPnl)} TOTAL P&amp;L</b>
        </div>
        <div className="unified-split">
          <AccountSlice label="SPOT EQUITY" value={dashboard.spotEquity} sub={`REALIZED ${fmtSignedUsd(dashboard.spotRealized)} · OPEN ${fmtSignedUsd(dashboard.spotUnrealized)}`} />
          <AccountSlice label="FUTURES EQUITY" value={dashboard.futuresEquity} sub={`REALIZED ${fmtSignedUsd(dashboard.futuresRealized)} · OPEN ${fmtSignedUsd(dashboard.futuresUnrealized)}`} />
          <AccountSlice label="GROSS EXPOSURE" value={dashboard.grossExposure} sub={`${dashboard.futuresOpen} OPEN FUTURES POSITION${dashboard.futuresOpen === 1 ? "" : "S"}`} />
        </div>
      </div>
      <div className="unified-grid">
        <div className="unified-section">
          <div className="unified-section-title"><span>EXPOSURE BY ASSET</span><b>{fmtUsd(dashboard.grossExposure)}</b></div>
          {dashboard.exposureRows.length === 0 ? <div className="unified-empty">NO OPEN EXPOSURE</div> : dashboard.exposureRows.map((row) => {
            const max = dashboard.grossExposure || 1;
            return <div className="exposure-row" key={row.asset}>
              <div className="exposure-head"><b>{row.asset}</b><span>{fmtUsd(row.total)}</span></div>
              <div className="exposure-track">
                <i className="spot" style={{ width: `${(row.spot / max) * 100}%` }} />
                <i className="long" style={{ width: `${(row.long / max) * 100}%` }} />
                <i className="short" style={{ width: `${(row.short / max) * 100}%` }} />
              </div>
              <div className="exposure-detail"><span>SPOT {fmtUsd(row.spot)}</span><span>LONG {fmtUsd(row.long)}</span><span>SHORT {fmtUsd(row.short)}</span></div>
            </div>;
          })}
          <div className="exposure-legend"><span><i className="spot" />SPOT</span><span><i className="long" />LONG</span><span><i className="short" />SHORT</span></div>
        </div>
        <div className="unified-section">
          <div className="unified-section-title"><span>RECENT CROSS-ACCOUNT HISTORY</span><b>{dashboard.history.length} EVENTS</b></div>
          {dashboard.history.length === 0 ? <div className="unified-empty">YOUR SPOT AND FUTURES ACTIVITY WILL APPEAR HERE</div> : (
            <div className="unified-history">{dashboard.history.map((row) => <div className="unified-history-row" key={row.id}>
              <time dateTime={new Date(row.time).toISOString()}>{new Date(row.time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}<small>{new Date(row.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small></time>
              <div><b>{row.label}</b><span>{row.detail}</span></div>
              <strong className={row.tone === "positive" ? "profit-positive" : row.tone === "negative" ? "profit-negative" : ""}>{row.value === null ? "—" : fmtSignedUsd(row.value)}</strong>
            </div>)}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function AccountSlice({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <div><span>{label}</span><b>{fmtUsd(value)}</b><small>{sub}</small></div>;
}
