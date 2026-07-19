# LEDGRS — Crypto Portfolio Ledger

A crypto portfolio ledger and trading tracker. Originally a single-file
browser app (localStorage), now a full-stack **Next.js + TypeScript** app with a
real database, a server-side price service, and an HTTP API.

## Stack

| Layer        | Choice                                  | Why |
|--------------|------------------------------------------|-----|
| Framework    | **Next.js 15** (App Router) + React 19   | One codebase for UI + API; deploys to Vercel in one click |
| Language     | **TypeScript**                           | Type safety the original vanilla JS lacked |
| Database     | **Prisma ORM** + SQLite/PostgreSQL       | SQLite locally; durable PostgreSQL on Vercel |
| Money math   | **decimal.js**                           | Exact decimal arithmetic — no floating-point drift |
| Prices       | Server-side cached **CoinGecko** fetch   | One upstream call serves all users; API key never reaches the browser |

## Project layout

```
prisma/
  schema.prisma        # Local SQLite schema
  postgres/            # Production PostgreSQL schema and migrations
  seed.ts              # Demo portfolio
src/
  lib/
    calculations.ts    # Pure, testable P&L / remaining / stats (decimal.js)
    prices.ts          # Cached CoinGecko price service
    db.ts              # Prisma singleton + USD balance helpers
    csv.ts             # Quote-aware CSV import/export
    api.ts             # Typed client → server fetch wrappers
    types.ts, format.ts
  app/
    api/               # Route handlers: portfolio, buys, sells, usd, prices, import
    LedgerApp.tsx      # Main client UI
    globals.css        # Terminal theme
```

## Getting started

```bash
npm install            # also runs `prisma generate`
npm run db:push        # create the SQLite schema (dev.db)
npm run db:seed        # optional: load the demo portfolio
npm run dev            # http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run typecheck`, `npm run db:reset`.

## Deploying to production

1. In Vercel, open **Storage**, create a Prisma Postgres (or Neon Postgres)
   database, and connect it to this project.
2. Confirm the integration created a production `DATABASE_URL` beginning with
   `postgresql://` or `postgres://`.
3. Add `AUTH_SECRET` and `AUTH_URL=https://your-project.vercel.app` to the
   Production environment variables.
4. Redeploy. `vercel.json` runs `npm run build:vercel`, which generates the
   PostgreSQL client and applies checked-in migrations before Next.js builds.

Local development remains unchanged and continues to use SQLite through
`prisma/schema.prisma`. Never put the production connection string in a tracked
file. The application already uses credentials authentication and user-scoped
data.
