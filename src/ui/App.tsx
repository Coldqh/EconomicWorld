import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSimulationDate } from "../core/clock.ts";
import { depositOf, entityBook } from "../core/ledger.ts";
import { createWorld } from "../economy/create-world.ts";
import { checkInvariants } from "../economy/invariants.ts";
import { latestMetrics } from "../economy/metrics.ts";
import { runMonths, stepMonth } from "../economy/simulation.ts";
import { bankCapitalRatioBps } from "../finance/credit.ts";
import type {
  DomainEvent,
  LedgerAccount,
  LedgerTransaction,
  MetricPoint,
  WorldState,
} from "../domain/model.ts";
import { SaveRepository, type SaveManifest } from "../persistence/save-repository.ts";
import { BootSequence } from "./BootSequence.tsx";
import {
  BalanceVisual,
  DeltaSparkline,
  DistributionPlot,
  LineAreaChart,
  MarketBars,
} from "./charts.tsx";
import {
  AnimatedChartContainer,
  AnimatedNumber,
  DataPulse,
  LiveIndicator,
  PageTransition,
  Reveal,
  SimulationTransition,
  Stagger,
} from "./motion.tsx";

type View = "overview" | "economy" | "institutions" | "ledger" | "diagnostics";
type Tone = "neutral" | "positive" | "attention" | "info";

const NAV_ITEMS: Array<{ id: View; label: string; short: string; mark: string }> = [
  { id: "overview", label: "Пульт мира", short: "Мир", mark: "01" },
  { id: "economy", label: "Реальная экономика", short: "Рынки", mark: "02" },
  { id: "institutions", label: "Агенты и банки", short: "Агенты", mark: "03" },
  { id: "ledger", label: "Global Ledger", short: "Ledger", mark: "04" },
  { id: "diagnostics", label: "Диагностика", short: "Контроль", mark: "05" },
];

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

function compactMoney(cents: number): string {
  const rubles = cents / 100;
  if (Math.abs(rubles) >= 1_000_000_000) return `${number.format(rubles / 1_000_000_000)} млрд ₽`;
  if (Math.abs(rubles) >= 1_000_000) return `${number.format(rubles / 1_000_000)} млн ₽`;
  if (Math.abs(rubles) >= 1_000) return `${number.format(rubles / 1_000)} тыс. ₽`;
  return formatMoney(cents);
}

