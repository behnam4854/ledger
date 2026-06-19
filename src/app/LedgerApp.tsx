"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import { parseCsv, toCsv } from "@/lib/csv";
import { portfolioStats, unrealizedForBuy, unrealizedPnl } from "@/lib/calculations";
import { fmtQty, fmtSignedUsd, fmtUsd, today } from "@/lib/format";
import {
  ASSETS,
  type Asset,
  type BuyWithRemaining,
  type PriceMap,
  type Portfolio,
  type Sell,
} from "@/lib/types";

const EMPTY_PRICES: PriceMap = { BTC: 0, ETH: 0, XAUT: 0 };
const POSITIVE = "#1f8a4c";
const NEGATIVE = "#c2412c";

type SortColumn = "date" | "type" | "wallet" | "asset" | "amount" | "price" | "total";

interface LedgerRow {
  kind: "buy" | "sell";
  id: number;
  date: string;
  type: string;
  wallet: string;
  asset: string;
  amount: number;
  price: number;
  total: number;
  profit: number | null;
  remaining: number | null;
  currentPrice: number | null;
  unrealized: number | null;
}

export default function LedgerApp() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<PriceMap>(EMPTY_PRICES);
  const [priceStatus, setPriceStatus] = useState<"live" | "offline" | "fetching">("fetching");
  const [priceTime, setPriceTime] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [clock, setClock] = useState("--:--:--");

  // Form state
  const [buyForm, setBuyForm] = useState({ wallet: "Main", asset: "BTC", amount: "0.05", price: "45000", date: "" });
  const [sellForm, setSellForm] = useState({ buyId: "", amount: "", price: "", date: "" });
  const [buyCollapsed, setBuyCollapsed] = useState(true);
  const [sellCollapsed, setSellCollapsed] = useState(true);

  // Table state
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sort, setSort] = useState<{ column: SortColumn; direction: "asc" | "desc" }>({
    column: "date",
    direction: "asc",
  });

  const [usdInput, setUsdInput] = useState("1000");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  const buys = portfolio?.buys ?? [];
  const sells = portfolio?.sells ?? [];
  const usd = portfolio?.usd ?? 0;

  const reload = useCallback(async () => {
    try {
      setPortfolio(await api.fetchPortfolio());
    } catch (e) {
      console.error(e);
    }
  }, []);

  const refreshPrices = useCallback(async () => {
    setPriceStatus("fetching");
    try {
      const data = await api.fetchPrices();
      setPrices(data.prices);
      if (data.status === "live" && data.updatedAt) {
        setPriceStatus("live");
        setPriceTime(new Date(data.updatedAt).toLocaleTimeString("en-US", { hour12: false }));
      } else {
        setPriceStatus("offline");
      }
    } catch {
      setPriceStatus("offline");
    }
  }, []);

  // Initial load + default dates
  useEffect(() => {
    setBuyForm((f) => ({ ...f, date: today() }));
    setSellForm((f) => ({ ...f, date: today() }));
    reload();
    refreshPrices();
  }, [reload, refreshPrices]);

  // Price polling
  useEffect(() => {
    const id = setInterval(() => {
      if (autoRefreshRef.current) refreshPrices();
    }, 10_000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  // Clock
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const priceFor = useCallback((asset: string): number => prices[asset as Asset] ?? 0, [prices]);

  const stats = useMemo(() => portfolioStats(buys, sells), [buys, sells]);
  const unrealized = useMemo(() => unrealizedPnl(buys, prices), [buys, prices]);

  const selectedBuy = useMemo<BuyWithRemaining | null>(() => {
    const id = parseInt(sellForm.buyId);
    return buys.find((b) => b.id === id) ?? null;
  }, [buys, sellForm.buyId]);

  // Build + sort ledger rows
  const sortedRows = useMemo<LedgerRow[]>(() => {
    const rows: LedgerRow[] = [];

    for (const b of buys) {
      const remaining = Number(b.remaining);
      const currentPrice = priceFor(b.asset);
      const unr = remaining > 0.000001 ? unrealizedForBuy(b, currentPrice) : null;
      rows.push({
        kind: "buy",
        id: b.id,
        date: b.date,
        type: "buy",
        wallet: b.wallet,
        asset: b.asset,
        amount: Number(b.amount),
        price: Number(b.price),
        total: Number(b.amount) * Number(b.price),
        profit: null,
        remaining,
        currentPrice: remaining > 0.000001 && currentPrice > 0 ? currentPrice : null,
        unrealized: unr,
      });
    }

    for (const s of sells) {
      const buy = buys.find((b) => b.id === s.buyId);
      rows.push({
        kind: "sell",
        id: s.id,
        date: s.sellDate,
        type: "sell",
        wallet: buy?.wallet ?? "?",
        asset: buy?.asset ?? "?",
        amount: Number(s.amount),
        price: Number(s.sellPrice),
        total: Number(s.amount) * Number(s.sellPrice),
        profit: Number(s.profit),
        remaining: null,
        currentPrice: null,
        unrealized: null,
      });
    }

    const { column, direction } = sort;
    rows.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (column === "date") {
        av = new Date(a.date).getTime();
        bv = new Date(b.date).getTime();
      } else if (["amount", "price", "total"].includes(column)) {
        av = a[column as "amount" | "price" | "total"];
        bv = b[column as "amount" | "price" | "total"];
      } else {
        av = String(a[column as "type" | "wallet" | "asset"]).toLowerCase();
        bv = String(b[column as "type" | "wallet" | "asset"]).toLowerCase();
      }
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });

    return rows;
  }, [buys, sells, sort, priceFor]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((safePage - 1) * rowsPerPage, (safePage - 1) * rowsPerPage + rowsPerPage);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // ---- Handlers ----
  const onAddBuy = async () => {
    const amount = parseFloat(buyForm.amount);
    const price = parseFloat(buyForm.price);
    if (!buyForm.wallet.trim() || !buyForm.asset || isNaN(amount) || isNaN(price) || amount <= 0 || price <= 0) {
      alert("Please fill all fields (amount & price > 0)");
      return;
    }
    try {
      await api.createBuy({
        wallet: buyForm.wallet.trim(),
        asset: buyForm.asset,
        amount: buyForm.amount,
        price: buyForm.price,
        date: buyForm.date || today(),
      });
      setBuyForm((f) => ({ ...f, amount: "", price: "" }));
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add buy");
    }
  };

  const onAddSell = async () => {
    if (!sellForm.buyId) {
      alert("Please select a position to sell from the dropdown");
      return;
    }
    const amount = parseFloat(sellForm.amount);
    const price = parseFloat(sellForm.price);
    if (isNaN(amount) || isNaN(price) || amount <= 0 || price <= 0) {
      alert("Valid amount and sell price required");
      return;
    }
    if (selectedBuy && amount > Number(selectedBuy.remaining)) {
      alert(`Max sellable: ${fmtQty(selectedBuy.remaining)}`);
      return;
    }
    try {
      await api.createSell({
        buyId: parseInt(sellForm.buyId),
        amount: sellForm.amount,
        sellPrice: sellForm.price,
        sellDate: sellForm.date || today(),
      });
      setSellForm({ buyId: "", amount: "", price: "", date: today() });
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to record sell");
    }
  };

  const onDeleteBuy = async (id: number) => {
    if (!confirm("Delete this BUY? (only possible if no linked sells)")) return;
    try {
      await api.deleteBuy(id);
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete buy");
    }
  };

  const onDeleteSell = async (id: number) => {
    if (!confirm("Delete this SELL? (amount will be returned to buy)")) return;
    try {
      await api.deleteSell(id);
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete sell");
    }
  };

  const onUsd = async (action: "add" | "withdraw") => {
    const amount = parseFloat(usdInput);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }
    try {
      const newBalance = await api.updateUsd(action, amount);
      setPortfolio((p) => (p ? { ...p, usd: newBalance } : p));
      setUsdInput("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update USD");
    }
  };

  const onExport = () => {
    const csv = toCsv(buys, sells);
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ledgrs_export_${today()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const payload = parseCsv(text);
      const result = await api.importData(payload);
      await reload();
      const skipped = result.skippedSells > 0 ? ` (${result.skippedSells} sells skipped — no matching buy)` : "";
      alert(`Imported ${result.importedBuys} buys and ${result.importedSells} sells${skipped}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    }
  };

  const toggleSort = (column: SortColumn) => {
    setSort((s) =>
      s.column === column
        ? { column, direction: s.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
    setPage(1);
  };

  const sortClass = (column: SortColumn) =>
    "sortable" + (sort.column === column ? ` ${sort.direction}` : "");

  const openBuys = buys.filter((b) => Number(b.remaining) > 0.000001);
  const tickerItems = [
    { label: "BTC", value: prices.BTC },
    { label: "ETH", value: prices.ETH },
    { label: "XAUT", value: prices.XAUT },
  ];

  return (
    <div className="container">
      {/* HEADER */}
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
            <div className="brand-sub">CRYPTO PORTFOLIO TERMINAL</div>
          </div>
        </div>

        <div className="header-right">
          <div className="sys-clock">{clock}</div>
          <div className="action-group">
            <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
              IMPORT
            </button>
            <button className="btn-ghost" onClick={onExport}>
              EXPORT
            </button>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={onImportFile} />
      </header>

      {/* TICKER */}
      <div className="ticker-wrap">
        <div className="ticker">
          {[...tickerItems, ...tickerItems].map((t, i) => (
            <span key={i} className="tick-item">
              {t.label}{" "}
              <span className="tick-val">{t.value > 0 ? `$${t.value.toLocaleString()}` : "$—"}</span>
            </span>
          ))}
        </div>
      </div>

      {/* STATS GRID */}
      <div className="stats-grid">
        <div className="stat-card stat-usd">
          <div className="stat-label">USD CASH</div>
          <div className="stat-value">{fmtUsd(usd)}</div>
          <div className="usd-controls">
            <input
              type="number"
              step="any"
              min="0"
              placeholder="0.00"
              value={usdInput}
              onChange={(e) => setUsdInput(e.target.value)}
            />
            <button className="btn-usd-add" onClick={() => onUsd("add")}>
              + ADD
            </button>
            <button className="btn-usd-withdraw" onClick={() => onUsd("withdraw")}>
              − WDR
            </button>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TOTAL COST BASIS</div>
          <div className="stat-value">
            {fmtUsd(stats.totalCost)}
            <span className="stat-sub">total bought</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TOTAL PROCEEDS</div>
          <div className="stat-value">
            {fmtUsd(stats.totalProceeds)}
            <span className="stat-sub">from sells</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">REALIZED P&amp;L</div>
          <div className="stat-value" style={{ color: stats.realizedPnl >= 0 ? POSITIVE : NEGATIVE }}>
            {fmtSignedUsd(stats.realizedPnl)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">OPEN POSITIONS</div>
          <div className="stat-value">{stats.openPositions}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">UNREALIZED P&amp;L</div>
          <div className="stat-value" style={{ color: unrealized >= 0 ? POSITIVE : NEGATIVE }}>
            {fmtSignedUsd(unrealized)}
          </div>
        </div>
      </div>

      {/* MARKET DATA */}
      <div className="panel panel-prices">
        <div className="panel-header">
          <span className="panel-title">MARKET DATA</span>
          <div className="price-controls">
            <span className={`status-pill ${priceStatus === "live" ? "status-live" : "status-offline"}`}>
              {priceStatus === "live"
                ? `● LIVE · ${priceTime}`
                : priceStatus === "fetching"
                  ? "● FETCHING"
                  : "● OFFLINE · CLICK REFRESH"}
            </span>
            <button className="btn-ghost btn-sm" onClick={refreshPrices}>
              ⟳ REFRESH
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setAutoRefresh((v) => !v)}>
              {autoRefresh ? "⏸ PAUSE" : "▶ RESUME"}
            </button>
          </div>
        </div>
        <div className="price-row">
          {(["BTC", "ETH", "XAUT"] as Asset[]).map((asset) => (
            <div className="price-tile" key={asset}>
              <div className="price-asset">{asset}</div>
              <div className="price-val">
                <input type="text" value={prices[asset] > 0 ? prices[asset].toString() : "—"} readOnly />
              </div>
              <div className="price-label">
                {asset === "BTC" ? "BITCOIN" : asset === "ETH" ? "ETHEREUM" : "TETHER GOLD"}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FORMS */}
      <div className="forms-row">
        {/* BUY */}
        <div className="panel panel-buy">
          <div
            className={`panel-header collapsible${buyCollapsed ? " collapsed" : ""}`}
            onClick={() => setBuyCollapsed((v) => !v)}
          >
            <span className="panel-title">
              <span className="pill pill-buy">BUY</span> RECORD PURCHASE
            </span>
            <span className="collapse-icon">▾</span>
          </div>
          <div className={`collapsible-content${buyCollapsed ? " collapsed" : ""}`}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="buyWallet">WALLET</label>
                <input
                  id="buyWallet"
                  type="text"
                  value={buyForm.wallet}
                  onChange={(e) => setBuyForm((f) => ({ ...f, wallet: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="buyAsset">ASSET</label>
                <select
                  id="buyAsset"
                  value={buyForm.asset}
                  onChange={(e) => setBuyForm((f) => ({ ...f, asset: e.target.value }))}
                >
                  {ASSETS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field field-wide">
                <label htmlFor="buyAmount">AMOUNT</label>
                <div className="input-with-slider">
                  <input
                    id="buyAmount"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.000000"
                    value={buyForm.amount}
                    onChange={(e) => setBuyForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                  <div className="quick-buttons">
                    {["0.01", "0.05", "0.1", "0.5", "1"].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className="qbtn"
                        onClick={() => setBuyForm((f) => ({ ...f, amount: amt }))}
                      >
                        {amt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="field">
                <label htmlFor="buyPrice">BUY PRICE (USD)</label>
                <input
                  id="buyPrice"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={buyForm.price}
                  onChange={(e) => setBuyForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="buyDate">DATE</label>
                <input
                  id="buyDate"
                  type="date"
                  value={buyForm.date}
                  onChange={(e) => setBuyForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
            </div>
            <button className="btn-action btn-buy-action" onClick={onAddBuy}>
              + RECORD BUY
            </button>
          </div>
        </div>

        {/* SELL */}
        <div className="panel panel-sell">
          <div
            className={`panel-header collapsible${sellCollapsed ? " collapsed" : ""}`}
            onClick={() => setSellCollapsed((v) => !v)}
          >
            <span className="panel-title">
              <span className="pill pill-sell">SELL</span> RECORD SALE
            </span>
            <span className="collapse-icon">▾</span>
          </div>
          <div className={`collapsible-content${sellCollapsed ? " collapsed" : ""}`}>
            <div className="form-grid">
              <div className="field field-wide">
                <label htmlFor="sellBuyId">SELECT OPEN POSITION</label>
                <select
                  id="sellBuyId"
                  value={sellForm.buyId}
                  onChange={(e) => setSellForm((f) => ({ ...f, buyId: e.target.value, amount: "" }))}
                >
                  <option value="">-- Select a position to sell --</option>
                  {openBuys.length === 0 ? (
                    <option value="" disabled>
                      No open buys — add a buy first
                    </option>
                  ) : (
                    openBuys.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.wallet} | {b.asset} | {fmtQty(b.remaining)} left @ ${b.price} (bought {b.date})
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="field field-wide">
                <label htmlFor="sellAmount">SELL AMOUNT</label>
                <div className="input-with-slider">
                  <input
                    id="sellAmount"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.000000"
                    value={sellForm.amount}
                    onChange={(e) => setSellForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                  <div className="quick-buttons">
                    {[0.25, 0.5, 0.75, 1].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="qbtn"
                        onClick={() => {
                          if (!selectedBuy) {
                            alert("Please select a position first");
                            return;
                          }
                          setSellForm((f) => ({ ...f, amount: (Number(selectedBuy.remaining) * p).toFixed(6) }));
                        }}
                      >
                        {p * 100}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="field">
                <label htmlFor="sellPrice">SELL PRICE (USD)</label>
                <input
                  id="sellPrice"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={sellForm.price}
                  onChange={(e) => setSellForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="sellDate">DATE</label>
                <input
                  id="sellDate"
                  type="date"
                  value={sellForm.date}
                  onChange={(e) => setSellForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
            </div>
            <button className="btn-action btn-sell-action" onClick={onAddSell}>
              − RECORD SELL
            </button>
          </div>
        </div>
      </div>

      {/* POSITION DETAILS */}
      {selectedBuy && Number(selectedBuy.remaining) > 0 && (
        <PositionDetails buy={selectedBuy} currentPrice={priceFor(selectedBuy.asset)} />
      )}

      {/* LEDGER */}
      <div className="panel panel-ledger">
        <div className="panel-header">
          <span className="panel-title">FULL LEDGER</span>
          <div className="ledger-controls">
            <select
              className="rows-select"
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(parseInt(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} rows
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th className={sortClass("date")} onClick={() => toggleSort("date")}>
                  DATE
                </th>
                <th className={sortClass("type")} onClick={() => toggleSort("type")}>
                  TYPE
                </th>
                <th className={sortClass("wallet")} onClick={() => toggleSort("wallet")}>
                  WALLET
                </th>
                <th className={sortClass("asset")} onClick={() => toggleSort("asset")}>
                  ASSET
                </th>
                <th className={sortClass("amount")} onClick={() => toggleSort("amount")}>
                  AMOUNT
                </th>
                <th className={sortClass("price")} onClick={() => toggleSort("price")}>
                  PRICE (USD)
                </th>
                <th className={sortClass("total")} onClick={() => toggleSort("total")}>
                  TOTAL (USD)
                </th>
                <th>MKT PRICE</th>
                <th>UNRLZD P&amp;L</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className={row.kind === "buy" ? "row-buy" : "row-sell"}>
                  <td>{row.date}</td>
                  <td>
                    <span className={row.kind === "buy" ? "badge-buy" : "badge-sell"}>
                      {row.kind === "buy" ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td>{row.wallet}</td>
                  <td style={{ color: row.kind === "buy" ? "var(--accent)" : "var(--red)", fontWeight: 700 }}>
                    {row.asset}
                  </td>
                  <td>
                    {fmtQty(row.amount)}
                    {row.kind === "buy" && row.remaining !== null && (
                      <span style={{ color: "var(--text-dim)", fontSize: "0.65rem" }}> ({fmtQty(row.remaining)} open)</span>
                    )}
                  </td>
                  <td>{fmtUsd(row.price)}</td>
                  <td>{fmtUsd(row.total)}</td>
                  <td>
                    {row.currentPrice !== null ? (
                      fmtUsd(row.currentPrice)
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>—</span>
                    )}
                  </td>
                  <td className={row.unrealized !== null ? (row.unrealized >= 0 ? "profit-positive" : "profit-negative") : undefined}>
                    {row.kind === "sell" && row.profit !== null ? (
                      <span className={row.profit >= 0 ? "profit-positive" : "profit-negative"}>
                        {fmtSignedUsd(row.profit)}
                      </span>
                    ) : row.unrealized !== null ? (
                      fmtSignedUsd(row.unrealized)
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>—</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="delete-btn"
                      onClick={() => (row.kind === "buy" ? onDeleteBuy(row.id) : onDeleteSell(row.id))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--text-dim)" }}>
                    No transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <button className="btn-ghost btn-sm" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ◀ PREV
          </button>
          <span className="page-info">
            Page {safePage} of {totalPages}
          </span>
          <button
            className="btn-ghost btn-sm"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            NEXT ▶
          </button>
        </div>
      </div>

      <div className="footnote">
        DATA STORED IN A DATABASE · LIVE PRICES VIA COINGECKO (SERVER-CACHED) · AUTO-REFRESH 10s
      </div>
    </div>
  );
}

function PositionDetails({ buy, currentPrice }: { buy: BuyWithRemaining; currentPrice: number }) {
  const remaining = Number(buy.remaining);
  const currentValue = remaining * currentPrice;
  const costBasis = remaining * Number(buy.price);
  const unr = unrealizedForBuy(buy, currentPrice);

  return (
    <div className="panel panel-details">
      <div className="panel-header">
        <span className="panel-title">POSITION DETAILS</span>
      </div>
      <div className="details-grid">
        <Detail label="ASSET" value={buy.asset} />
        <Detail label="WALLET" value={buy.wallet} />
        <Detail label="BUY PRICE" value={fmtUsd(Number(buy.price))} />
        <Detail label="REMAINING" value={`${fmtQty(buy.remaining)} ${buy.asset}`} />
        <Detail label="COST BASIS" value={fmtUsd(costBasis)} />
        <Detail label="CURRENT VALUE" value={currentPrice > 0 ? fmtUsd(currentValue) : "—"} />
        <Detail
          label="UNREALIZED P&L"
          value={unr !== null ? fmtSignedUsd(unr) : "—"}
          color={unr !== null ? (unr >= 0 ? "#f97316" : "#dc2626") : undefined}
        />
        <Detail label="BUY DATE" value={buy.date} />
      </div>
    </div>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="detail-item">
      <div className="detail-label">{label}</div>
      <div className="detail-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
