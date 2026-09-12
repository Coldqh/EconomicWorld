# PATCH 16.6 — Integrity Repair

## Status

Integrity repair applied on top of the existing PATCH 16.6 work. No PHASE 17 systems were added.

The repair focuses on violations that could create money/assets, misprice ownership transactions, or leave a feature reachable only from tests rather than the normal simulation loop.

Application version: `0.16.6`.

## Critical integrity fixes

### Runtime FX liquidity no longer creates GENESIS money

The live FX path no longer calls `seedDeposit()` to refill a dealer. Dealer liquidity is now funded through existing balances and real bank credit. Dealer quote inventory is aggregated across eligible settlement accounts, and failed counter-legs are rolled back rather than leaving a half-completed FX conversion.

`GENESIS` remains initialization-only.

### FX spread no longer overwrites the market mid

The customer execution price may include dealer spread, but that execution price is no longer copied back into the pair's market mid solely because a retail conversion occurred.

### Insurance claims require a real loss event

Added `InsuranceLossEvent`. A claim now requires an actual registered, covered, in-period loss belonging to the insured owner. A single loss event cannot be claimed twice.

The player claim action no longer fabricates a loss equal to a fraction of insured value.

### Procurement uses reverse-auction semantics

Procurement first-price tenders rank valid supplier bids by lowest acceptable price rather than reusing seller-auction highest-price semantics.

### M&A shareholder consideration uses Equity Value

Default share-purchase consideration is now based on equity value plus control premium, rather than enterprise value while leaving target debt outstanding.

Enterprise value remains available for operating valuation/debt-capacity analysis.

### Player-created companies start clean

Player incorporation no longer clones a live company object. A new company is constructed from structural industry parameters with clean inventory, financial history, employees, goodwill and input state.

### Unified player/owner balance-sheet valuation

Added `src/finance/owner-valuation.ts`.

Owner net worth now values multi-currency cash, equity, non-ETF fund units, corporate/sovereign bonds, property/durables and supported liabilities in one reporting currency.

This fixes cases where subscribing to a fund appeared to destroy player net worth and where raw minor units from different currencies were previously added together.

### Player cash-flow classification

Player cash flow now separates:

- operating/living income and expenses;
- investing;
- financing;
- taxes.

Transfers between the player's own currency accounts are not treated as consumption or income.

### Market-maker venue consistency

Market-maker quotes submit actual orders to the exact venue for which the quote was calculated.

### REAL_WORLD multi-venue/arbitrage topology

Initialization now creates a small valid same-security cross-listing topology on compatible same-currency venues, and arbitrage agents receive the market access required to trade both legs.

Cross-venue arbitrage now uses real book executions and may retain temporary exposure after partial execution rather than assuming perfect fills.

### Autonomous triangular FX arbitrage

Positive triangular FX opportunities are now evaluated from the normal monthly simulation path and execute three real FX legs only when the net edge survives costs/liquidity.

### Market cadence

Liquidity/no-arbitrage infrastructure runs monthly:

- market makers;
- cross-venue arbitrage;
- triangular FX arbitrage;
- ETF arbitrage.

Heavier strategic/fundamental market-agent decisions and cash-and-carry evaluation remain quarterly to preserve the macro timestep and avoid excessive runtime growth.

### PE waterfall uses contributed/called economics

PE distributions prefer actual called capital rather than commitment size when allocating LP proceeds.

### LBO duplicate-loan bug fixed

The prior lender search used an eager `map(issueLoan).find(Boolean)` pattern, which could issue acquisition loans from multiple banks while tracking only the first. Lenders are now attempted sequentially and stop after the first approved acquisition loan.

### Genesis-time seeding

Economic-markets completion systems and market-agent topology are seeded during world initialization rather than the first live simulation month.

## New integrity regression suite

Added `tests/patch-16-6-integrity.test.ts`.

The integrity suite covers:

1. GENESIS transactions end before the live simulation.
2. FX dealer shortfall is funded by real bank credit, not GENESIS.
3. FX execution spread does not become the market mid.
4. Insurance payout requires a real loss event and the event cannot be claimed twice.
5. Procurement reverse auction selects the cheapest valid supplier.
6. Default M&A consideration uses Equity Value rather than Enterprise Value.
7. Newly incorporated player company starts without cloned live inventories/history.
8. Ordinary fund subscription preserves net worth by exchanging cash for an asset.
9. Financial-asset purchases are investing, not living expenses.
10. Market-maker orders stay on the quoted venue.
11. REAL_WORLD contains usable cross-listings and arbitrage access.
12. Positive cross-venue edge executes real market legs.
13. Positive triangular FX edge executes through the autonomous path.
14. FX transfers between the player's own accounts are not income/consumption.
15. LBO creates only one tracked acquisition loan.
16. PE target approval uses Equity Value as purchase consideration.

## Verification

### PASS

- TypeScript: `npx tsc --noEmit`
- ESLint: direct Node invocation over `src`, `tests`, and `vite.config.ts`
- `git diff --check`
- PATCH 16.5–16.6 targeted suite: **96/96 PASS**
- Integrity tests included in the above suite: **16/16 PASS**

Latest targeted-suite runtime in this environment: approximately **6.6 s**.

### Build environment caveat

The production Vite build cannot be certified inside this Linux container because the uploaded `node_modules` contains the wrong-platform Rolldown native dependency and lacks `@rolldown/binding-linux-x64-gnu`.

TypeScript compilation is clean. This is an uploaded dependency/platform mismatch, not a TypeScript build error introduced by the patch.

### Long-run caveat

The full legacy 20-year suite was not certified in this sandbox after the integrity changes. Shorter REAL_WORLD smoke runs progressed beyond 13 simulated years with no post-initialization GENESIS creation and with FX dealer liquidity funded by real bank loans, but the complete 240-month legacy run exceeded the practical execution budget/inconsistently stalled in this environment.

Do not treat this document as a replacement for rerunning the official warm-up + measured long-run benchmark on the project's normal Windows development host.

## Remaining P1 / non-blocking architectural debt

### PE acquisition vehicle

Acquisition borrowing is still legally simplified: the PE fund is the acquisition-loan borrower. A more realistic future refinement is a dedicated acquisition SPV/HoldCo with sponsor equity and acquisition debt sitting at the vehicle/portfolio structure.

The current flow is economically functional and the duplicate-loan bug is fixed, so this was not expanded into a destabilizing corporate-structure rewrite during the integrity pass.

### REAL_WORLD data

Observed/estimated/calibrated fallback coverage remains intentionally partial where complete local source series do not exist.

### UI/module size

`App.tsx`, the main JS chunk and parts of the domain model remain candidates for feature-level splitting. No large UI rewrite was included in this integrity patch.

## Integrity principle after this patch

A live system must not solve missing liquidity by creating genesis money.

A claim must originate from a real economic loss.

A purchase of a financial asset must exchange one asset for another rather than reduce wealth by accounting presentation.

Shareholders in an acquisition must be paid for equity, not enterprise value plus retained debt.

An auction must use clearing semantics appropriate to what is being bought or sold.

A market feature is not complete merely because a callable function exists: the normal world must be capable of reaching and using it.
