# PATCH 16.6 PERFORMANCE & STORAGE HARDENING

## INITIAL CPU PROFILE

Профилирование выполнено на deterministic seed `baseline`, режим `REAL_WORLD`. Сняты CPU profiles 1Y, 5Y и 20Y, allocation profile 1Y, отдельные сценарии Capital Markets 10Y и Market Stress 12M проверены официальным runner. Исходный 5Y профиль: 26 352 мс; исходный 1Y профиль: 4 112 мс.

## INITIAL HOTSPOTS

Исходный 5Y total time: monthly market ecology 10 891,3 мс; heterogeneous agents 7 184,0; `placeOrder` 6 073,4; market makers 3 068,0; global economy 2 562,1; ledger compaction 2 026,8; order matching 1 889,2; WHY capture 1 426,7.

Top self time включал повторные scans/sorts в `exchange.ts` (до 1 981,4 мс на callsite), `placeOrder` 1 557,7 мс, `compactTransactions` 590,3, GC 547,6, `transactionIndex` 492,7 и accounting close 382,3.

Главные allocation sources: `settleDepositPayment` до 2,62 МБ на allocation node, `transactionIndex` 2,10 МБ, FX conversion 1,57 МБ, settlement entries 1,57 МБ, затем global trade settlement, accounting reports и save sizing примерно по 1,05 МБ.

## COMPLEXITY AUDIT

| Контур | Было | Стало |
|---|---:|---:|
| Лучший bid/ask | O(n log n) на match | O(1) для уровня, O(log p) при вставке |
| Order/venue lookup | O(n) | O(1) |
| Зарезервированные позиции/деньги | O(n) | O(k) активных заявок владельца |
| Cross-venue topology | повторный O(v²) | O(1) lookup предвычисленных пар |
| OHLCV update | O(h) на сделку | O(1) |
| Recent volatility | O(h) | O(window) |
| FX triangles | O(c³) генерация ежемесячно | фиксированный topology index |
| Ledger month lookup | O(t) с тяжёлым индексом | O(transactions this month) |
| History compaction | O(keys × history) | O(history) |
| Company peers/debt/projects | O(companies² + loans × companies) | O(companies + loans) |
| Bank ALM | O(banks × accounts/loans/holdings) | O(accounts + loans + holdings + banks) |
| Sovereign work set | повторные scans всей истории | O(active/due issues) после индексирования |
| Claims/deal pipelines | O(all historical) | O(active/unclaimed) |

## ORDER BOOK OPTIMIZATION

Добавлены книги по `securityId + exchangeId`, price levels с FIFO queues, бинарная вставка цены, O(1) order lookup и ленивое удаление завершённых заявок. Matching и settlement не меняют ценовые, денежные или ownership-правила.

## MARKET TOPOLOGY INDEXES

В runtime `WeakMap` вынесены listings by security/venue, cross-listed securities, venue pairs, maker eligibility, brokers, brokerage/bank accounts, owner commitments и active books. Индексы не сериализуются.

## MARKET MAKER OPTIMIZATION

Maker quotes отменяются адресно, предыдущие котировки и inventory берутся из runtime indexes. Месячная котировка сохранена. Structural test подтверждает, что active maker state ограничен числом security/venue pairs, а не возрастом мира.

## HETEROGENEOUS AGENT OPTIMIZATION

Убраны повторные scans компаний, holdings, brokerage accounts и всей OHLCV history. Три eligible listings на агента и ежемесячная частота сохранены.

## CROSS-VENUE ARBITRAGE OPTIMIZATION

Arbitrage работает только по предвычисленным cross-listed securities и venue pairs, получает consolidated best bid/ask из книг и использует фактически исполненный объём каждой ноги.

## FX TRIANGLE OPTIMIZATION

Валютные треугольники предвычисляются по активным счетам arbitrage owners и пересобираются только при изменении топологии. Все три реальные FX-ноги, fees и positive-net-edge gate сохранены.

## ETF OPTIMIZATION

ETF-контур использует bounded active baskets, актуальные venue quotes и общие indexed order books. Ежемесячный arbitrage и реальные creation/redemption legs не отключались.

## DERIVATIVES OPTIMIZATION

Option quotes, volatility/haircuts и cash-and-carry используют bounded recent OHLCV windows. Active contracts остаются детальными; завершённые контракты переходят в compact history с motive, PnL, default и rollover links.

## LEDGER INDEX OPTIMIZATION

