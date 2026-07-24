"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import * as api from "@/lib/api";
import AppNav from "./AppNav";
import UnifiedDashboard from "./UnifiedDashboard";
import { parseCsv, toCsv } from "@/lib/csv";
import { portfolioStats, portfolioValuation, unrealizedForBuy, unrealizedPnl } from "@/lib/calculations";
import { fmtQty, fmtSignedPct, fmtSignedUsd, fmtUsd, today } from "@/lib/format";
import {
  CORE_COINS,
  type BuyWithRemaining,
  type CoinDefinition,
  type FuturesAccountResponse,
  type FuturesActivity,
  type PriceMap,
  type Portfolio,
  type Sell,
} from "@/lib/types";

const EMPTY_PRICES: PriceMap = Object.fromEntries(CORE_COINS.map((coin) => [coin.symbol, 0]));
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
  const { data: session } = useSession();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [futuresAccount, setFuturesAccount] = useState<FuturesAccountResponse>({ balance: 0, positions: [] });
  const [futuresActivity, setFuturesActivity] = useState<FuturesActivity[]>([]);
  const [prices, setPrices] = useState<PriceMap>(EMPTY_PRICES);
  const [coins, setCoins] = useState<CoinDefinition[]>(CORE_COINS);
  const [priceStatus, setPriceStatus] = useState<"live" | "offline" | "fetching">("fetching");
  const [priceTime, setPriceTime] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [clock, setClock] = useState("--:--:--");

  // Form state
  const [buyForm, setBuyForm] = useState({ wallet: "Main", asset: "BTC", amount: "0.05", price: "45000", date: "" });
  const [sellForm, setSellForm] = useState({ buyId: "", amount: "", price: "", date: "" });
  const [buyCollapsed, setBuyCollapsed] = useState(true);
  const [sellCollapsed, setSellCollapsed] = useState(true);
  const [coinQuery, setCoinQuery] = useState("");
  const [coinResults, setCoinResults] = useState<api.CoinSearchResult[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<api.CoinSearchResult | null>(null);
  const [searchingCoins, setSearchingCoins] = useState(false);
  const [addingCoin, setAddingCoin] = useState(false);
  const [coinError, setCoinError] = useState("");
  const [expandedLedgerAsset, setExpandedLedgerAsset] = useState<string | null>(null);

  // Table state
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sort, setSort] = useState<{ column: SortColumn; direction: "asc" | "desc" }>({
    column: "date",
    direction: "asc",
  });

  const [usdInput, setUsdInput] = useState("1000");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buys = portfolio?.buys ?? [];
  const sells = portfolio?.sells ?? [];
  const usd = portfolio?.usd ?? 0;

  const reload = useCallback(async () => {
    try {
      const [nextPortfolio, nextFutures, nextActivity] = await Promise.all([
        api.fetchPortfolio(), api.fetchFuturesAccount(), api.fetchFuturesActivity(50),
      ]);
      setPortfolio(nextPortfolio);
      setFuturesAccount(nextFutures);
      setFuturesActivity(nextActivity.activities);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const refreshPrices = useCallback(async () => {
    setPriceStatus("fetching");
    try {
      const data = await api.fetchPrices();
      setPrices(data.prices);
      setCoins(data.coins);
      if (data.status === "live" && data.updatedAt) {
        setPriceStatus("live");
        setPriceTime(new Date(data.updatedAt).toLocaleTimeString("en-US", { hour12: false }));
      } else {
        setPriceStatus("offline");
      }
    } catch (error) {
      console.error(error);
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
    const id = setInterval(refreshPrices, 10_000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  // Debounced CoinGecko search for the asset picker.
  useEffect(() => {
    const query = coinQuery.trim();
    if (selectedCoin || query.length < 2) {
      setCoinResults([]);
      setSearchingCoins(false);
      return;
    }

    let active = true;
    setCoinError("");
    setSearchingCoins(true);
    const id = setTimeout(async () => {
      try {
        const results = await api.searchCoins(query);
        if (active) setCoinResults(results);
      } catch (error) {
        if (active) {
          setCoinResults([]);
          setCoinError(error instanceof Error ? error.message : "Coin search failed");
        }
      } finally {
        if (active) setSearchingCoins(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [coinQuery, selectedCoin]);

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

  const priceFor = useCallback((asset: string): number => prices[asset] ?? 0, [prices]);

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

  const assetLedgers = useMemo(() => {
    const grouped = new Map<string, LedgerRow[]>();
    for (const row of sortedRows) {
      const rows = grouped.get(row.asset) ?? [];
      rows.push(row);
      grouped.set(row.asset, rows);
    }

    return [...grouped.entries()]
      .map(([asset, rows]) => {
        const holding = rows.reduce(
          (total, row) => total + (row.kind === "buy" ? (row.remaining ?? 0) : 0),
          0,
        );
        const marketPrice = priceFor(asset);
        const pnl = rows.reduce(
          (total, row) => total + (row.kind === "sell" ? (row.profit ?? 0) : (row.unrealized ?? 0)),
          0,
        );
        return {
          asset,
          name: coins.find((coin) => coin.symbol === asset)?.name ?? asset,
          holding,
          marketValue: holding * marketPrice,
          pnl,
          rows: [...rows].sort((a, b) => b.date.localeCompare(a.date)),
        };
      })
      .sort((a, b) => Number(b.holding > 0) - Number(a.holding > 0) || a.asset.localeCompare(b.asset));
  }, [coins, priceFor, sortedRows]);

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

  const onAddCoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCoinError("");
    if (!selectedCoin) {
      setCoinError("Search for a coin and choose one of the verified results");
      return;
    }
    setAddingCoin(true);
    try {
      const coin = await api.addCoin(selectedCoin.id);
      setCoinQuery("");
      setSelectedCoin(null);
      setCoinResults([]);
      setBuyForm((form) => ({ ...form, asset: coin.symbol, price: "" }));
      await refreshPrices();
    } catch (error) {
      setCoinError(error instanceof Error ? error.message : "Failed to add coin");
    } finally {
      setAddingCoin(false);
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
  const tickerItems = coins.map((coin) => ({ label: coin.symbol, value: prices[coin.symbol] ?? 0 }));

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
          {session?.user?.email && (
            <div className="user-info">
              <span className="user-email">{session.user.email}</span>
              <button className="btn-ghost btn-sm" onClick={() => signOut({ callbackUrl: "/auth" })}>
                LOGOUT
              </button>
            </div>
          )}
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

      <div className="workspace-nav-bar">
        <span className="workspace-nav-label">WORKSPACE</span>
        <AppNav active="portfolio" />
      </div>

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

      {/* PORTFOLIO OVERVIEW */}
      {portfolio && <UnifiedDashboard portfolio={portfolio} futures={futuresAccount} futuresActivity={futuresActivity} prices={prices} />}

      <PortfolioOverview
        buys={buys}
        prices={prices}
        usd={usd}
        realizedPnl={stats.realizedPnl}
        unrealized={unrealized}
        totalCost={stats.totalCost}
      />

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
          {coins.map((coin) => (
            <div className="price-tile" key={coin.symbol}>
              <div className="price-asset">{coin.symbol}</div>
              <div className="price-val">
                <input
                  type="text"
                  value={prices[coin.symbol] > 0 ? prices[coin.symbol].toString() : "—"}
                  readOnly
                />
              </div>
              <div className="price-label">{coin.name.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MANAGE COINS */}
      <div className="panel panel-coins">
        <div className="panel-header">
          <span className="panel-title">MANAGE COINS</span>
          <span className="coin-count">{coins.length} COINS</span>
        </div>
        <div className="coins-body">
          <div className="coin-list" aria-label="Enabled coins" hidden>
            {coins.map((coin) => (
              <div className="coin-chip" key={coin.symbol}>
                <span className="coin-chip-symbol">{coin.symbol}</span>
                <span className="coin-chip-name">{coin.name}</span>
                {coin.builtIn && <span className="coin-chip-core">CORE</span>}
              </div>
            ))}
          </div>
          <form className="coin-form" onSubmit={onAddCoin}>
            <div className="field coin-search-field">
              <label htmlFor="coinSearch">FIND A COIN</label>
              <input
                id="coinSearch"
                type="search"
                role="combobox"
                aria-expanded={coinResults.length > 0}
                aria-controls="coin-search-results"
                aria-autocomplete="list"
                value={coinQuery}
                onChange={(e) => {
                  setCoinQuery(e.target.value);
                  setSelectedCoin(null);
                  setCoinError("");
                }}
                placeholder="Search by name or symbol"
                autoComplete="off"
              />
              {searchingCoins && <span className="coin-search-status">SEARCHING...</span>}
              {coinResults.length > 0 && (
                <div className="coin-search-results" id="coin-search-results" role="listbox">
                  {coinResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className="coin-search-result"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setSelectedCoin(result);
                        setCoinQuery(`${result.name} (${result.symbol})`);
                        setCoinResults([]);
                      }}
                    >
                      <span className="coin-search-symbol">{result.symbol}</span>
                      <span className="coin-search-name">{result.name}</span>
                      <span className="coin-search-rank">{result.rank ? `#${result.rank}` : "UNRANKED"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-action btn-coin-action" type="submit" disabled={addingCoin || !selectedCoin}>
              {addingCoin ? "ADDING..." : "+ ADD COIN"}
            </button>
          </form>
          <div className="coin-help">Search by coin name or ticker, then choose the verified CoinGecko result.</div>
          {coinError && <div className="coin-error">{coinError}</div>}
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
                <input
                  id="buyAsset"
                  type="search"
                  list="portfolioCoinOptions"
                  autoComplete="off"
                  value={buyForm.asset}
                  onChange={(e) => setBuyForm((f) => ({ ...f, asset: e.target.value.trim().toUpperCase() }))}
                  placeholder="Search symbol or coin name"
                />
                <datalist id="portfolioCoinOptions">
                  {coins.map((coin) => (
                    <option key={coin.symbol} value={coin.symbol}>{coin.name}</option>
                  ))}
                </datalist>
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

      {/* ASSET LEDGER */}
      <div className="panel panel-asset-ledger">
        <div className="panel-header">
          <span className="panel-title">FULL LEDGER</span>
          <span className="ledger-asset-count">{assetLedgers.length} ASSETS</span>
        </div>
        <div className="asset-ledger-list">
          {assetLedgers.map((ledger) => {
            const expanded = expandedLedgerAsset === ledger.asset;
            return (
              <section className={`asset-ledger-card${expanded ? " expanded" : ""}`} key={ledger.asset}>
                <button
                  type="button"
                  className="asset-ledger-summary"
                  aria-expanded={expanded}
                  onClick={() => setExpandedLedgerAsset(expanded ? null : ledger.asset)}
                >
                  <span className="asset-ledger-identity">
                    <strong>{ledger.asset}</strong>
                    <small>{ledger.name}</small>
                  </span>
                  <span className="asset-ledger-metric">
                    <small>HOLDING</small>
                    <strong>{fmtQty(ledger.holding)}</strong>
                  </span>
                  <span className="asset-ledger-metric">
                    <small>VALUE</small>
                    <strong>{fmtUsd(ledger.marketValue)}</strong>
                  </span>
                  <span className="asset-ledger-metric">
                    <small>TOTAL P&amp;L</small>
                    <strong className={ledger.pnl >= 0 ? "profit-positive" : "profit-negative"}>
                      {fmtSignedUsd(ledger.pnl)}
                    </strong>
                  </span>
                  <span className="asset-ledger-transactions">{ledger.rows.length} TXNS</span>
                  <span className="asset-ledger-chevron" aria-hidden="true">⌄</span>
                </button>

                {expanded && (
                  <div className="asset-transaction-list">
                    {ledger.rows.map((row) => {
                      const transactionPnl = row.kind === "sell" ? row.profit : row.unrealized;
                      return (
                        <div className={`asset-transaction ${row.kind}`} key={`${row.kind}-${row.id}`}>
                          <div className="asset-transaction-heading">
                            <span className={row.kind === "buy" ? "badge-buy" : "badge-sell"}>
                              {row.kind.toUpperCase()}
                            </span>
                            <time>{row.date}</time>
                          </div>
                          <div className="asset-transaction-detail">
                            <small>QUANTITY</small>
                            <strong>{fmtQty(row.amount)}</strong>
                          </div>
                          <div className="asset-transaction-detail">
                            <small>PRICE</small>
                            <strong>{fmtUsd(row.price)}</strong>
                          </div>
                          <div className="asset-transaction-detail">
                            <small>TOTAL</small>
                            <strong>{fmtUsd(row.total)}</strong>
                          </div>
                          <div className="asset-transaction-detail">
                            <small>P&amp;L</small>
                            <strong className={transactionPnl !== null ? (transactionPnl >= 0 ? "profit-positive" : "profit-negative") : undefined}>
                              {transactionPnl !== null ? fmtSignedUsd(transactionPnl) : "—"}
                            </strong>
                          </div>
                          <button
                            className="delete-btn asset-transaction-delete"
                            aria-label={`Delete ${row.kind} transaction for ${row.asset}`}
                            onClick={() => (row.kind === "buy" ? onDeleteBuy(row.id) : onDeleteSell(row.id))}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {assetLedgers.length === 0 && <div className="asset-ledger-empty">No transactions yet.</div>}
        </div>
      </div>

      {/* LEDGER */}
      {false && <div className="panel panel-ledger" hidden>
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
                  <td data-label="DATE">{row.date}</td>
                  <td data-label="TYPE">
                    <span className={row.kind === "buy" ? "badge-buy" : "badge-sell"}>
                      {row.kind === "buy" ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td data-label="WALLET">{row.wallet}</td>
                  <td data-label="ASSET" style={{ color: row.kind === "buy" ? "var(--accent)" : "var(--red)", fontWeight: 700 }}>
                    {row.asset}
                  </td>
                  <td data-label="AMOUNT">
                    {fmtQty(row.amount)}
                    {row.kind === "buy" && row.remaining !== null && (
                      <span style={{ color: "var(--text-dim)", fontSize: "0.65rem" }}> ({fmtQty(row.remaining)} open)</span>
                    )}
                  </td>
                  <td data-label="PRICE">{fmtUsd(row.price)}</td>
                  <td data-label="TOTAL">{fmtUsd(row.total)}</td>
                  <td data-label="MARKET PRICE">
                    {row.currentPrice !== null ? (
                      fmtUsd(row.currentPrice)
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>—</span>
                    )}
                  </td>
                  <td data-label={row.kind === "sell" ? "REALIZED P&L" : "UNREALIZED P&L"} className={row.unrealized !== null ? (row.unrealized >= 0 ? "profit-positive" : "profit-negative") : undefined}>
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
                  <td data-label="ACTION" className="ledger-action-cell">
                    <button
                      className="delete-btn"
                      aria-label={`Delete ${row.kind} transaction for ${row.asset}`}
                      onClick={() => (row.kind === "buy" ? onDeleteBuy(row.id) : onDeleteSell(row.id))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td className="ledger-empty" colSpan={10} style={{ textAlign: "center", color: "var(--text-dim)" }}>
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
      </div>}

      <div className="footnote">
        DATA STORED IN A DATABASE · LIVE PRICES VIA COINGECKO (SERVER-CACHED) · AUTO-REFRESH 10s
      </div>
    </div>
  );
}

const ALLOC_COLORS: Record<string, string> = {
  BTC: "var(--amber)",
  ETH: "var(--cyan)",
  XAUT: "var(--accent)",
};

function PortfolioOverview({
  buys,
  prices,
  usd,
  realizedPnl,
  unrealized,
  totalCost,
}: {
  buys: BuyWithRemaining[];
  prices: PriceMap;
  usd: number;
  realizedPnl: number;
  unrealized: number;
  totalCost: number;
}) {
  const val = useMemo(() => portfolioValuation(buys, prices), [buys, prices]);
  const totalEquity = usd + val.holdingsValue;
  const totalPnl = realizedPnl + unrealized;
  const returnPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const up = totalPnl >= 0;

  return (
    <div className="panel panel-overview">
      <div className="panel-header">
        <span className="panel-title">PORTFOLIO OVERVIEW</span>
        <span className={`overview-return ${up ? "up" : "down"}`}>
          {fmtSignedPct(returnPct)}
          <span className="overview-return-sub">TOTAL RETURN</span>
        </span>
      </div>
      <div className="overview-body">
        <div className="overview-hero">
          <div className="overview-hero-label">TOTAL EQUITY</div>
          <div className="overview-hero-value">{fmtUsd(totalEquity)}</div>
          <div className="overview-hero-breakdown">
            <span>
              <i style={{ background: "var(--accent)" }} />
              HOLDINGS {fmtUsd(val.holdingsValue)}
            </span>
            <span>
              <i style={{ background: "var(--amber)" }} />
              CASH {fmtUsd(usd)}
            </span>
          </div>
          <div className={`overview-pnl ${up ? "up" : "down"}`}>
            {fmtSignedUsd(totalPnl)}
            <span className="overview-pnl-sub">
              UNREALIZED {fmtSignedUsd(unrealized)} · REALIZED {fmtSignedUsd(realizedPnl)}
            </span>
          </div>
        </div>

        <div className="overview-alloc">
          <div className="overview-alloc-title">ASSET ALLOCATION</div>
          {!val.priced || val.holdingsValue <= 0 ? (
            <div className="overview-alloc-empty">No priced open positions yet.</div>
          ) : (
            val.byAsset
              .filter((a) => a.value > 0)
              .map((a) => {
                const pct = (a.value / val.holdingsValue) * 100;
                return (
                  <div className="alloc-row" key={a.asset}>
                    <div className="alloc-head">
                      <span className="alloc-asset">{a.asset}</span>
                      <span className="alloc-val">
                        {fmtUsd(a.value)} · {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="alloc-bar">
                      <div
                        className="alloc-fill"
                        style={{ width: `${pct}%`, background: ALLOC_COLORS[a.asset] ?? "var(--text-dim)" }}
                      />
                    </div>
                  </div>
                );
              })
          )}
        </div>
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
