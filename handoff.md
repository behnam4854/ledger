# LEDGRS — Quant Trading Chapter · Handoff

> Resume doc for picking this work back up later. Last updated: 2026-06-24.

## TL;DR
We're turning the **LEDGRS** crypto portfolio ledger into a **quant trading lab**.
End goal chosen by the user: **Backtesting Lab** (prove strategies on historical
data — *not* live auto-trading). We build bottom-up; each stage is usable alone.

- ✅ **Stage 1 — Data + Signals: DONE & verified** (this session)
- ⏭️ **Next up — Stage 3: the Backtest engine** (`lib/backtest.ts`)
- Stage 4 (paper / live trading) is explicitly **out of scope** unless the user revisits it.

---

## How to run it
```bash
cd E:\Projects\ledger\cloned
npm run dev            # http://localhost:3000
```
- Login: **demo@ledgrs.dev** / **demo1234**
- To populate signals: log in → **QUANT SIGNALS** panel → **⤓ BACKFILL HISTORY**
  (pulls ~1y of daily closes from CoinGecko into the `Candle` table).
- `.env` has a **dev-only throwaway** `AUTH_SECRET` — regenerate (`openssl rand -base64 33`) before any deploy.

### Useful scripts
| Command | What |
|---|---|
| `npm run typecheck` | `tsc --noEmit` (was green at handoff) |
| `npm run db:push` | apply schema changes to SQLite |
| `npm run db:seed` | reseed demo user/portfolio |
| `npm run db:reset` | force-reset + reseed |

> ⚠️ Windows gotcha: `prisma generate` throws `EPERM` if the dev server is
> running (it locks the query-engine DLL). Stop the Next.js node process first.
> Don't blanket-kill node — find the PID by command line (`next`) and stop just that.

---

## Stack (unchanged)
Next.js 15 (App Router) · React 19 · TypeScript · Prisma + SQLite · next-auth v5 ·
**decimal.js for all money/quantity math** (decimal strings on the wire).
Assets: **BTC, ETH, XAUT**. Prices: server-cached CoinGecko (10s TTL).

**Codebase convention that matters:** money logic lives in *pure, decimal-exact,
unit-testable* functions in `src/lib/`. Keep new quant logic the same way.

---

## What Stage 1 added (this session)

### Data layer
- **`prisma/schema.prisma`** — new `Candle` model: `@@id([asset, date])`, `close`
  as a decimal string. Shared market data (no `userId`), like the price cache.
- **`src/lib/marketdata.ts`**
  - `backfillAll(days=365)` — pulls daily closes from CoinGecko `market_chart`
    (per-asset error isolation + 1.2s spacing for rate limits), upserts into `Candle`.
  - `recordLiveClose(asset, price)` — keeps *today's* candle fresh from the live price.
  - `getCloses(asset)` — oldest→newest closes for indicators/backtests.

### Quant brain (pure, decimal-exact)
- **`src/lib/indicators.ts`**
  - `sma`, `ema` (SMA-seeded), `rsi` (Wilder's smoothing, default 14).
    All return arrays aligned to input; warmup filled with `null`.
  - `computeSignal(closes, config?)` → `{ type: BUY|SELL|HOLD, reason, strength, rsi, smaShort, smaLong }`.
    Rules (simple + explainable, **not** advice): RSI extremes = mean-reversion
    triggers; otherwise follow SMA20-vs-SMA50 trend; thin data = HOLD.
  - `DEFAULT_SIGNAL_CONFIG` = `{ short 20, long 50, rsi 14, overbought 70, oversold 30 }`.
  - Sanity-tested: SMA value+warmup, EMA seeding `[null,null,2,3,4]`, RSI all-up=100 /
    all-down=0, signal(rising)=SELL overbought, signal(tiny)=HOLD.

### API routes (all auth-gated; return 401 unauthenticated, verified)
- `GET  /api/signals` — folds live price into today's candle, then returns
  per-asset `AssetSignal` + indicator readings.
- `GET  /api/candles?asset=BTC` — stored daily candles.
- `POST /api/candles/backfill` `{ days }` — triggers backfill (capped 3650d).

### Client + UI
- **`src/lib/api.ts`** — `fetchSignals`, `fetchCandles`, `backfillCandles`.
- **`src/lib/types.ts`** — `Candle`, `CandlesResponse`, `AssetSignal`, `SignalsResponse`.
- **`src/app/LedgerApp.tsx`** — `<SignalsStrip>` panel (below MARKET DATA): per-asset
  BUY/SELL/HOLD badge, RSI, SMA20/SMA50, conviction bar, backfill button, empty state.
  State: `signals`, `signalsAt`, `backfilling`; handlers `refreshSignals`, `onBackfill`.
- **`src/app/globals.css`** — `.panel-signals` / `.signal-*` styles, theme-matched.

> Also already present from the prior session: **Portfolio Overview** hero banner
> (`portfolioValuation()` in `calculations.ts`, `<PortfolioOverview>` in `LedgerApp.tsx`).

---

## ⏭️ Next step: the Backtest engine (Stage 3)
Goal: answer "would this rule have made money?" — the user's stated end goal.

**Plan (proposed, not yet built):**
1. `src/lib/backtest.ts` — pure engine. A `Strategy = (closes, i) => SignalType`.
   Simulate starting cash, all-in BUY / all-out SELL (or sized), build an equity curve.
   Metrics: **total return, max drawdown, Sharpe, win rate, # trades — vs. buy-and-hold**.
   Reuse `computeSignal` so the *live* signal is also a backtestable strategy.
2. `GET /api/backtest?asset=&strategy=&...` over stored `Candle` history.
3. UI: a "Backtest" panel — pick asset + strategy + params → equity curve drawn
   over the price line, metrics table, vs-HODL comparison.

**Open questions to confirm with user before building:**
- Position sizing: all-in/all-out, or fixed fraction?
- Include a fee/slippage assumption? (recommend a small configurable bps fee)
- Backtest one asset at a time, or a whole-portfolio strategy?

**Alternative the user may pick instead:** tweak signal rules/thresholds live first
(now that the SignalsStrip is visible) before committing to the backtester.

---

## Roadmap recap (the 4 stages)
1. 🟢 **Data layer** — capture history. *(DONE)*
2. 🟡 **Signals & indicators** — SMA/RSI/etc. *(DONE — folded into Stage 1)*
3. 🟠 **Backtesting** — prove strategies on history. *(NEXT)*
4. 🔴 **Execution** — paper first, then live via exchange API. *(OUT OF SCOPE for now;
   real money / key custody / regulatory risk — its own project with a big gate.)*

## Honest limitations to remember
- CoinGecko free series = daily **snapshot closes**, not true OHLC / no intraday.
  Fine for daily-close indicators & backtests; schema can extend to OHLC later
  without a rewrite.
- Signal rules are intentionally simplistic — the backtester exists to validate them.
- Not financial advice. Nothing here places real orders.
