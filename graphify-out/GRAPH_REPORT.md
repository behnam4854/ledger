# Graph Report - E:/Projects/ledger/cloned  (2026-06-24)

## Corpus Check
- Corpus is ~7,899 words - fits in a single context window. You may not need a graph.

## Summary
- 158 nodes · 244 edges · 14 communities (10 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_BuysImport & P&L Calc|Buys/Import & P&L Calc]]
- [[_COMMUNITY_DB, Auth & CRUD Routes|DB, Auth & CRUD Routes]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_API Client & CSV|API Client & CSV]]
- [[_COMMUNITY_Ledger UI & Formatting|Ledger UI & Formatting]]
- [[_COMMUNITY_Prices & Types|Prices & Types]]
- [[_COMMUNITY_NPM Scripts|NPM Scripts]]
- [[_COMMUNITY_App Layout & Providers|App Layout & Providers]]
- [[_COMMUNITY_Prisma Seed|Prisma Seed]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_NextAuth Type Augmentation|NextAuth Type Augmentation]]
- [[_COMMUNITY_NextAuth Handler|NextAuth Handler]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `dec()` - 13 edges
3. `scripts` - 10 edges
4. `jsonOrThrow()` - 8 edges
5. `getUsdBalance()` - 6 edges
6. `Sell` - 6 edges
7. `PositionDetails()` - 5 edges
8. `BuyWithRemaining` - 5 edges
9. `PriceMap` - 5 edges
10. `withRemaining()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `POST()` --calls--> `dec()`  [EXTRACTED]
  src/app/api/buys/route.ts → src/lib/calculations.ts
- `toDecOrNull()` --calls--> `dec()`  [EXTRACTED]
  src/app/api/import/route.ts → src/lib/calculations.ts
- `GET()` --calls--> `getUsdBalance()`  [EXTRACTED]
  src/app/api/portfolio/route.ts → src/lib/db.ts
- `POST()` --calls--> `dec()`  [EXTRACTED]
  src/app/api/sells/route.ts → src/lib/calculations.ts
- `GET()` --calls--> `getUsdBalance()`  [EXTRACTED]
  src/app/api/usd/route.ts → src/lib/db.ts

## Import Cycles
- None detected.

## Communities (14 total, 4 thin omitted)

### Community 0 - "Buys/Import & P&L Calc"
Cohesion: 0.17
Nodes (17): POST(), ImportBuy, ImportSell, toDecOrNull(), computeRemaining(), dec(), EPSILON, isOpen() (+9 more)

### Community 1 - "DB, Auth & CRUD Routes"
Cohesion: 0.14
Nodes (9): getUsdBalance(), globalForPrisma, setUsdBalance(), authConfig, { handlers, auth, signIn, signOut }, { auth: middleware }, config, GET() (+1 more)

### Community 2 - "Package Dependencies"
Cohesion: 0.10
Nodes (20): dependencies, bcryptjs, decimal.js, next, next-auth, @prisma/client, react, react-dom (+12 more)

### Community 3 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 4 - "API Client & CSV"
Cohesion: 0.16
Nodes (15): BuyInput, createBuy(), createSell(), deleteBuy(), deleteSell(), fetchPortfolio(), fetchPrices(), importData() (+7 more)

### Community 5 - "Ledger UI & Formatting"
Cohesion: 0.23
Nodes (10): EMPTY_PRICES, LedgerApp(), LedgerRow, PositionDetails(), SortColumn, unrealizedForBuy(), fmtQty(), fmtSignedUsd() (+2 more)

### Community 6 - "Prices & Types"
Cohesion: 0.23
Nodes (9): cache, getPrices(), PriceCache, Asset, ASSET_TO_COINGECKO_ID, ASSETS, Portfolio, PriceMap (+1 more)

### Community 7 - "NPM Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, db:push, db:reset, db:seed, dev, lint, postinstall (+2 more)

### Community 9 - "Prisma Seed"
Cohesion: 0.67
Nodes (3): isoDaysAgo(), main(), prisma

## Knowledge Gaps
- **62 isolated node(s):** `nextConfig`, `name`, `version`, `description`, `private` (+57 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scripts` connect `NPM Scripts` to `Package Dependencies`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `nextConfig`, `name`, `version` to the rest of the system?**
  _62 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `DB, Auth & CRUD Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `Package Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `TypeScript Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._