# LEDGRS Product Backlog

## Product standard

- Build every new screen mobile-first, then enhance it for tablet and desktop.
- Critical workflows must work without horizontal page scrolling at phone widths.
- Every production-facing change must be tested at desktop and common mobile viewport sizes.

## Sprint 1 — Reliability (complete)

- [x] Add end-to-end tests for registration and login.
- [x] Add end-to-end tests for opening, adjusting, partially closing, and fully closing futures positions.
- [x] Add end-to-end tests for editing and deleting closed trades.
- [x] Add automated mobile viewport coverage for the portfolio and futures workspaces.
- [x] Add order validation and confirmation dialogs before closing positions.

## Sprint 2 — Trading audit history (complete)

- [x] Add a persistent activity log for every position change and execution.

## Trading features

- [ ] Add limit-entry orders.
- [ ] Add stop-entry orders.
- [ ] Model configurable slippage.
- [ ] Improve liquidation simulation with maintenance-margin tiers.
- [ ] Expand exchange-fee and funding simulation.

## Portfolio experience

- [ ] Build a unified dashboard combining spot and futures equity, P&L, exposure, and history.