function percent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function deltaPercent(current: number, previous: number): string {
  if (!previous) return "—";
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function monthLabel(point: MetricPoint): string {
  return `M${point.elapsedMonth + 1}`;
}

function Kpi({
  label,
  value,
  format,
  meta,
  tone = "neutral",
  history,
  why,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  meta: string;
  tone?: Tone;
  history: number[];
  why: string;
}) {
  return (
    <article className={`kpi kpi-${tone}`}>
      <header><span>{label}</span><WhyDisclosure text={why} /></header>
      <DataPulse value={value}><AnimatedNumber className="kpi-value" value={value} format={format} /></DataPulse>
      <footer><span>{meta}</span><DeltaSparkline values={history} accent={tone === "attention" ? "amber" : tone === "info" ? "cyan" : "mint"} ariaLabel={`Динамика: ${label}`} /></footer>
    </article>
  );
}

function WhyDisclosure({ text }: { text: string }) {
  return (
    <details className="why-disclosure">
      <summary>WHY?</summary>
      <div>{text}</div>
    </details>
  );
}

function EventItem({ event, world }: { event: DomainEvent; world: WorldState }) {
  const actors = event.actorIds.map((id) => entityLabel(world, id)).join(" · ");
  return (
    <details className={`event-item severity-${event.severity}`}>
      <summary>
        <span className="event-dot" />
        <span><b>{event.title}</b><small>{event.type} · M{event.elapsedMonth + 1}</small></span>
        <i>+</i>
      </summary>
      <div className="event-detail">
        <p>{event.detail}</p>
        {actors && <span>ENTITY · {actors}</span>}
        {event.causeIds.length > 0 && <span>CAUSE · {event.causeIds.join(", ")}</span>}
      </div>
    </details>
  );
}

function entityLabel(world: WorldState, id: string): string {
  return world.households.find((item) => item.id === id)?.displayName
    ?? world.companies.find((item) => item.id === id)?.name
    ?? world.banks.find((item) => item.id === id)?.name
    ?? (id === world.government.id ? "Правительство" : undefined)
    ?? (id === world.centralBank.id ? world.centralBank.name : undefined)
    ?? (id === "goods-market" ? "Товарный рынок" : id);
}

function Overview({ world, metrics, running }: { world: WorldState; metrics: MetricPoint; running: boolean }) {
  const history = world.metricsHistory.slice(-36);
  const previous = history.at(-2) ?? metrics;
  const events = world.events
    .filter((event) => event.type !== "MonthClosed" && event.type !== "EmployeeHired")
    .slice(-8)
    .reverse();
  const latestEvents = events.length ? events : world.events.slice(-8).reverse();

  return (
    <>
      <section className="world-status-bar">
        <div><LiveIndicator running={running} /><span>SEED {world.seed}</span></div>
        <div><span>{world.households.length} HOUSEHOLDS</span><span>{metrics.activeCompanies} FIRMS</span><span>{world.banks.length} BANKS</span><span>{world.ledger.transactions.length.toLocaleString("ru-RU")} TX</span></div>
      </section>

      <section className="kpi-grid">
        <Kpi label="GDP / MONTH" value={metrics.nominalGdpCents} format={compactMoney} meta={deltaPercent(metrics.nominalGdpCents, previous.nominalGdpCents)} tone="positive" history={history.map((item) => item.nominalGdpCents)} why="Сумма фактической выручки компаний за последний закрытый месяц." />
        <Kpi label="INFLATION / Y" value={metrics.annualInflationBps} format={percent} meta={`CPI ${number.format(metrics.cpiBps / 100)}`} tone={metrics.annualInflationBps > 550 ? "attention" : "neutral"} history={history.map((item) => item.annualInflationBps)} why="Изменение взвешенного индекса фактических цен к уровню 12 месяцев назад." />
        <Kpi label="UNEMPLOYMENT" value={metrics.unemploymentBps} format={percent} meta={`${metrics.employedHouseholds}/${world.households.length} employed`} tone={metrics.unemploymentBps > 1500 ? "attention" : "info"} history={history.map((item) => item.unemploymentBps)} why="Доля домохозяйств без действующей связи с работодателем." />
        <Kpi label="DEPOSIT MONEY" value={metrics.depositMoneyCents} format={compactMoney} meta={`LOANS ${compactMoney(metrics.loanStockCents)}`} history={history.map((item) => item.depositMoneyCents)} why="Сумма клиентских депозитных активов, зеркально отражённых в обязательствах банков." />
      </section>

      <section className="dashboard-grid">
        <Reveal>
          <article className="panel pulse-panel">
            <header className="panel-header">
              <div><span className="eyebrow">ECONOMIC PULSE</span><h1>GDP</h1></div>
              <div className="panel-metric"><span>LAST MONTH</span><strong>{compactMoney(metrics.nominalGdpCents)}</strong></div>
            </header>
            <AnimatedChartContainer>
              <LineAreaChart values={history.map((item) => item.nominalGdpCents)} labels={history.map(monthLabel)} format={compactMoney} ariaLabel="ВВП по месяцам" />
            </AnimatedChartContainer>
            <div className="signal-grid">
              <Signal label="EMPLOYMENT" value={percent(10_000 - metrics.unemploymentBps)} values={history.map((item) => 10_000 - item.unemploymentBps)} accent="cyan" />
              <Signal label="LOAN BOOK" value={compactMoney(metrics.loanStockCents)} values={history.map((item) => item.loanStockCents)} accent="amber" />
              <Signal label="MONEY" value={compactMoney(metrics.depositMoneyCents)} values={history.map((item) => item.depositMoneyCents)} accent="violet" />
            </div>
          </article>
        </Reveal>

        <Reveal delay={80}>
          <article className="panel causal-panel">
            <header className="panel-header"><div><span className="eyebrow">CAUSAL FEED</span><h2>EVENTS</h2></div><span className="count-badge">{world.events.length}</span></header>
            <div className="event-list">
              {latestEvents.map((event) => <EventItem key={event.id} event={event} world={world} />)}
            </div>
          </article>
        </Reveal>
      </section>
    </>
  );
}

function Signal({ label, value, values, accent }: { label: string; value: string; values: number[]; accent: "cyan" | "amber" | "violet" }) {
  return (
    <div className="signal">
      <span>{label}</span><strong>{value}</strong>
      <DeltaSparkline values={values} accent={accent} ariaLabel={`Динамика ${label}`} />
    </div>
  );
}

function Economy({ world, metrics }: { world: WorldState; metrics: MetricPoint }) {
  const history = world.metricsHistory.slice(-36);
  const production = Object.values(metrics.productionByGoodMilliUnits).reduce((sum, value) => sum + value, 0);
  const sales = Object.values(metrics.salesByGoodMilliUnits).reduce((sum, value) => sum + value, 0);
  const inventories = world.companies.reduce((sum, company) => sum + company.inventoryMilliUnits, 0);

  return (
    <>
      <SectionTitle index="02" title="REAL ECONOMY" stats={[`${world.goods.length} MARKETS`, `${metrics.activeCompanies} ACTIVE FIRMS`]} />
      <section className="economy-strip">
        <CompactMetric label="GDP" value={compactMoney(metrics.nominalGdpCents)} />
        <CompactMetric label="PRODUCTION" value={number.format(production / 1_000)} />
        <CompactMetric label="CONSUMPTION" value={number.format(sales / 1_000)} />
        <CompactMetric label="EMPLOYMENT" value={percent(10_000 - metrics.unemploymentBps)} />
        <CompactMetric label="INVENTORIES" value={number.format(inventories / 1_000)} />
        <CompactMetric label="PRICES / CPI" value={number.format(metrics.cpiBps / 100)} />
      </section>

      <section className="economy-charts">
        <article className="panel compact-chart">
          <header className="panel-header"><div><span className="eyebrow">OUTPUT</span><h2>GDP</h2></div><WhyDisclosure text="Фактические продажи компаний; наведите курсор для значения конкретного месяца." /></header>
          <LineAreaChart values={history.map((item) => item.nominalGdpCents)} labels={history.map(monthLabel)} format={compactMoney} ariaLabel="Выпуск экономики" />
        </article>
        <article className="panel compact-chart">
          <header className="panel-header"><div><span className="eyebrow">LABOR</span><h2>EMPLOYMENT</h2></div><WhyDisclosure text="Доля домохозяйств с действующим работодателем." /></header>
          <LineAreaChart values={history.map((item) => 10_000 - item.unemploymentBps)} labels={history.map(monthLabel)} format={percent} accent="cyan" ariaLabel="Занятость" />
        </article>
      </section>

      <section className="goods-grid">
        {world.goods.map((good, index) => {
          const producers = world.companies.filter((company) => company.active && company.goodId === good.id);
          const inventory = producers.reduce((sum, company) => sum + company.inventoryMilliUnits, 0);
          const output = metrics.productionByGoodMilliUnits[good.id] ?? 0;
          const sold = metrics.salesByGoodMilliUnits[good.id] ?? 0;
          return (
            <Stagger key={good.id} index={index}>
              <article className="good-card">
                <header><span>{String(index + 1).padStart(2, "0")}</span><b>{good.shortName}</b></header>
                <AnimatedNumber className="good-price" value={metrics.priceByGoodCents[good.id] ?? good.basePriceCents} format={formatMoney} />
                <MarketBars production={output} sales={sold} />
                <dl><div><dt>Production</dt><dd>{number.format(output / 1_000)}</dd></div><div><dt>Sales</dt><dd>{number.format(sold / 1_000)}</dd></div><div><dt>Inventory</dt><dd>{number.format(inventory / 1_000)}</dd></div></dl>
                <WhyDisclosure text={Object.keys(good.recipe).length ? `Inputs: ${Object.keys(good.recipe).map((id) => world.goods.find((item) => item.id === id)?.shortName).join(" + ")} + labor.` : "Input: skilled labor."} />
              </article>
            </Stagger>
          );
        })}
      </section>

      <CompanyTable world={world} metrics={metrics} />
    </>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function SectionTitle({ index, title, stats }: { index: string; title: string; stats: string[] }) {
  return (
    <section className="section-title">
      <div><span>{index}</span><h1>{title}</h1></div>
      <div>{stats.map((stat) => <span key={stat}>{stat}</span>)}</div>
    </section>
  );
}

function CompanyTable({ world, metrics }: { world: WorldState; metrics: MetricPoint }) {
  return (
    <article className="panel table-panel">
      <header className="panel-header"><div><span className="eyebrow">FIRMS</span><h2>OPERATIONS</h2></div><span className="data-badge">{metrics.activeCompanies} ACTIVE</span></header>
      <div className="responsive-table">
        <table>
          <thead><tr><th>Компания</th><th>Рынок</th><th>Статус</th><th>Штат</th><th>Депозит</th><th>Долг</th><th>Продажи</th><th>Запас</th></tr></thead>
          <tbody>
            {world.companies.map((company) => {
              const debt = world.loans.filter((loan) => loan.borrowerId === company.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
              return (
                <tr key={company.id} className={!company.active ? "row-muted" : undefined}>
                  <td><strong>{company.name}</strong><small>{company.id}</small></td>
                  <td>{world.goods.find((good) => good.id === company.goodId)?.shortName}</td>
                  <td><span className={`status-pill ${company.active ? company.distressMonths ? "status-warn" : "status-ok" : "status-off"}`}>{company.active ? company.distressMonths ? "PRESSURE" : "ACTIVE" : "CLOSED"}</span></td>
                  <td>{company.employees.length}</td><td>{compactMoney(depositOf(world, company.id))}</td><td>{compactMoney(debt)}</td><td>{number.format(company.lastSalesMilliUnits / 1_000)}</td><td>{number.format(company.inventoryMilliUnits / 1_000)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function accountTotal(world: WorldState, ownerId: string, predicate: (account: LedgerAccount) => boolean): number {
  return Object.values(world.ledger.accounts).filter((account) => account.ownerId === ownerId && predicate(account)).reduce((sum, account) => sum + (world.ledger.balances[account.id] ?? 0), 0);
}

function Institutions({ world, metrics }: { world: WorldState; metrics: MetricPoint }) {
  const [selectedBankId, setSelectedBankId] = useState(world.banks[0]?.id ?? "");
  const governmentBook = entityBook(world, world.government.id);
  const selectedLoans = world.loans.filter((loan) => loan.lenderBankId === selectedBankId && loan.status === "active");
  const deposits = world.households.map((household) => depositOf(world, household.id));

  return (
    <>
      <SectionTitle index="03" title="BANKS / AGENTS" stats={[`${world.banks.length} BANKS`, `${world.loans.filter((loan) => loan.status === "active").length} ACTIVE LOANS`]} />
      <section className="institution-grid">
        {world.banks.map((bank) => {
          const book = entityBook(world, bank.id);
          const liquidity = accountTotal(world, bank.id, (account) => account.category === "asset" && account.instrument === "reserve");
          const depositsTotal = accountTotal(world, bank.id, (account) => account.category === "liability" && account.instrument === "deposit");
          const loanBook = world.loans.filter((loan) => loan.lenderBankId === bank.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
          return (
            <article className={`panel institution-card ${selectedBankId === bank.id ? "selected" : ""}`} key={bank.id} onClick={() => setSelectedBankId(bank.id)}>
              <header><div><span className="eyebrow">BANK · {bank.id}</span><h2>{bank.name}</h2></div><span className={bankCapitalRatioBps(world, bank.id) >= bank.minimumCapitalRatioBps ? "health-ok" : "health-risk"}>{percent(bankCapitalRatioBps(world, bank.id))}</span></header>
              <BalanceVisual assets={book.assets} liabilities={book.liabilities} capital={book.capital} />
              <dl className="balance-list"><div><dt>Assets</dt><dd>{compactMoney(book.assets)}</dd></div><div><dt>Liabilities</dt><dd>{compactMoney(book.liabilities)}</dd></div><div><dt>Equity</dt><dd>{compactMoney(book.capital)}</dd></div><div><dt>Liquidity</dt><dd>{compactMoney(liquidity)}</dd></div><div><dt>Loan Book</dt><dd>{compactMoney(loanBook)}</dd></div><div><dt>Deposits</dt><dd>{compactMoney(depositsTotal)}</dd></div></dl>
              <WhyDisclosure text={`Minimum capital ratio ${percent(bank.minimumCapitalRatioBps)}. Assets = liabilities + capital: ${book.assets === book.liabilities + book.capital ? "verified" : "violation"}.`} />
            </article>
          );
        })}
      </section>

      <section className="institution-secondary">
        <article className="panel policy-card">
          <header className="panel-header"><div><span className="eyebrow">CENTRAL BANK</span><h2>{world.centralBank.name}</h2></div><WhyDisclosure text="Ставка пересматривается раз в год по фактической инфляции и занятости." /></header>
          <div className="policy-numbers"><CompactMetric label="POLICY RATE" value={percent(world.centralBank.policyRateBps)} /><CompactMetric label="INFLATION TARGET" value={percent(world.centralBank.inflationTargetBps)} /><CompactMetric label="CPI" value={number.format(metrics.cpiBps / 100)} /></div>
        </article>
        <article className="panel government-card">
          <header className="panel-header"><div><span className="eyebrow">GOVERNMENT</span><h2>FISCAL ACCOUNT</h2></div></header>
          <dl className="balance-list"><div><dt>Cash</dt><dd>{compactMoney(depositOf(world, world.government.id))}</dd></div><div><dt>Revenue</dt><dd>{compactMoney(governmentBook.income)}</dd></div><div><dt>Spending</dt><dd>{compactMoney(governmentBook.expenses)}</dd></div><div><dt>Balance</dt><dd>{compactMoney(governmentBook.income - governmentBook.expenses)}</dd></div></dl>
        </article>
      </section>

      <section className="agent-grid">
        <article className="panel distribution-card">
          <header className="panel-header"><div><span className="eyebrow">HOUSEHOLDS</span><h2>DEPOSIT DISTRIBUTION</h2></div><span className="data-badge">{world.households.length} AGENTS</span></header>
          <DistributionPlot values={deposits} />
          <div className="quartile-grid">{[0, 1, 2, 3].map((quartile) => {
            const sorted = [...deposits].sort((a, b) => a - b);
            const size = Math.ceil(sorted.length / 4);
            const group = sorted.slice(quartile * size, (quartile + 1) * size);
            const average = group.reduce((sum, value) => sum + value, 0) / Math.max(1, group.length);
            return <CompactMetric key={quartile} label={`Q${quartile + 1} AVG`} value={compactMoney(average)} />;
          })}</div>
        </article>
        <article className="panel loan-card">
          <header className="panel-header"><div><span className="eyebrow">{entityLabel(world, selectedBankId)}</span><h2>LOAN BOOK</h2></div><span className="count-badge">{selectedLoans.length}</span></header>
          <div className="loan-list">{selectedLoans.slice(0, 8).map((loan) => <div key={loan.id}><span><b>{entityLabel(world, loan.borrowerId)}</b><small>{loan.id} · {loan.remainingMonths}M</small></span><strong>{compactMoney(loan.remainingPrincipalCents)}</strong><i>{percent(loan.annualRateBps)}</i></div>)}{selectedLoans.length === 0 && <p className="empty-state">Нет активных кредитов.</p>}</div>
        </article>
      </section>
    </>
  );
}

function transactionAmount(transaction: LedgerTransaction): number {
  return Math.max(0, ...transaction.entries.map((entry) => entry.amountCents));
}

function transactionRoute(world: WorldState, transaction: LedgerTransaction): { source: string; destination: string } {
  const depositEntries = transaction.entries.map((entry) => ({ entry, account: world.ledger.accounts[entry.accountId] })).filter(({ account }) => account?.category === "asset" && account.instrument === "deposit");
  const source = depositEntries.find(({ entry }) => entry.side === "credit")?.account.ownerId;
  const destination = depositEntries.find(({ entry }) => entry.side === "debit")?.account.ownerId;
  if (source || destination) return { source: entityLabel(world, source ?? transaction.kind), destination: entityLabel(world, destination ?? transaction.kind) };
  const debit = world.ledger.accounts[transaction.entries.find((entry) => entry.side === "debit")?.accountId ?? ""];
  const credit = world.ledger.accounts[transaction.entries.find((entry) => entry.side === "credit")?.accountId ?? ""];
  return { source: entityLabel(world, credit?.ownerId ?? transaction.kind), destination: entityLabel(world, debit?.ownerId ?? transaction.kind) };
}

function TraceFlow({ world, transaction }: { world: WorldState; transaction: LedgerTransaction }) {
  const route = transactionRoute(world, transaction);
  return (
    <div className="trace-flow">
      <div><span>SOURCE</span><strong>{route.source}</strong></div>
      <div className="trace-transfer"><i /><span>{compactMoney(transactionAmount(transaction))}</span><i /></div>
      <div><span>DESTINATION</span><strong>{route.destination}</strong></div>
    </div>
  );
}

function LedgerView({ world }: { world: WorldState }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = world.ledger.transactions.filter((transaction) => `${transaction.id} ${transaction.kind} ${transaction.memo}`.toLowerCase().includes(query.toLowerCase())).slice(-120).reverse();
  const selected = world.ledger.transactions.find((transaction) => transaction.id === selectedId) ?? filtered[0];
  const entryCount = world.ledger.transactions.reduce((sum, transaction) => sum + transaction.entries.length, 0);
  return (
    <>
      <SectionTitle index="04" title="GLOBAL LEDGER" stats={[`${world.ledger.transactions.length.toLocaleString("ru-RU")} TRANSACTIONS`, `${entryCount.toLocaleString("ru-RU")} ENTRIES`]} />
      <div className="ledger-layout">
        <article className="panel transaction-list-panel">
          <label className="search-field"><span>FILTER</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID / TYPE / CAUSE" /></label>
          <div className="transaction-list">{filtered.map((transaction) => {
            const route = transactionRoute(world, transaction);
            return <button key={transaction.id} onClick={() => setSelectedId(transaction.id)} className={selected?.id === transaction.id ? "selected" : ""}><span><b>{transaction.kind}</b><small>{route.source} → {route.destination}</small><small>{transaction.id} · M{transaction.elapsedMonth + 1}</small></span><strong>{compactMoney(transactionAmount(transaction))}</strong></button>;
          })}{filtered.length === 0 && <p className="empty-state">Совпадений нет.</p>}</div>
        </article>
        <article className="panel transaction-detail">
          {selected ? <>
            <header><div><span className="eyebrow">{selected.id} · M{selected.elapsedMonth + 1}</span><h2>{selected.kind}</h2></div><strong>{formatMoney(transactionAmount(selected))}</strong></header>
            <TraceFlow world={world} transaction={selected} />
            <WhyDisclosure text={selected.memo} />
            <div className="entry-grid entry-head"><span>ACCOUNT</span><span>DEBIT</span><span>CREDIT</span></div>
            {selected.entries.map((entry, index) => {
              const account = world.ledger.accounts[entry.accountId];
              return <div className="entry-grid" key={`${entry.accountId}-${index}`}><span><b>{account?.name}</b><small>{entityLabel(world, account?.ownerId ?? "")} · {entry.accountId}</small></span><span>{entry.side === "debit" ? formatMoney(entry.amountCents) : "—"}</span><span>{entry.side === "credit" ? formatMoney(entry.amountCents) : "—"}</span></div>;
            })}
            <footer><span>BALANCED</span><strong>{formatMoney(transactionAmount(selected))}</strong></footer>
          </> : <p className="empty-state">Операции появятся после первого месяца.</p>}
        </article>
      </div>
    </>
  );
}

function Diagnostics({ world }: { world: WorldState }) {
  const invariants = useMemo(() => checkInvariants(world), [world]);
  const passed = invariants.filter((item) => item.ok).length;
  const entryCount = world.ledger.transactions.reduce((sum, transaction) => sum + transaction.entries.length, 0);
  return (
    <>
      <SectionTitle index="05" title="CONTROL" stats={[`${passed}/${invariants.length} PASS`, `${world.clock.elapsedMonths} MONTHS`]} />
      <section className="control-strip"><CompactMetric label="DOMAIN EVENTS" value={world.events.length.toLocaleString("ru-RU")} /><CompactMetric label="GOODS MOVEMENTS" value={world.goodsMovements.length.toLocaleString("ru-RU")} /><CompactMetric label="LEDGER ENTRIES" value={entryCount.toLocaleString("ru-RU")} /><CompactMetric label="ACTIVE LOANS" value={world.loans.filter((loan) => loan.status === "active").length.toLocaleString("ru-RU")} /></section>
      <section className="diagnostic-grid">{invariants.map((item, index) => <Stagger key={item.id} index={index}><article className={`invariant-card ${item.ok ? "pass" : "fail"}`}><span className="check-mark">{item.ok ? "PASS" : "FAIL"}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.id}</small></div></article></Stagger>)}</section>
    </>
  );
}

function initialBootVisibility(): boolean {
  try {
    return sessionStorage.getItem("economic-world-booted") !== "1";
  } catch {
    return true;
  }
}

export function App() {
  const [world, setWorld] = useState<WorldState>(() => createWorld());
  const worldRef = useRef(world);
  const [view, setView] = useState<View>("overview");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("READY");
  const [saves, setSaves] = useState<SaveManifest[]>([]);
  const [showBoot, setShowBoot] = useState(initialBootVisibility);
  const [starting, setStarting] = useState(false);
  const repository = useMemo(() => new SaveRepository(), []);
  const metrics = latestMetrics(world);
  const passing = useMemo(() => checkInvariants(world).every((item) => item.ok), [world]);

  const commit = (next: WorldState) => {
    worldRef.current = next;
    setWorld({ ...next });
  };

  const completeBoot = useCallback(() => {
    try { sessionStorage.setItem("economic-world-booted", "1"); } catch { /* session storage may be unavailable */ }
    setShowBoot(false);
  }, []);

  useEffect(() => {
    repository.list().then(setSaves).catch(() => setSaves([]));
  }, [repository]);

  useEffect(() => {
    if (!isPlaying || busy) return;
    const timer = window.setInterval(() => {
      const next = worldRef.current;
      runMonths(next, speed);
      commit(next);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, busy]);

  const toggleSimulation = () => {
    if (!isPlaying) {
      setStarting(true);
      window.setTimeout(() => setStarting(false), 820);
    }
    setIsPlaying((value) => !value);
  };

  const advance = async (months: number) => {
    if (busy) return;
    setBusy(true);
    setIsPlaying(false);
    setProgress(0);
    const next = worldRef.current;
    const chunk = months > 24 ? 6 : months;
    for (let completed = 0; completed < months; completed += chunk) {
      const amount = Math.min(chunk, months - completed);
      runMonths(next, amount);
      setProgress(Math.min(100, Math.round(((completed + amount) * 100) / months)));
      commit(next);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    setBusy(false);
    setProgress(100);
    setNotice(`${months}M · ${next.ledger.transactions.length.toLocaleString("ru-RU")} TX`);
    if (months >= 12) repository.save(next, "Автосохранение", "autosave").then(() => repository.list().then(setSaves)).catch(() => undefined);
  };

  const saveWorld = async () => {
    if (busy) return;
    setBusy(true);
    setNotice("SAVING");
    try {
      const manifest = await repository.save(worldRef.current, "Ручное сохранение", "manual");
      setSaves(await repository.list());
      setNotice(`SAVED · ${manifest.transactionCount.toLocaleString("ru-RU")} TX`);
    } finally {
      setBusy(false);
    }
  };

  const loadWorld = async () => {
    const target = saves[0];
    if (!target) { setNotice("NO SAVES"); return; }
    setNotice("LOADING");
    setBusy(true);
    try { const loaded = await repository.load(target.id); commit(loaded); setNotice(`LOADED · ${target.label}`); }
    finally { setBusy(false); }
  };

  const resetWorld = () => {
    if (!window.confirm("Создать новый мир? Несохранённое состояние будет потеряно.")) return;
    const next = createWorld();
    commit(next);
    setIsPlaying(false);
    setNotice("NEW WORLD · READY");
  };

  return (
    <>
      {showBoot && <BootSequence onComplete={completeBoot} />}
      <div className={`app-shell ${starting ? "is-starting" : ""}`}>
        <SimulationTransition active={starting} />
        <aside className="sidebar">
          <div className="brand"><span className="brand-mark">EW</span><div><strong>ECONOMIC WORLD</strong><span>WORLD ENGINE · α 0.1</span></div></div>
          <nav>{NAV_ITEMS.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span className="nav-mark">{item.mark}</span>{item.label}</button>)}</nav>
          <div className="sidebar-status"><span>SYSTEM</span><div><i className={passing ? "ok" : "fail"} />{passing ? "BALANCED" : "VIOLATION"}</div><small>{notice}</small></div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="date-block"><span>SIMULATION DATE</span><DataPulse value={world.clock.elapsedMonths}><strong key={world.clock.elapsedMonths}>{formatSimulationDate(world.clock)}</strong></DataPulse></div>
            <div className="sim-controls">
              <button onClick={() => { stepMonth(worldRef.current); commit(worldRef.current); setNotice("+1M"); }} disabled={busy} aria-label="Один месяц">+1M</button>
              <button className={`play-button ${isPlaying ? "playing" : ""}`} onClick={toggleSimulation} disabled={busy}>{isPlaying ? "PAUSE" : "START"}</button>
              <select aria-label="Скорость симуляции" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={1}>1M / SEC</option><option value={3}>3M / SEC</option><option value={12}>1Y / SEC</option></select>
            </div>
            <div className="save-controls"><button onClick={saveWorld} disabled={busy}>SAVE</button><button onClick={loadWorld} disabled={busy || saves.length === 0}>LOAD</button><button className="reset-button" onClick={resetWorld} disabled={busy}>NEW WORLD</button></div>
          </header>
          <div className="batchbar"><span>{busy ? notice === "SAVING" || notice === "LOADING" ? notice : `CALCULATING · ${progress}%` : notice}</span><div><button onClick={() => advance(12)} disabled={busy}>+1 YEAR</button><button className="primary-batch" onClick={() => advance(240)} disabled={busy}>RUN 20 YEARS</button></div>{busy && notice !== "SAVING" && notice !== "LOADING" && <i style={{ width: `${progress}%` }} />}</div>
          <main><PageTransition key={view}>{view === "overview" && <Overview world={world} metrics={metrics} running={isPlaying} />}{view === "economy" && <Economy world={world} metrics={metrics} />}{view === "institutions" && <Institutions world={world} metrics={metrics} />}{view === "ledger" && <LedgerView world={world} />}{view === "diagnostics" && <Diagnostics world={world} />}</PageTransition></main>
        </div>
        <nav className="mobile-nav">{NAV_ITEMS.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.mark}</span><small>{item.short}</small></button>)}</nav>
      </div>
    </>
  );
}