Тяжёлый универсальный transaction index разделён: месячные и since-запросы строят лёгкий индекс только по времени. Account/entity maps больше не создаются для каждого monthly query. Ledger остаётся double-entry и authoritative.

## SOVEREIGN DEBT OPTIMIZATION

Добавлены отдельные индексы performing issues по стране/правительству и всех outstanding issues для реестра долга. Дефолтные непогашенные выпуски остаются в public debt; coupons обслуживают только активный work set. Long-run audit поймал и подтвердил исправление этого различия.

## BANKING OPTIMIZATION

ALM за один проход группирует active accounts, loans, funding, sovereign/corporate holdings и default counts по банкам. Deposit competition, capital, liquidity, maturity и currency mismatch semantics сохранены.

## COMPANY OPTIMIZATION

Peer prices, borrower debt, active CAPEX projects и macro states группируются один раз на company decision cycle. Решения компаний по-прежнему ежемесячные и используют закрытые snapshots.

## INSURANCE OPTIMIZATION

Runtime claim index хранит только unclaimed loss events и обновляется при появлении/закрытии claims. Исторические paid claims не сканируются каждый месяц; provenance и payout bounds сохранены.

## PE / M&A / IPO OPTIMIZATION

Active pipeline index содержит только незавершённые M&A и IPO. Closed/failed records не переоцениваются в будущих месяцах. PE sourcing остаётся квартальным/event-driven; SPV debt, waterfall, IRR/MOIC и ownership semantics сохранены.

## HISTORY COMPACTION

Реализованы HOT/WARM/ARCHIVED tiers. Рутинные события REAL_WORLD детальны четыре месяца; critical, major и player-linked events сохраняют identity. Старые orders/trades становятся monthly, затем annual aggregates; OHLCV старше двух лет становится annual bars; ledger, trade, auction, derivative и company history компактизируются с reconciliation metadata.

## SERIALIZATION OPTIMIZATION

Runner отдельно измеряет simulation и JSON serialization. Финальная median serialization: около 0,31 с для 20Y и 0,36 с для 50Y. Derived/stale quotes, rejected offers, old execution quality и завершённые routine requests не сохраняются бесконечно.

## WORKER OPTIMIZATION

Long-run UI execution остаётся в Simulation Worker. Progress messages ограничены максимум примерно 24 сообщениями, содержат только progress/month/короткую diagnostics; полный world отправляется только при completion. Добавлены измерения input clone enqueue и output message latency.

## UI CODE SPLITTING

Geoeconomics, Political Economy, Defense, Diagnostics и Economic Lab уже lazy-loaded. Advanced derivatives market вынесен в отдельный `AdvancedMarketsPanel` chunk 9,03 кБ. Main JS: 814,98 кБ.

## BENCHMARK RUNNER HARDENING

`benchmark-results.json` атомарно обновляется после каждого measured run. Поля: seed, mode, months, wall time, heap before/after, save bytes, trade/transaction/order counts, invariant failures, genesis after init, timestamp и commit/diff foundation. Для runs дольше двух минут обновляется `benchmark-progress.json`. Добавлены 1Y/5Y scenarios и hard gates.

## PERFORMANCE REGRESSION TESTS

Добавлены structural tests: полный developer timing tree; bounded maker active state; стабильное число FX triangles; sublinear compacted ledger record growth; matured sovereign issues вне active set; closed M&A/IPO вне active pipelines.

## FULL TEST RESULTS

- Основной regression: 92/92 PASS.
- PATCH 16.5–16.6 + performance: 104/104 PASS.
- Всего в двух независимых suite: 196 passed, 0 failed.
- Production build PASS.
- ESLint PASS.
- TypeScript PASS.
- `git diff --check` PASS.

## POST-INIT GENESIS COUNT

0 во всех официальных measured runs. Initialization GENESIS остаётся только внутри `createWorld`.

## ACCOUNTING INVARIANTS

PASS: double-entry, cash bridges, national accounting identities, debt bridges и covered-loss limits; 55/55 long-run checks.

## OWNERSHIP INVARIANTS

PASS: отрицательных holdings/stocks нет; cap table, shares outstanding, fund units и PE acquisition structure согласованы.

## BOP INVARIANTS

PASS: trade, FX, external claims и financial account reconciliation сходятся во всех long-run runs.

## MARKET ACTIVITY BEFORE / AFTER

Месячная ecology остаётся включённой 12/12 месяцев. 1Y trades: 1 579 → 1 589; orders: 3 266 → 3 271; transactions: 44 467 → 44 539. Схлопывания активности нет.

## TRANSACTION COUNT BEFORE / AFTER

