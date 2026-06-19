# LEDGRS — Crypto Portfolio Ledger

A crypto portfolio ledger and trading tracker. Originally a single-file
browser app (localStorage), now a full-stack **Next.js + TypeScript** app with a
real database, a server-side price service, and an HTTP API.

## Stack

| Layer        | Choice                                  | Why |
|--------------|------------------------------------------|-----|
| Framework    | **Next.js 15** (App Router) + React 19   | One codebase for UI + API; deploys to Vercel in one click |
| Language     | **TypeScript**                           | Type safety the original vanilla JS lacked |
| Database     | **Prisma ORM** + **SQLite** (dev)        | Zero-config locally; swap to Postgres for production with a one-line change |
| Money math   | **decimal.js**                           | Exact decimal arithmetic — no floating-point drift |
| Prices       | Server-side cached **CoinGecko** fetch   | One upstream call serves all users; API key never reaches the browser |

## Project layout

```
prisma/
  schema.prisma        # Buy / Sell / Setting models (money stored as decimal strings)
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

1. **Database** — provision managed Postgres (Neon, Supabase, Railway…).
2. In `prisma/schema.prisma` set `provider = "postgresql"`.
3. Set `DATABASE_URL` to the Postgres connection string in your host's env vars.
4. Run `npx prisma migrate deploy` (use migrations instead of `db push` in prod).
5. Deploy the app to **Vercel** (or any Node host); `npm run build` runs
   `prisma generate` automatically.

No application code changes are needed to switch databases — money is stored as
decimal strings, so it's portable across engines.

## Roadmap (to make it truly multi-user)

The app is currently single-tenant (one shared portfolio). The next step for a
real product is **authentication + per-user data**:

- Add a managed auth provider (Clerk, Auth0, or Supabase Auth).
- Add a `userId` column to `Buy` / `Sell` / `Setting` and scope every query to
  the signed-in user.
- Protect the API routes with the session.

The data and calculation layers are already structured to make that change
localized to the API routes.
