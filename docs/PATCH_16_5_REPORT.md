# PATCH 16.5 IMPLEMENTED

PHASE 13–16 reconciled without PHASE 17 mechanics. Defense, statecraft and conflict now participate in the normal deterministic monthly loop.

## AUDIT FINDINGS

Confirmed blockers: binary `stock/480` maintenance, fixed budget shares, manual-only conflict start, route damage after trade, free military conversion, casualties disconnected from cohorts, weak domain/R&D/infrastructure effects, eternal ceasefire risk, baseline route repair, fake 51% SOE metadata, toy political-economy amounts and observational shadow output. Alliance/statecraft/data/test gaps were also confirmed. All were addressed in scope.

## DEFENSE STEADY STATE

Funded forces converge to a non-zero equilibrium. At months 120/240/600 equipment condition for RU/DE/US/JP/KR remains 68.5–72%; readiness remains non-zero and rises with supply, training and technology.

## EQUIPMENT DEPRECIATION

Gross, serviceable, unavailable and retired equipment are tracked. Average age changes the maintenance requirement; conflict use increases it. Retirement is explicit capital disposal and procurement distinguishes replacement from expansion.

## MAINTENANCE MODEL

`requiredMaintenance`, actual spending, coverage and backlog are continuous. Full coverage stabilizes condition, underfunding degrades it, and excess coverage repairs backlog. Age is counted once through required cost.

## DEFENSE BUDGET ALLOCATION

Needs replace fixed shares: payroll, minimum O&M and infrastructure maintenance are funded first; remaining funds go to delayed R&D and procurement. Procurement is reduced while maintenance is underfunded.

## MILITARY PAYROLL

Required payroll derives from active, support, reserve and mobilized personnel using country compensation calibration. Payments reach multiple working-age cohorts. Persistent shortfall reduces the affordable active force.

## MOBILIZATION LABOUR EFFECT

Mobilized reserves are removed from cohort employment and therefore from civilian labour availability. Settlement returns surviving personnel gradually to the civilian aggregate.

## INDUSTRIAL CONVERSION

Conversion removes actual capital from civilian firm cohorts and transfers only an efficiency-adjusted amount to defense sectors. No free capacity is created.

## CASUALTIES / DEMOGRAPHY

Aggregate losses reduce active/mobilized personnel, working-age cohort population and employment without double counting.

## CAPABILITY DOMAINS

Land, air, naval, air defense, logistics and cyber/communications track capital, serviceability, personnel weights, maintenance, technology, readiness and supply dependence. Domains affect readiness, attrition and replacement.

## DEFENSE R&D

Spending accumulates as research progress. Technology changes only after a country-scale threshold is reached; there is no instant bonus.

## DEFENSE INFRASTRUCTURE

Infrastructure stock and condition affect readiness. Spending covers maintenance and supplies real reconstruction resources.

## REAL_WORLD DEFENSE DATA

`CountryDefenseProfile` supplies distinct OBSERVED/ESTIMATED values for the USA, Russia, Germany, Japan and South Korea. Synthetic mode retains procedural profiles.

## CONFLICT SIMULATION ORDER

The month is split into pre-economic conflict state, production/trade/finance, and post-economic operations. Mobilization and pending route damage are visible before current trade; new operational damage affects the next clearing period.

## ROUTE CAPACITY FIX

Conflict never reduces already-cleared current capacity retroactively. Every stage checks `usedCapacity <= capacity`; 20Y peace recorded 1,440 clean stage checks and 50Y peace 3,600.

## RECONSTRUCTION

Damaged routes accumulate a backlog. Structural REAL_WORLD targets no longer repair damaged routes; restoration consumes actual infrastructure spending.

## AUTONOMOUS CONFLICT INITIATION

The normal loop evaluates bilateral pairs every six months and can progress proposal → approval/rejection → mobilizing → active without test/API activation. Peaceful low-friction control remains peaceful.

## CONFLICT DECISION MODEL

The score uses friction, dependence, estimated relative domains, readiness, stockpiles, fiscal space, domestic credibility and alliance risk. It uses estimates rather than exact future outcomes.

## ALLIANCE RESPONSE

Attacked allies evaluate commitment and capacity. Eligible allies transfer real equipment and supplies; participation is not automatically global.

## CONFLICT LIFECYCLE

Statuses now include proposed, approved, rejected, mobilizing, active, ceasefire, negotiation, settled and terminated. Intensity changes with pressure and supply.

## CEASEFIRE / SETTLEMENT

Ceasefire advances to negotiation and settlement or can resume through future policy. Settlement demobilizes survivors and removes the previous fixed budget ratchet.

## AUTONOMOUS STATECRAFT

Initial actions and retaliation use actual directional dependencies, domestic pressure, fiscal space and active restrictions. Decision traces preserve cost, expected effect, support and evidence.

## TARIFF / RESTRICTION INITIATION

Tariffs, export controls and investment screening may arise from concentrated dependencies when expected benefit exceeds domestic cost. There is no random annual sanction.

## AUTONOMOUS AID

Allied fiscal stress can trigger a bounded real government-to-government transfer with BOP records and a decision trace.

## AUTONOMOUS SOVEREIGN LENDING