1Y: 44 467 → 44 539 (+0,16%). Финальный 20Y: 1 034 768; 50Y: 2 563 332.

## ORDER COUNT BEFORE / AFTER

1Y: 3 266 → 3 271 (+0,15%). Финальный 20Y: 70 607; 50Y: 173 670.

## TRADE COUNT BEFORE / AFTER

1Y: 1 579 → 1 589 (+0,63%). Финальный 20Y: 39 832; 50Y: 98 479.

## 1Y BENCHMARK

### MIN

2 371 мс.

### MEDIAN

2 398 мс.

### MAX

2 682 мс.

## 5Y BENCHMARK

### MIN

10 465 мс.

### MEDIAN

12 009 мс.

### MAX

12 153 мс.

## 20Y BENCHMARK

### MIN

45 156 мс.

### MEDIAN

47 805 мс.

### MAX

52 920 мс.

## 20Y SPEEDUP

316 645 / 47 805 = **6,62×**. Median уменьшена на 84,9%.

## 50Y BENCHMARK

### MIN

124 166 мс.

### MEDIAN

133 271 мс.

### MAX

135 289 мс.

## 50Y SPEEDUP

1 130 199 / 133 271 = **8,48×**. Median уменьшена на 88,2%.

## CAPITAL MARKETS 10Y

### MIN

21 120 мс.

### MEDIAN

24 546 мс.

### MAX

24 651 мс.

## MARKET STRESS

### MIN

1 729 мс.

### MEDIAN

2 120 мс.

### MAX

2 351 мс. Redemption 1, liquidation orders 4, price 987 → minimum 946, margin calls 2, forced seller orders 2, ETF arbitrage events 2.

## FINAL CPU PROFILE

Отдельный profiler-on 20Y: 52 773 мс. Official timings выше сняты с profiler OFF.

## TOP REMAINING HOTSPOTS

Final 20Y total: history/ledger compaction 7 059 мс; monthly market ecology 6 087; global economy 5 940; commodity clearing 4 484; heterogeneous agents 3 339; `placeOrder` 3 022; trade settlement 2 974; macro 2 899; `compactTransactions` 2 812; sovereign debt 2 756.

Top self: `compactTransactions` 2 505 мс; accounting close 1 501; GC 1 316; `sumAccounts` 1 269; compaction orchestration 1 240; WHY market capture 843; government budgets 821; household market 730.

## 20Y STEADY HEAP

MIN / MEDIAN / MAX: 69 493 512 / 70 264 016 / 70 440 208 байт. Gate 120 МБ PASS.

## 50Y STEADY HEAP

MIN / MEDIAN / MAX: 81 855 024 / 82 145 832 / 82 541 904 байт. Gate 140 МБ PASS.

## 20Y SAVE SIZE

32 965 044 байта. Gate 33 000 000 PASS. Исходно 34 931 206.

## 50Y SAVE SIZE

43 117 263 байта. Gate 45 000 000 PASS. Исходно 46 267 470.

## MAIN JS SIZE

814,98 кБ minified (исходно 816,05 кБ). Дополнительный Advanced Markets chunk: 9,03 кБ.

## SIMULATION WORKER SIZE

416,25 кБ minified (исходно 408,71 кБ). Рост связан с runtime indexes и developer timing hooks; message volume и transfer behavior улучшены.

## BENCHMARK JSON ARTIFACT

`benchmark-results.json` — 20 752 байта, содержит все шесть официальных scenarios и полные measured runs. `benchmark-progress.json` сохраняет последний recoverable progress checkpoint.

## KNOWN LIMITATIONS

Main JS всё ещё превышает рекомендованные Vite 500 кБ. Worker chunk вырос на 7,54 кБ. Save 20Y имеет запас около 35 КБ к hard gate; изменение состава major events может потребовать повторной настройки tier policy.

## TECH DEBT

Следующий безопасный резерв производительности — incremental ledger compaction/account balances и дальнейшее разделение Markets/Companies/Portfolio UI. Это не требуется для текущего gate и не должно выполняться ценой изменения экономической семантики.

## PERFORMANCE GATE

Все 19 условий PASS: tests, integrity, GENESIS, accounting/BOP/ownership, monthly markets, stress chain, 20Y/50Y/capital timing, save, heap, activity, persistent artifacts, build, ESLint, TypeScript и diff check.

## ECONOMIC CORE v1.0 RELEASE READY?

**YES.**

## READY FOR PHASE 17?

**YES, но PHASE 17 в этой работе не начат.**
