"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import AppNav from "../AppNav";
import FuturesChart from "./FuturesChart";
import FuturesAnalyticsPanel from "./FuturesAnalyticsPanel";
import * as api from "@/lib/api";
import { toFuturesCsv } from "@/lib/csv";
import { completedFundingIntervals, futuresFee, futuresFunding, futuresMetrics, riskSizedOrder } from "@/lib/futures";
import { fmtQty, fmtSignedPct, fmtSignedUsd, fmtUsd } from "@/lib/format";
import type {
  CoinDefinition,
  FuturesAccountResponse,
  FuturesPosition,
  FuturesMarketQuote,
  FuturesSide,
  PriceMap,
} from "@/lib/types";

interface LivePosition extends FuturesPosition {
  markPrice: number;
  pnl: number;
  equity: number;
  roe: number;
  liquidationPrice: number;
  liquidated: boolean;
  notional: number;
  stopHit: boolean;
  takeHit: boolean;
  liveGrossPnl: number;
  accruedFundingPnl: number;
  estimatedExitFee: number;
  maintenanceMargin: number;
  liquidationDistancePercent: number;
}

export default function FuturesApp() {
  const { data: session } = useSession();
  const [account, setAccount] = useState<FuturesAccountResponse>({ balance: 0, positions: [] });
  const [coins, setCoins] = useState<CoinDefinition[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [futuresQuotes, setFuturesQuotes] = useState<Record<string, FuturesMarketQuote>>({});
  const [marketStatus, setMarketStatus] = useState<"fetching" | "live" | "offline">("fetching");
  const [clock, setClock] = useState("--:--:--");
  const [order, setOrder] = useState<{
    asset: string;
    side: FuturesSide;
    margin: string;
    leverage: number;
    entryPrice: string;
    stopLoss: string;
    takeProfit: string;
    sizingMode: "MANUAL" | "RISK";
    riskPercent: string;
    feeRateBps: string;
    fundingRate: string;
    fundingIntervalHours: number;
    maintenanceMarginRate: string;
    autoCloseEnabled: boolean;
  }>({
    asset: "BTC",
    side: "LONG",
    margin: "250",
    leverage: 3,
    entryPrice: "",
    stopLoss: "",
    takeProfit: "",
    sizingMode: "MANUAL",
    riskPercent: "1",
    feeRateBps: "5",
    fundingRate: "0.01",
    fundingIntervalHours: 8,
    maintenanceMarginRate: "0.5",
    autoCloseEnabled: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [exitPrices, setExitPrices] = useState<Record<number, string>>({});
  const [closePercents, setClosePercents] = useState<Record<number, number>>({});
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [adjustments, setAdjustments] = useState<Record<number, { stopLoss: string; takeProfit: string; marginDelta: string }>>({});
  const [journalId, setJournalId] = useState<number | null>(null);
  const [journalDraft, setJournalDraft] = useState({ setup: "", tags: "", notes: "", screenshot: "" });
  const [closedEditId, setClosedEditId] = useState<number | null>(null);
  const [closedDraft, setClosedDraft] = useState<api.ClosedFuturesTradeInput | null>(null);
  const [error, setError] = useState("");

  const loadAccount = useCallback(async () => {
    setAccount(await api.fetchFuturesAccount());
  }, []);

  const refreshPrices = useCallback(async () => {
    setMarketStatus("fetching");
    try {
      const data = await api.fetchPrices();
      setCoins(data.coins);
      setPrices(data.prices);
      try {
        const market = await api.fetchFuturesMarket();
        setFuturesQuotes(market.quotes);
        const triggers = await api.processFuturesTriggers();
        if (triggers.executed.length) await loadAccount();
      } catch {
        setFuturesQuotes({});
      }
      setMarketStatus(data.status === "live" ? "live" : "offline");
    } catch {
      setMarketStatus("offline");
    }
  }, [loadAccount]);

  const markPrices = useMemo<PriceMap>(() => Object.fromEntries(
    coins.map((coin) => [coin.symbol, futuresQuotes[coin.symbol]?.markPrice || prices[coin.symbol] || 0]),
  ), [coins, futuresQuotes, prices]);

  useEffect(() => {
    loadAccount().catch((reason) => setError(reason instanceof Error ? reason.message : "Failed to load account"));
    refreshPrices();
  }, [loadAccount, refreshPrices]);

  useEffect(() => {
    const id = setInterval(refreshPrices, 10_000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (journalId !== null || account.positions.length === 0) return;
    const position = account.positions[0];
    setJournalId(position.id);
    setJournalDraft({
      setup: position.journalSetup ?? "",
      tags: position.journalTags ?? "",
      notes: position.journalNotes ?? "",
      screenshot: position.journalScreenshot ?? "",
    });
  }, [account.positions, journalId]);

  const openPositions = useMemo<LivePosition[]>(() => account.positions
    .filter((position) => position.status === "OPEN")
    .map((position) => {
      const markPrice = markPrices[position.asset] ?? Number(position.entryPrice);
      const notional = Number(position.quantity) * Number(position.entryPrice);
      const entryFee = Number(position.entryFee ?? 0);
      const estimatedExitFee = Number(futuresFee(Number(position.quantity) * markPrice, position.feeRateBps ?? "0"));
      const intervals = completedFundingIntervals(
        position.openedAt,
        Date.now(),
        position.fundingIntervalHours ?? 8,
      );
      const fundingPnl = Number(futuresFunding({
        notional,
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
        fundingPnl,
      });
      const grossPnl = Number(metrics.pnl);
      const pnl = grossPnl - entryFee - estimatedExitFee + fundingPnl;
      const equity = Math.max(Number(position.margin) + grossPnl - estimatedExitFee + fundingPnl, 0);
      const stopLoss = position.stopLoss ? Number(position.stopLoss) : null;
      const takeProfit = position.takeProfit ? Number(position.takeProfit) : null;
      const stopHit = stopLoss !== null && (position.side === "LONG" ? markPrice <= stopLoss : markPrice >= stopLoss);
      const takeHit = takeProfit !== null && (position.side === "LONG" ? markPrice >= takeProfit : markPrice <= takeProfit);
      return {
        ...position,
        markPrice,
        pnl,
        equity,
        roe: Number(position.margin) > 0 ? (pnl / Number(position.margin)) * 100 : 0,
        liquidationPrice: Number(metrics.liquidationPrice),
        liquidated: metrics.liquidated,
        notional,
        stopHit,
        takeHit,
        liveGrossPnl: grossPnl,
        accruedFundingPnl: fundingPnl,
        estimatedExitFee,
        maintenanceMargin: Number(metrics.maintenanceMargin),
        liquidationDistancePercent: metrics.liquidationDistancePercent,
      };
    }), [account.positions, markPrices, clock]);

  const closedPositions = account.positions.filter((position) => position.status === "CLOSED");
  const usedMargin = openPositions.reduce((sum, position) => sum + Number(position.margin), 0);
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + position.pnl, 0);
  const positionEquity = openPositions.reduce((sum, position) => sum + position.equity, 0);
  const accountEquity = account.balance + positionEquity;
  const marginUsage = accountEquity > 0 ? (usedMargin / accountEquity) * 100 : 0;

  const selectedQuote = futuresQuotes[order.asset];
  const selectedPrice = markPrices[order.asset] ?? 0;
  const loggedEntryPrice = Number(order.entryPrice);
  const effectiveEntryPrice = loggedEntryPrice > 0 ? loggedEntryPrice : selectedPrice;
  const orderMargin = Number(order.margin);
  const stopPrice = Number(order.stopLoss);
  const riskDirectionValid = stopPrice > 0 && (
    order.side === "LONG" ? stopPrice < effectiveEntryPrice : stopPrice > effectiveEntryPrice
  );
  const riskSizing = order.sizingMode === "RISK" && riskDirectionValid
    ? riskSizedOrder({
        accountEquity,
        riskPercent: order.riskPercent || "0",
        entryPrice: effectiveEntryPrice,
        stopLoss: stopPrice,
        leverage: order.leverage,
      })
    : null;
  const effectiveOrderMargin = order.sizingMode === "RISK" ? Number(riskSizing?.margin ?? 0) : orderMargin;
  const preview = effectiveEntryPrice > 0 && effectiveOrderMargin > 0
    ? futuresMetrics({
        side: order.side,
        entryPrice: effectiveEntryPrice,
        markPrice: selectedPrice > 0 ? selectedPrice : effectiveEntryPrice,
        margin: effectiveOrderMargin,
        leverage: order.leverage,
        maintenanceMarginRatePercent: order.maintenanceMarginRate,
        exitFeeRateBps: order.feeRateBps || "0",
      })
    : null;
  const previewEntryFee = preview ? Number(futuresFee(preview.notional, order.feeRateBps || "0")) : 0;

  const submitOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.openFuturesPosition({
        asset: order.asset,
        side: order.side,
        margin: String(effectiveOrderMargin),
        leverage: order.leverage,
        entryPrice: order.entryPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        riskPercent: order.sizingMode === "RISK" ? order.riskPercent : "",
        feeRateBps: order.feeRateBps,
        fundingRate: order.fundingRate,
        fundingIntervalHours: order.fundingIntervalHours,
        maintenanceMarginRate: order.maintenanceMarginRate,
        autoCloseEnabled: order.autoCloseEnabled,
      });
      await loadAccount();
      setOrder((current) => ({ ...current, margin: "250", entryPrice: "", stopLoss: "", takeProfit: "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open position");
    } finally {
      setSubmitting(false);
    }
  };

  const closePosition = async (id: number) => {
    setError("");
    setClosingId(id);
    try {
      const position = openPositions.find((item) => item.id === id);
      const percent = closePercents[id] ?? 100;
      const closeQuantity = position ? String(Number(position.quantity) * (percent / 100)) : "";
      await api.closeFuturesPosition(id, exitPrices[id] ?? "", closeQuantity);
      await loadAccount();
      setExitPrices((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not close position");
    } finally {
      setClosingId(null);
    }
  };

  const toggleAdjustment = (position: LivePosition) => {
    if (adjustingId === position.id) return setAdjustingId(null);
    setAdjustments((current) => ({ ...current, [position.id]: {
      stopLoss: position.stopLoss ?? "",
      takeProfit: position.takeProfit ?? "",
      marginDelta: "0",
    } }));
    setAdjustingId(position.id);
  };

  const saveAdjustment = async (id: number) => {
    const draft = adjustments[id];
    if (!draft) return;
    setError("");
    setSubmitting(true);
    try {
      await api.adjustFuturesPosition(id, draft);
      await loadAccount();
      setAdjustingId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not adjust position");
    } finally {
      setSubmitting(false);
    }
  };

  const selectJournalPosition = (id: number) => {
    const position = account.positions.find((item) => item.id === id);
    setJournalId(id);
    setJournalDraft({
      setup: position?.journalSetup ?? "",
      tags: position?.journalTags ?? "",
      notes: position?.journalNotes ?? "",
      screenshot: position?.journalScreenshot ?? "",
    });
  };

  const saveJournal = async () => {
    if (journalId === null) return;
    setError("");
    setSubmitting(true);
    try {
      await api.updateFuturesJournal(journalId, journalDraft);
      await loadAccount();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save journal");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAutomation = async (position: LivePosition) => {
    setError("");
    try {
      await api.setFuturesAutomation(position.id, !position.autoCloseEnabled);
      await loadAccount();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update automatic execution");
    }
  };

  const attachJournalScreenshot = (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("Screenshot must be smaller than 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setJournalDraft((current) => ({ ...current, screenshot: String(reader.result ?? "") }));
    reader.readAsDataURL(file);
  };

  const editClosedTrade = (position: FuturesPosition) => {
    setClosedEditId(position.id);
    setClosedDraft({
      side: position.side,
      leverage: position.leverage,
      margin: position.initialMargin ?? position.margin,
      entryPrice: position.entryPrice,
      exitPrice: position.exitPrice ?? position.entryPrice,
      stopLoss: position.stopLoss ?? "",
      takeProfit: position.takeProfit ?? "",
      feeRateBps: position.feeRateBps ?? "0",
      fundingRate: position.fundingRate ?? "0",
      openedAt: new Date(position.openedAt).toISOString().slice(0, 16),
      closedAt: new Date(position.closedAt ?? Date.now()).toISOString().slice(0, 16),
    });
  };

  const saveClosedTrade = async () => {
    if (closedEditId === null || !closedDraft) return;
    setError("");
    setSubmitting(true);
    try {
      await api.updateClosedFuturesTrade(closedEditId, {
        ...closedDraft,
        openedAt: new Date(closedDraft.openedAt).toISOString(),
        closedAt: new Date(closedDraft.closedAt).toISOString(),
      });
      await loadAccount();
      setClosedEditId(null);
      setClosedDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not edit closed trade");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteClosedTrade = async (position: FuturesPosition) => {
    if (!window.confirm(`Delete closed ${position.asset} ${position.side} trade #${position.id}? Its realized P&L will be reversed from the paper balance.`)) return;
    setError("");
    try {
      await api.deleteClosedFuturesTrade(position.id);
      if (journalId === position.id) setJournalId(null);
      if (closedEditId === position.id) { setClosedEditId(null); setClosedDraft(null); }
      await loadAccount();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete closed trade");
    }
  };

  const exportFutures = () => {
    const csv = toFuturesCsv(account.positions, markPrices);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ledgrs_futures_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="container futures-page">
      <header className="header">
        <div className="logo-section">
          <div className="logo-glyph">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="10" height="10" stroke="var(--accent)" strokeWidth="1.5" />
              <rect x="16" y="2" width="10" height="10" stroke="var(--accent)" strokeWidth="1.5" fill="var(--accent)" fillOpacity="0.15" />
              <rect x="2" y="16" width="10" height="10" stroke="var(--accent)" strokeWidth="1.5" fill="var(--accent)" fillOpacity="0.3" />
              <rect x="16" y="16" width="10" height="10" stroke="var(--amber)" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="brand">
            <div className="brand-name">LEDGRS</div>
            <div className="brand-sub">FUTURES RISK TERMINAL</div>
          </div>
        </div>
        <div className="header-right">
          <div className="sys-clock">{clock}</div>
          {session?.user?.email && (
            <div className="user-info">
              <span className="user-email">{session.user.email}</span>
              <button className="btn-ghost btn-sm" onClick={() => signOut({ callbackUrl: "/auth" })}>LOGOUT</button>
            </div>
          )}
        </div>
      </header>

      <div className="workspace-nav-bar">
        <span className="workspace-nav-label">WORKSPACE</span>
        <AppNav active="futures" />
      </div>

      <div className="futures-banner">
        <div>
          <span className="futures-kicker">SIMULATED EXECUTION</span>
          <h1>FUTURES PAPER DESK</h1>
          <p>Practice isolated-margin positions against futures mark, index, and last-trade prices, with CoinGecko fallback.</p>
        </div>
        <span className={`status-pill ${marketStatus === "live" ? "status-live" : "status-offline"}`}>
          {marketStatus === "live" ? "● MARKET LIVE" : marketStatus === "fetching" ? "● FETCHING" : "● MARKET OFFLINE"}
        </span>
      </div>

      <div className="futures-stats">
        <FuturesStat label="ACCOUNT EQUITY" value={fmtUsd(accountEquity)} tone="bright" />
        <FuturesStat label="AVAILABLE BALANCE" value={fmtUsd(account.balance)} tone="amber" />
        <FuturesStat label="USED MARGIN" value={fmtUsd(usedMargin)} />
        <FuturesStat label="UNREALIZED P&L" value={fmtSignedUsd(unrealizedPnl)} tone={unrealizedPnl >= 0 ? "green" : "red"} />
        <FuturesStat label="MARGIN USAGE" value={`${marginUsage.toFixed(1)}%`} />
      </div>

      {error && <div className="futures-error">{error}</div>}

      <div className="futures-workspace">
        <div className="panel futures-ticket">
          <div className="panel-header">
            <span className="panel-title">ORDER TICKET</span>
            <span className="paper-badge">PAPER ONLY</span>
          </div>
          <form onSubmit={submitOrder} className="futures-order-form">
            <div className="field">
              <label htmlFor="futuresAsset">CONTRACT</label>
              <select id="futuresAsset" value={order.asset} onChange={(event) => setOrder((current) => ({ ...current, asset: event.target.value }))}>
                {coins.map((coin) => <option key={coin.symbol} value={coin.symbol}>{coin.symbol} / USD — {coin.name}</option>)}
              </select>
            </div>

            <div className="side-switch" role="group" aria-label="Position side">
              <button type="button" className={order.side === "LONG" ? "active long" : ""} onClick={() => setOrder((current) => ({ ...current, side: "LONG" }))}>LONG</button>
              <button type="button" className={order.side === "SHORT" ? "active short" : ""} onClick={() => setOrder((current) => ({ ...current, side: "SHORT" }))}>SHORT</button>
            </div>

            <div className="sizing-switch" role="group" aria-label="Position sizing mode">
              <button type="button" className={order.sizingMode === "MANUAL" ? "active" : ""} onClick={() => setOrder((current) => ({ ...current, sizingMode: "MANUAL" }))}>MANUAL MARGIN</button>
              <button type="button" className={order.sizingMode === "RISK" ? "active" : ""} onClick={() => setOrder((current) => ({ ...current, sizingMode: "RISK" }))}>RISK-BASED</button>
            </div>

            {order.sizingMode === "MANUAL" ? (
              <div className="field">
                <label htmlFor="futuresMargin">ISOLATED MARGIN (USD)</label>
                <input id="futuresMargin" type="number" min="1" step="any" value={order.margin} onChange={(event) => setOrder((current) => ({ ...current, margin: event.target.value }))} />
              </div>
            ) : (
              <div className="risk-sizing-box">
                <div className="field">
                  <label htmlFor="futuresRiskPercent">ACCOUNT RISK (%)</label>
                  <input id="futuresRiskPercent" type="number" min="0.01" max="100" step="0.01" value={order.riskPercent} onChange={(event) => setOrder((current) => ({ ...current, riskPercent: event.target.value }))} />
                </div>
                <div className="risk-sizing-result">
                  <span>PLANNED LOSS <b>{riskSizing ? fmtUsd(Number(riskSizing.riskAmount)) : "—"}</b></span>
                  <span>CALCULATED MARGIN <b>{riskSizing ? fmtUsd(Number(riskSizing.margin)) : "—"}</b></span>
                </div>
                {!riskDirectionValid && <span className="field-hint risk-hint">Enter a valid stop-loss on the loss side of entry to calculate size.</span>}
              </div>
            )}

            <div className="field">
              <label htmlFor="futuresEntryPrice">ENTRY PRICE (USD)</label>
              <div className="logged-price-input">
                <input id="futuresEntryPrice" type="number" min="0" step="any" value={order.entryPrice} onChange={(event) => setOrder((current) => ({ ...current, entryPrice: event.target.value }))} placeholder={selectedPrice > 0 ? String(selectedPrice) : "Enter logged entry"} />
                <button type="button" className="btn-ghost btn-sm" disabled={!(selectedPrice > 0)} onClick={() => setOrder((current) => ({ ...current, entryPrice: String(selectedPrice) }))}>USE LIVE</button>
              </div>
              <span className="field-hint">Leave blank to open at the current live mark.</span>
            </div>

            <div className="risk-price-grid">
              <div className="field">
                <label htmlFor="futuresStopLoss">STOP-LOSS (USD)</label>
                <input id="futuresStopLoss" type="number" min="0" step="any" value={order.stopLoss} onChange={(event) => setOrder((current) => ({ ...current, stopLoss: event.target.value }))} placeholder="Optional" />
              </div>
              <div className="field">
                <label htmlFor="futuresTakeProfit">TAKE-PROFIT (USD)</label>
                <input id="futuresTakeProfit" type="number" min="0" step="any" value={order.takeProfit} onChange={(event) => setOrder((current) => ({ ...current, takeProfit: event.target.value }))} placeholder="Optional" />
              </div>
            </div>

            <label className="automation-order-toggle">
              <input type="checkbox" checked={order.autoCloseEnabled} onChange={(event) => setOrder((current) => ({ ...current, autoCloseEnabled: event.target.checked }))} />
              <span><b>AUTOMATIC SL / TP EXECUTION</b><small>{order.autoCloseEnabled ? "Enabled · scans the futures mark every 10 seconds while this terminal is open" : "Disabled · alerts only; close the position manually"}</small></span>
            </label>

            <div className="field">
              <label htmlFor="futuresLeverage">LEVERAGE <b>{order.leverage}x</b></label>
              <input id="futuresLeverage" className="leverage-slider" type="range" min="1" max="20" value={order.leverage} onChange={(event) => setOrder((current) => ({ ...current, leverage: Number(event.target.value) }))} />
              <div className="leverage-marks"><span>1x</span><span>5x</span><span>10x</span><span>15x</span><span>20x</span></div>
            </div>

            <div className="fee-funding-grid">
              <div className="field">
                <label htmlFor="futuresFeeRate">FEE / SIDE (BPS)</label>
                <input id="futuresFeeRate" type="number" min="0" max="1000" step="0.01" value={order.feeRateBps} onChange={(event) => setOrder((current) => ({ ...current, feeRateBps: event.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="futuresFundingRate">FUNDING / INTERVAL (%)</label>
                <input id="futuresFundingRate" type="number" min="-10" max="10" step="0.001" value={order.fundingRate} onChange={(event) => setOrder((current) => ({ ...current, fundingRate: event.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="futuresFundingInterval">INTERVAL (HOURS)</label>
                <input id="futuresFundingInterval" type="number" min="1" max="168" step="1" value={order.fundingIntervalHours} onChange={(event) => setOrder((current) => ({ ...current, fundingIntervalHours: Number(event.target.value) }))} />
              </div>
              <div className="field">
                <label htmlFor="futuresMaintenanceMargin">MAINTENANCE MARGIN (%)</label>
                <input id="futuresMaintenanceMargin" type="number" min="0" max="99" step="0.01" value={order.maintenanceMarginRate} onChange={(event) => setOrder((current) => ({ ...current, maintenanceMarginRate: event.target.value }))} />
              </div>
            </div>

            <div className="order-preview">
              <PreviewRow label="MARK PRICE" value={selectedPrice > 0 ? fmtUsd(selectedPrice) : "—"} />
              <PreviewRow label="INDEX PRICE" value={selectedQuote?.indexPrice ? fmtUsd(selectedQuote.indexPrice) : selectedPrice > 0 ? fmtUsd(selectedPrice) : "—"} />
              <PreviewRow label="LAST PRICE" value={selectedQuote?.lastPrice ? fmtUsd(selectedQuote.lastPrice) : selectedPrice > 0 ? fmtUsd(selectedPrice) : "—"} />
              <PreviewRow label="PRICE SOURCE" value={selectedQuote?.source === "BINANCE_FUTURES" ? `${selectedQuote.exchangeSymbol} · FUTURES` : "COINGECKO FALLBACK"} />
              <PreviewRow label="LOGGED ENTRY" value={effectiveEntryPrice > 0 ? fmtUsd(effectiveEntryPrice) : "—"} />
              <PreviewRow label="POSITION SIZE" value={preview ? fmtUsd(Number(preview.notional)) : "—"} />
              <PreviewRow label="QUANTITY" value={preview ? `${fmtQty(preview.quantity)} ${order.asset}` : "—"} />
              <PreviewRow label="ENTRY FEE" value={preview ? fmtUsd(previewEntryFee) : "—"} danger={previewEntryFee > 0} />
              <PreviewRow label="FUNDING" value={`${order.fundingRate || "0"}% / ${order.fundingIntervalHours}H`} />
              <PreviewRow label="LIVE FUNDING" value={selectedQuote?.fundingRate !== null && selectedQuote?.fundingRate !== undefined ? `${selectedQuote.fundingRate.toFixed(4)}%` : "—"} />
              <PreviewRow label="MAINTENANCE MARGIN" value={preview ? fmtUsd(Number(preview.maintenanceMargin)) : "—"} />
              <PreviewRow label="EST. LIQUIDATION" value={preview ? fmtUsd(Number(preview.liquidationPrice)) : "—"} danger />
              <PreviewRow label="RISK PLAN" value={order.stopLoss || order.takeProfit ? `SL ${order.stopLoss || "—"} · TP ${order.takeProfit || "—"}` : "NOT SET"} />
            </div>

            <button className={`btn-action futures-submit ${order.side.toLowerCase()}`} type="submit" disabled={submitting || !(effectiveEntryPrice > 0) || (order.sizingMode === "RISK" && !riskSizing)}>
              {submitting ? "OPENING..." : `OPEN ${order.side} · ${order.leverage}x`}
            </button>
          </form>
        </div>

        <div className="panel futures-risk-panel">
          <div className="panel-header"><span className="panel-title">RISK CHECK</span></div>
          <div className="risk-gauge">
            <div className="risk-gauge-head"><span>ORDER LEVERAGE</span><b>{order.leverage}x</b></div>
            <div className="risk-track"><div className={`risk-fill risk-${order.leverage <= 3 ? "low" : order.leverage <= 8 ? "medium" : "high"}`} style={{ width: `${(order.leverage / 20) * 100}%` }} /></div>
            <div className="risk-labels"><span>LOW</span><span>EXTREME</span></div>
          </div>
          <div className="risk-callouts">
            <div><b>{order.sizingMode === "RISK" ? `${order.riskPercent || "0"}% account risk` : `${order.leverage}x exposure`}</b><span>{order.sizingMode === "RISK" ? "Margin and quantity are calculated from account equity and the entry-to-stop distance." : `A 1% market move changes position equity by roughly ${order.leverage}%.`}</span></div>
            <div><b>Isolated margin</b><span>Loss on this simulation is capped at the margin assigned to the position.</span></div>
            <div><b>Fee & funding model</b><span>Entry and exit fees are charged on notional. Completed funding intervals are applied when the trade closes.</span></div>
            <div><b>Automatic execution</b><span>When enabled, LEDGRS scans mark prices every 10 seconds while the futures terminal is open and closes once SL, TP, or liquidation is reached.</span></div>
            <div><b>Model limitations</b><span>No maintenance margin tiers, slippage, or exchange liquidation engine yet.</span></div>
          </div>
          <div className="paper-warning">EDUCATIONAL PAPER TRADING — NO ORDERS OR FUNDS LEAVE LEDGRS</div>
        </div>
      </div>

      <FuturesChart
        asset={order.asset}
        markPrice={selectedPrice}
        positions={openPositions.filter((position) => position.asset === order.asset)}
      />

      <FuturesAnalyticsPanel positions={account.positions} />

      <div className="panel futures-positions">
        <div className="panel-header">
          <span className="panel-title">OPEN POSITIONS</span>
          <span className="position-count">{openPositions.length} ACTIVE</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>CONTRACT</th><th>SIDE</th><th>SIZE</th><th>ENTRY</th><th>MARK</th><th>SL / TP</th><th>LIQ. PRICE</th><th>MARGIN</th><th>NET PNL / ROE</th><th>LOG EXIT</th></tr></thead>
            <tbody>
              {openPositions.map((position) => (
                <tr key={position.id} className={position.liquidated ? "liquidation-row" : ""}>
                  <td><b>{position.asset}/USD</b><small>{position.leverage}x ISOLATED</small>{position.autoCloseEnabled && <span className="trigger-badge take">AUTO SL/TP</span>}{position.stopHit && <span className="trigger-badge stop">SL HIT</span>}{position.takeHit && <span className="trigger-badge take">TP HIT</span>}</td>
                  <td><span className={`futures-side ${position.side.toLowerCase()}`}>{position.side}</span></td>
                  <td>{fmtUsd(position.notional)}<small>{fmtQty(position.quantity)} {position.asset}</small></td>
                  <td>{fmtUsd(Number(position.entryPrice))}</td>
                  <td>{fmtUsd(position.markPrice)}</td>
                  <td className="risk-levels"><span>SL {position.stopLoss ? fmtUsd(Number(position.stopLoss)) : "—"}</span><span>TP {position.takeProfit ? fmtUsd(Number(position.takeProfit)) : "—"}</span></td>
                  <td className="liq-price">{fmtUsd(position.liquidationPrice)}<small>{position.liquidationDistancePercent.toFixed(2)}% AWAY · MM {fmtUsd(position.maintenanceMargin)}</small>{position.liquidated && <small>LIQUIDATED</small>}</td>
                  <td>{fmtUsd(Number(position.margin))}{position.plannedRisk && <small>RISK {fmtUsd(Number(position.plannedRisk))}{position.riskPercent ? ` · ${position.riskPercent}%` : ""}</small>}</td>
                  <td className={position.pnl >= 0 ? "profit-positive" : "profit-negative"}>{fmtSignedUsd(position.pnl)}<small>{fmtSignedPct(position.roe)} · GROSS {fmtSignedUsd(position.liveGrossPnl)}</small><small>FUNDING {fmtSignedUsd(position.accruedFundingPnl)} · FEES {fmtUsd(Number(position.entryFee ?? 0) + position.estimatedExitFee)}</small></td>
                  <td>
                    <div className="exit-price-control">
                      <input aria-label={`Exit price for ${position.asset}`} type="number" min="0" step="any" value={exitPrices[position.id] ?? ""} onChange={(event) => setExitPrices((current) => ({ ...current, [position.id]: event.target.value }))} placeholder={position.markPrice > 0 ? String(position.markPrice) : "Exit price"} />
                      <select aria-label={`Close percentage for ${position.asset}`} value={closePercents[position.id] ?? 100} onChange={(event) => setClosePercents((current) => ({ ...current, [position.id]: Number(event.target.value) }))}><option value={25}>25%</option><option value={50}>50%</option><option value={75}>75%</option><option value={100}>100%</option></select>
                      <button className="btn-ghost btn-sm" disabled={closingId === position.id} onClick={() => closePosition(position.id)}>{closingId === position.id ? "CLOSING" : `CLOSE ${closePercents[position.id] ?? 100}%`}</button>
                      <button className="btn-ghost btn-sm" onClick={() => toggleAdjustment(position)}>{adjustingId === position.id ? "CANCEL" : "ADJUST"}</button>
                      <button className="btn-ghost btn-sm" onClick={() => toggleAutomation(position)}>{position.autoCloseEnabled ? "AUTO ON" : "AUTO OFF"}</button>
                    </div>
                    {adjustingId === position.id && (
                      <div className="position-adjustment">
                        <label>SL<input type="number" min="0" step="any" value={adjustments[position.id]?.stopLoss ?? ""} onChange={(event) => setAdjustments((current) => ({ ...current, [position.id]: { ...current[position.id], stopLoss: event.target.value } }))} /></label>
                        <label>TP<input type="number" min="0" step="any" value={adjustments[position.id]?.takeProfit ?? ""} onChange={(event) => setAdjustments((current) => ({ ...current, [position.id]: { ...current[position.id], takeProfit: event.target.value } }))} /></label>
                        <label>MARGIN +/-<input type="number" step="any" value={adjustments[position.id]?.marginDelta ?? "0"} onChange={(event) => setAdjustments((current) => ({ ...current, [position.id]: { ...current[position.id], marginDelta: event.target.value } }))} /></label>
                        <button className="btn-action btn-sm" disabled={submitting} onClick={() => saveAdjustment(position.id)}>SAVE</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {openPositions.length === 0 && <tr><td colSpan={10} className="empty-positions">No open paper futures positions.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel futures-history">
        <div className="panel-header">
          <span className="panel-title">TRADE HISTORY</span>
          <div className="history-actions">
            <span className="position-count">{closedPositions.length} CLOSED</span>
            <button className="btn-ghost btn-sm" onClick={exportFutures}>EXPORT FUTURES CSV</button>
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>CONTRACT</th><th>SIDE</th><th>LEVERAGE</th><th>ENTRY</th><th>SL / TP</th><th>EXIT</th><th>NET REALIZED P&L</th><th>CLOSED</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {closedPositions.map((position) => {
                const pnl = Number(position.realizedPnl ?? 0);
                return <tr key={position.id}><td><b>{position.asset}/USD</b><small>{position.closeReason?.replaceAll("_", " ") ?? "MANUAL"}</small></td><td><span className={`futures-side ${position.side.toLowerCase()}`}>{position.side}</span></td><td>{position.leverage}x</td><td>{fmtUsd(Number(position.entryPrice))}</td><td className="risk-levels"><span>SL {position.stopLoss ? fmtUsd(Number(position.stopLoss)) : "—"}</span><span>TP {position.takeProfit ? fmtUsd(Number(position.takeProfit)) : "—"}</span></td><td>{position.exitPrice ? fmtUsd(Number(position.exitPrice)) : "—"}<small>{position.executions.length} FILL{position.executions.length === 1 ? "" : "S"}</small></td><td className={pnl >= 0 ? "profit-positive" : "profit-negative"}>{fmtSignedUsd(pnl)}<small>GROSS {fmtSignedUsd(Number(position.grossPnl ?? position.realizedPnl ?? 0))}</small><small>FUNDING {fmtSignedUsd(Number(position.fundingPnl ?? 0))} · FEES {fmtUsd(Number(position.entryFee ?? 0) + Number(position.exitFee ?? 0))}</small></td><td>{position.closedAt ? new Date(position.closedAt).toLocaleString() : "—"}</td><td><div className="closed-trade-actions"><button className="btn-ghost btn-sm" onClick={() => editClosedTrade(position)}>EDIT</button><button className="btn-ghost btn-sm danger-action" onClick={() => deleteClosedTrade(position)}>DELETE</button></div></td></tr>;
              })}
              {closedPositions.length === 0 && <tr><td colSpan={9} className="empty-positions">Closed positions will appear here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {closedEditId !== null && closedDraft && (
        <div className="panel closed-trade-editor">
          <div className="panel-header"><span className="panel-title">EDIT CLOSED TRADE #{closedEditId}</span><button className="btn-ghost btn-sm" onClick={() => { setClosedEditId(null); setClosedDraft(null); }}>CANCEL</button></div>
          <div className="closed-editor-grid">
            <div className="field"><label>SIDE</label><select value={closedDraft.side} onChange={(event) => setClosedDraft((current) => current ? { ...current, side: event.target.value as FuturesSide } : current)}><option>LONG</option><option>SHORT</option></select></div>
            <div className="field"><label>LEVERAGE</label><input type="number" min="1" max="20" value={closedDraft.leverage} onChange={(event) => setClosedDraft((current) => current ? { ...current, leverage: Number(event.target.value) } : current)} /></div>
            <div className="field"><label>MARGIN USD</label><input type="number" min="0" step="any" value={closedDraft.margin} onChange={(event) => setClosedDraft((current) => current ? { ...current, margin: event.target.value } : current)} /></div>
            <div className="field"><label>ENTRY PRICE</label><input type="number" min="0" step="any" value={closedDraft.entryPrice} onChange={(event) => setClosedDraft((current) => current ? { ...current, entryPrice: event.target.value } : current)} /></div>
            <div className="field"><label>EXIT PRICE</label><input type="number" min="0" step="any" value={closedDraft.exitPrice} onChange={(event) => setClosedDraft((current) => current ? { ...current, exitPrice: event.target.value } : current)} /></div>
            <div className="field"><label>STOP-LOSS</label><input type="number" min="0" step="any" value={closedDraft.stopLoss} onChange={(event) => setClosedDraft((current) => current ? { ...current, stopLoss: event.target.value } : current)} /></div>
            <div className="field"><label>TAKE-PROFIT</label><input type="number" min="0" step="any" value={closedDraft.takeProfit} onChange={(event) => setClosedDraft((current) => current ? { ...current, takeProfit: event.target.value } : current)} /></div>
            <div className="field"><label>FEE / SIDE BPS</label><input type="number" min="0" step="any" value={closedDraft.feeRateBps} onChange={(event) => setClosedDraft((current) => current ? { ...current, feeRateBps: event.target.value } : current)} /></div>
            <div className="field"><label>FUNDING / INTERVAL %</label><input type="number" step="any" value={closedDraft.fundingRate} onChange={(event) => setClosedDraft((current) => current ? { ...current, fundingRate: event.target.value } : current)} /></div>
            <div className="field"><label>OPENED</label><input type="datetime-local" value={closedDraft.openedAt} onChange={(event) => setClosedDraft((current) => current ? { ...current, openedAt: event.target.value } : current)} /></div>
            <div className="field"><label>CLOSED</label><input type="datetime-local" value={closedDraft.closedAt} onChange={(event) => setClosedDraft((current) => current ? { ...current, closedAt: event.target.value } : current)} /></div>
          </div>
          <div className="closed-editor-footer"><span>Saving recalculates quantity, fees, funding, all fills, realized P&L, analytics, and the paper balance.</span><button className="btn-action" disabled={submitting} onClick={saveClosedTrade}>{submitting ? "RECALCULATING…" : "SAVE & RECALCULATE"}</button></div>
        </div>
      )}

      <div className="panel futures-journal">
        <div className="panel-header">
          <div><span className="panel-title">TRADE JOURNAL</span><small>PLAN, REVIEW, TAGS & SCREENSHOT</small></div>
          {account.positions.length > 0 && <select aria-label="Journal trade" value={journalId ?? ""} onChange={(event) => selectJournalPosition(Number(event.target.value))}>{account.positions.map((position) => <option key={position.id} value={position.id}>#{position.id} · {position.asset} {position.side} · {position.status}</option>)}</select>}
        </div>
        {journalId === null ? <div className="chart-empty">OPEN A TRADE TO START YOUR JOURNAL</div> : (
          <div className="journal-workspace">
            <div className="journal-fields">
              <div className="field"><label htmlFor="journalSetup">SETUP / PLAYBOOK</label><input id="journalSetup" maxLength={120} value={journalDraft.setup} onChange={(event) => setJournalDraft((current) => ({ ...current, setup: event.target.value }))} placeholder="Breakout retest, range reversal…" /></div>
              <div className="field"><label htmlFor="journalTags">TAGS</label><input id="journalTags" maxLength={240} value={journalDraft.tags} onChange={(event) => setJournalDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="A-setup, trend, disciplined" /></div>
              <div className="field"><label htmlFor="journalNotes">TRADE NOTES</label><textarea id="journalNotes" maxLength={10000} value={journalDraft.notes} onChange={(event) => setJournalDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Thesis, execution review, emotions, lessons…" /></div>
              <div className="journal-actions"><label className="btn-ghost btn-sm journal-file">ATTACH SCREENSHOT<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => attachJournalScreenshot(event.target.files?.[0])} /></label>{journalDraft.screenshot && <button className="btn-ghost btn-sm" type="button" onClick={() => setJournalDraft((current) => ({ ...current, screenshot: "" }))}>REMOVE IMAGE</button>}<button className="btn-action btn-sm" type="button" disabled={submitting} onClick={saveJournal}>{submitting ? "SAVING" : "SAVE JOURNAL"}</button></div>
            </div>
            <div className="journal-screenshot">{journalDraft.screenshot ? <img src={journalDraft.screenshot} alt="Attached trade chart" /> : <span>NO SCREENSHOT ATTACHED</span>}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function FuturesStat({ label, value, tone }: { label: string; value: string; tone?: "bright" | "amber" | "green" | "red" }) {
  return <div className={`futures-stat ${tone ? `tone-${tone}` : ""}`}><span>{label}</span><b>{value}</b></div>;
}

function PreviewRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div><span>{label}</span><b className={danger ? "danger" : ""}>{value}</b></div>;
}