Countries with fiscal space can create and draw bounded facilities using real principal transfers, mirrored assets/liabilities and risk-aware traces.

## ASSET FREEZE HARD SEMANTICS

Asset freeze returns hard deny for asset, investment and finance access. The common cross-border financial settlement enforces the denial; title and payer cash remain with the owner.

## SOE OWNERSHIP FIX

The first company of a country is no longer marked 51% state-owned. Apple/Toyota/ASML/Samsung cannot receive an SOE mandate without actual government voting control.

## CAP TABLE SINGLE SOURCE OF TRUTH

SOE mandates and governance derive from equity securities and government holdings only. Invalid legacy duplicate metadata is discarded.

## LOBBYING SCALE

Lobbying derives from group resources, policy value, influence and available cash rather than a fixed 5,000 minor units.

## PROCUREMENT SCALE

Political procurement derives from actual monthly GDP and fiscal cash. Contract delivery and leakage remain separate ledger transfers.

## CORRUPTION SCALE

Leakage is a fraction of contract value governed by capture and procurement integrity. Gross payment equals delivered value plus recipient/network leakage.

## CONNECTED LENDING SCALE

Loan size uses borrower revenue/expense need and bank capital constraints rather than a fixed 25,000.

## SHADOW ECONOMY REAL FLOWS

Informal labour, gross sales, inputs, mixed wages, undeclared profit, consumption and tax gap are tracked. Resource capacity caps production; quarterly cash settlement uses real cohort ledger money. True GDP includes informal value added while official GDP does not.

## INSTITUTIONAL DATA CALIBRATION

`CountryInstitutionProfile` provides separate ESTIMATED tax administration, regulation, contract enforcement, statistics, procurement integrity, corruption enforcement, policy stability and central-bank independence inputs. Productivity is no longer the sole proxy.

## SAVE MIGRATION

Schema 14 remains compatible because added reconciliation fields are optional/derived. Migration preserves the old world, recomputes zero-readiness conservatively from actual condition/training/logistics, and removes fake SOE metadata without transferring shares.

## TEST RESULTS

- Main regression: 92/92 PASS.
- PATCH 16.5 and PHASE 15–16 targeted: 19/19 PASS.
- Build: PASS. ESLint: PASS.

## PEACE 20Y BENCHMARK

Final instrumented run: 74,802 ms; 1,440 stage checks; zero monthly/final invariant failures; condition 68.5–72%; readiness 84.0–88.3%; save 30,696,648 bytes; heap 176,901,160 bytes.

Observed timing in the same session varied from 50,380 to 94,232 ms under host contention. The best comparable instrumented result is +17.9% versus the previous 42,736 ms reference, below the +25% hard-warning boundary but above the preferred +15% target.

## PEACE 50Y BENCHMARK

139,949 ms; 3,600 stage checks; zero failures; condition remains at the same 68.5–72% plateau through month 600; save 48,557,498 bytes; steady heap 179,611,056 bytes.

## CONFLICT 24M BENCHMARK

Autonomous conflict active; US/RU losses and capital damage non-zero; route and ledger stage checks pass.

## CONFLICT 60M BENCHMARK

Conflict remains economically supplied and costly; every-month invariants pass. No retroactive route-capacity breach.

## CONFLICT 120M BENCHMARK

CPU-profiled run: 22,802 ms; first conflict settled at month 74; a new high-friction proposal later became active; 720 stage checks and final invariants pass; save 25,203,915 bytes.

## MONTHLY INVARIANT RESULTS

`LongRunInvariantHarness` checks pre-conflict, production, trade, finance, post-conflict and month-close stages. It records month, stage, entity and pre/post detail and supports fail-fast test mode.

## CPU PROFILE

14,066 samples, 3,064 nodes, 798,995-byte profile. Main hotspots were existing history/accounting work: `compactTransactions` (515 hits), `transactionIndex` (503), `closeMonthlyAccounting` (435), `sumAccounts` (385), `compactLedgerHistory` (373). `checkLongRunStage` was 214 hits. Temporary profile was removed after analysis.

## STEADY HEAP

20Y: 176.9 MB. 50Y: 179.6 MB. CPU profiling raised observed heap to 398.9 MB due to profiler overhead.

## SAVE SIZE

20Y: 30.7 MB. 50Y: 48.6 MB. Conflict 120M: 25.2 MB.

## BUNDLE SIZE

Main lazy application chunk: 720.22 kB raw / 199.13 kB gzip. Defense/conflict panel remains lazy at 5.03 kB raw / 1.61 kB gzip.

## KNOWN LIMITATIONS

Conflict remains strategic and aggregate. Frozen cash is retained by the payer rather than represented in a dedicated blocked-account subledger. Continued extreme bilateral friction can produce a later second conflict after settlement.

## TECH DEBT

Ledger compaction/indexing and monthly accounting dominate CPU. `domain/model.ts` still contains legacy central interfaces although new calibration and harness types were split into domain modules.

## READY FOR PHASE 17?

YES. All critical functional gates pass. Performance is practical and save/heap remain bounded; the preferred +15% wall-clock target is a documented warning, while the comparable instrumented result remains inside the +25% hard boundary. PHASE 17 was not implemented.
