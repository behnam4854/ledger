"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import AppNav from "../AppNav";
import * as api from "@/lib/api";
import { futuresMetrics } from "@/lib/futures";
import { fmtQty, fmtSignedPct, fmtSignedUsd, fmtUsd } from "@/lib/format";
import type {
  CoinDefinition,
  FuturesAccountResponse,
  FuturesPosition,
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
}

export default function FuturesApp() {
  const { data: session } = useSession();
  const [account, setAccount] = useState<FuturesAccountResponse>({ balance: 0, positions: [] });
  const [coins, setCoins] = useState<CoinDefinition[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
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
  }>({
    asset: "BTC",
    side: "LONG",
    margin: "250",
    leverage: 3,
    entryPrice: "",
    stopLoss: "",
    takeProfit: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [exitPrices, setExitPrices] = useState<Record<number, string>>({});
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
      setMarketStatus(data.status === "live" ? "live" : "offline");
    } catch {
      setMarketStatus("offline");
    }
  }, []);

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

  const openPositions = useMemo<LivePosition[]>(() => account.positions
    .filter((position) => position.status === "OPEN")
    .map((position) => {
      const markPrice = prices[position.asset] ?? Number(position.entryPrice);
      const metrics = futuresMetrics({
        side: position.side,
        entryPrice: position.entryPrice,
        markPrice,
        margin: position.margin,
        leverage: position.leverage,
        quantity: position.quantity,
      });
      const stopLoss = position.stopLoss ? Number(position.stopLoss) : null;
      const takeProfit = position.takeProfit ? Number(position.takeProfit) : null;
      const stopHit = stopLoss !== null && (position.side === "LONG" ? markPrice <= stopLoss : markPrice >= stopLoss);
      const takeHit = takeProfit !== null && (position.side === "LONG" ? markPrice >= takeProfit : markPrice <= takeProfit);
      return {
        ...position,
        markPrice,
        pnl: Number(metrics.pnl),
        equity: Number(metrics.equity),
        roe: metrics.roe,
        liquidationPrice: Number(metrics.liquidationPrice),
        liquidated: metrics.liquidated,
        notional: Number(metrics.notional),
        stopHit,
        takeHit,
      };
    }), [account.positions, prices]);

  const closedPositions = account.positions.filter((position) => position.status === "CLOSED");
  const usedMargin = openPositions.reduce((sum, position) => sum + Number(position.margin), 0);
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + position.pnl, 0);
  const positionEquity = openPositions.reduce((sum, position) => sum + position.equity, 0);
  const accountEquity = account.balance + positionEquity;
  const marginUsage = accountEquity > 0 ? (usedMargin / accountEquity) * 100 : 0;

  const selectedPrice = prices[order.asset] ?? 0;
  const loggedEntryPrice = Number(order.entryPrice);
  const effectiveEntryPrice = loggedEntryPrice > 0 ? loggedEntryPrice : selectedPrice;
  const orderMargin = Number(order.margin);
  const preview = effectiveEntryPrice > 0 && orderMargin > 0
    ? futuresMetrics({
        side: order.side,
        entryPrice: effectiveEntryPrice,
        markPrice: selectedPrice > 0 ? selectedPrice : effectiveEntryPrice,
        margin: orderMargin,
        leverage: order.leverage,
      })
    : null;

  const submitOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.openFuturesPosition(order);
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
      await api.closeFuturesPosition(id, exitPrices[id] ?? "");
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
          <p>Practice isolated-margin long and short positions against live CoinGecko marks.</p>
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

            <div className="field">
              <label htmlFor="futuresMargin">ISOLATED MARGIN (USD)</label>
              <input id="futuresMargin" type="number" min="1" step="any" value={order.margin} onChange={(event) => setOrder((current) => ({ ...current, margin: event.target.value }))} />
            </div>

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

            <div className="field">
              <label htmlFor="futuresLeverage">LEVERAGE <b>{order.leverage}x</b></label>
              <input id="futuresLeverage" className="leverage-slider" type="range" min="1" max="20" value={order.leverage} onChange={(event) => setOrder((current) => ({ ...current, leverage: Number(event.target.value) }))} />
              <div className="leverage-marks"><span>1x</span><span>5x</span><span>10x</span><span>15x</span><span>20x</span></div>
            </div>

            <div className="order-preview">
              <PreviewRow label="MARK PRICE" value={selectedPrice > 0 ? fmtUsd(selectedPrice) : "—"} />
              <PreviewRow label="LOGGED ENTRY" value={effectiveEntryPrice > 0 ? fmtUsd(effectiveEntryPrice) : "—"} />
              <PreviewRow label="POSITION SIZE" value={preview ? fmtUsd(Number(preview.notional)) : "—"} />
              <PreviewRow label="QUANTITY" value={preview ? `${fmtQty(preview.quantity)} ${order.asset}` : "—"} />
              <PreviewRow label="EST. LIQUIDATION" value={preview ? fmtUsd(Number(preview.liquidationPrice)) : "—"} danger />
              <PreviewRow label="RISK PLAN" value={order.stopLoss || order.takeProfit ? `SL ${order.stopLoss || "—"} · TP ${order.takeProfit || "—"}` : "NOT SET"} />
            </div>

            <button className={`btn-action futures-submit ${order.side.toLowerCase()}`} type="submit" disabled={submitting || !(effectiveEntryPrice > 0)}>
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
            <div><b>{order.leverage}x exposure</b><span>A 1% market move changes position equity by roughly {order.leverage}%.</span></div>
            <div><b>Isolated margin</b><span>Loss on this simulation is capped at the margin assigned to the position.</span></div>
            <div><b>Model limitations</b><span>No maintenance margin tiers, fees, funding, slippage, or exchange liquidation engine.</span></div>
          </div>
          <div className="paper-warning">EDUCATIONAL PAPER TRADING — NO ORDERS OR FUNDS LEAVE LEDGRS</div>
        </div>
      </div>

      <div className="panel futures-positions">
        <div className="panel-header">
          <span className="panel-title">OPEN POSITIONS</span>
          <span className="position-count">{openPositions.length} ACTIVE</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>CONTRACT</th><th>SIDE</th><th>SIZE</th><th>ENTRY</th><th>MARK</th><th>SL / TP</th><th>LIQ. PRICE</th><th>MARGIN</th><th>PNL / ROE</th><th>LOG EXIT</th></tr></thead>
            <tbody>
              {openPositions.map((position) => (
                <tr key={position.id} className={position.liquidated ? "liquidation-row" : ""}>
                  <td><b>{position.asset}/USD</b><small>{position.leverage}x ISOLATED</small>{position.stopHit && <span className="trigger-badge stop">SL HIT</span>}{position.takeHit && <span className="trigger-badge take">TP HIT</span>}</td>
                  <td><span className={`futures-side ${position.side.toLowerCase()}`}>{position.side}</span></td>
                  <td>{fmtUsd(position.notional)}<small>{fmtQty(position.quantity)} {position.asset}</small></td>
                  <td>{fmtUsd(Number(position.entryPrice))}</td>
                  <td>{fmtUsd(position.markPrice)}</td>
                  <td className="risk-levels"><span>SL {position.stopLoss ? fmtUsd(Number(position.stopLoss)) : "—"}</span><span>TP {position.takeProfit ? fmtUsd(Number(position.takeProfit)) : "—"}</span></td>
                  <td className="liq-price">{fmtUsd(position.liquidationPrice)}{position.liquidated && <small>LIQUIDATED</small>}</td>
                  <td>{fmtUsd(Number(position.margin))}</td>
                  <td className={position.pnl >= 0 ? "profit-positive" : "profit-negative"}>{fmtSignedUsd(position.pnl)}<small>{fmtSignedPct(position.roe)}</small></td>
                  <td><div className="exit-price-control"><input aria-label={`Exit price for ${position.asset}`} type="number" min="0" step="any" value={exitPrices[position.id] ?? ""} onChange={(event) => setExitPrices((current) => ({ ...current, [position.id]: event.target.value }))} placeholder={position.markPrice > 0 ? String(position.markPrice) : "Exit price"} /><button className="btn-ghost btn-sm" disabled={closingId === position.id} onClick={() => closePosition(position.id)}>{closingId === position.id ? "CLOSING" : "CLOSE"}</button></div></td>
                </tr>
              ))}
              {openPositions.length === 0 && <tr><td colSpan={10} className="empty-positions">No open paper futures positions.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel futures-history">
        <div className="panel-header"><span className="panel-title">TRADE HISTORY</span><span className="position-count">{closedPositions.length} CLOSED</span></div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>CONTRACT</th><th>SIDE</th><th>LEVERAGE</th><th>ENTRY</th><th>SL / TP</th><th>EXIT</th><th>REALIZED P&L</th><th>CLOSED</th></tr></thead>
            <tbody>
              {closedPositions.map((position) => {
                const pnl = Number(position.realizedPnl ?? 0);
                return <tr key={position.id}><td><b>{position.asset}/USD</b></td><td><span className={`futures-side ${position.side.toLowerCase()}`}>{position.side}</span></td><td>{position.leverage}x</td><td>{fmtUsd(Number(position.entryPrice))}</td><td className="risk-levels"><span>SL {position.stopLoss ? fmtUsd(Number(position.stopLoss)) : "—"}</span><span>TP {position.takeProfit ? fmtUsd(Number(position.takeProfit)) : "—"}</span></td><td>{position.exitPrice ? fmtUsd(Number(position.exitPrice)) : "—"}</td><td className={pnl >= 0 ? "profit-positive" : "profit-negative"}>{fmtSignedUsd(pnl)}</td><td>{position.closedAt ? new Date(position.closedAt).toLocaleString() : "—"}</td></tr>;
              })}
              {closedPositions.length === 0 && <tr><td colSpan={8} className="empty-positions">Closed positions will appear here.</td></tr>}
            </tbody>
          </table>
        </div>
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
