import { useEffect, useMemo, useRef, useState } from "react";
import { formatSimulationDate } from "../core/clock.ts";
import { depositOf, entityBook } from "../core/ledger.ts";
import { createWorld } from "../economy/create-world.ts";
import { checkInvariants } from "../economy/invariants.ts";
import { latestMetrics } from "../economy/metrics.ts";
import { runMonths, stepMonth } from "../economy/simulation.ts";
import { bankCapitalRatioBps } from "../finance/credit.ts";
import type {
  DomainEvent,
  LedgerTransaction,
  MetricPoint,
  WorldState,
} from "../domain/model.ts";
import { SaveRepository, type SaveManifest } from "../persistence/save-repository.ts";

type View = "overview" | "economy" | "institutions" | "ledger" | "diagnostics";

const NAV_ITEMS: Array<{ id: View; label: string; short: string }> = [
  { id: "overview", label: "Пульт мира", short: "Мир" },
  { id: "economy", label: "Реальная экономика", short: "Рынки" },
  { id: "institutions", label: "Агенты и банки", short: "Агенты" },
  { id: "ledger", label: "Global Ledger", short: "Ledger" },
  { id: "diagnostics", label: "Диагностика", short: "Контроль" },
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

function KpiCard({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "positive" | "attention";
}) {
  return (
    <article className={`kpi-card kpi-${tone}`}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function SparkBars({
  points,
  value,
  label,
  color = "mint",
}: {
  points: MetricPoint[];
  value: (point: MetricPoint) => number;
  label: string;
  color?: "mint" | "cyan" | "amber";
}) {
  const values = points.slice(-30).map(value);
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  return (
    <div className={`spark-bars spark-${color}`} role="img" aria-label={label}>
      {values.map((item, index) => {
        const height = 12 + ((item - minimum) / Math.max(1, maximum - minimum)) * 88;
        return <i key={index} style={{ height: `${height}%` }} />;
      })}
    </div>
  );
}

function EventItem({ event }: { event: DomainEvent }) {
  return (
    <article className={`event-item severity-${event.severity}`}>
      <span className="event-dot" />
      <div>
        <div className="event-meta">
          <span>{event.type}</span>
          <span>M{event.elapsedMonth + 1}</span>
        </div>
        <strong>{event.title}</strong>
        <p>{event.detail}</p>
        {event.causeIds.length > 0 && <small>Причинных связей: {event.causeIds.length}</small>}
      </div>
    </article>
  );
}

function Overview({ world, metrics }: { world: WorldState; metrics: MetricPoint }) {
  const history = world.metricsHistory;
  const meaningfulEvents = world.events
    .filter((event) => event.type !== "MonthClosed" && event.type !== "EmployeeHired")
    .slice(-7)
    .reverse();
  const latest = meaningfulEvents.length ? meaningfulEvents : world.events.slice(-7).reverse();
  return (
    <>
      <section className="world-hero">
        <div>
          <span className="live-label"><i /> АВТОНОМНАЯ ЭКОНОМИКА</span>
          <h1>Мир живёт по своим балансам.</h1>
          <p>
            Ни одного сценарного кризиса: занятость, цены и кредит следуют из решений
            домохозяйств, фирм и банков.
          </p>
        </div>
        <div className="hero-ledger-seal">
          <span>LEDGER</span>
          <strong>{world.ledger.transactions.length.toLocaleString("ru-RU")}</strong>
          <small>проверяемых операций</small>
        </div>
      </section>

      <section className="kpi-grid">
        <KpiCard
          label="МЕСЯЧНЫЙ ВВП"
          value={compactMoney(metrics.nominalGdpCents)}
          note="из фактических конечных продаж"
          tone="positive"
        />
        <KpiCard
          label="ИНФЛЯЦИЯ Г/Г"
          value={percent(metrics.annualInflationBps)}
          note={`CPI ${number.format(metrics.cpiBps / 100)}`}
          tone={metrics.annualInflationBps > 550 ? "attention" : "neutral"}
        />
        <KpiCard
          label="БЕЗРАБОТИЦА"
          value={percent(metrics.unemploymentBps)}
          note={`${metrics.employedHouseholds} из ${world.households.length} заняты`}
          tone={metrics.unemploymentBps > 1500 ? "attention" : "neutral"}
        />
        <KpiCard
          label="ДЕПОЗИТНЫЕ ДЕНЬГИ"
          value={compactMoney(metrics.depositMoneyCents)}
          note={`кредиты ${compactMoney(metrics.loanStockCents)}`}
        />
      </section>

      <section className="two-column-grid">
        <article className="panel chart-panel">
          <header className="panel-header">
            <div><span className="eyebrow">ЭКОНОМИЧЕСКИЙ ПУЛЬС</span><h2>24 месяца наблюдений</h2></div>
            <span className="data-badge">LIVE DATA</span>
          </header>
          <div className="chart-row">
            <div className="chart-copy"><span>Выпуск и продажи</span><strong>{compactMoney(metrics.nominalGdpCents)}</strong></div>
            <SparkBars points={history} value={(point) => point.nominalGdpCents} label="Динамика ВВП" />
          </div>
          <div className="chart-row">
            <div className="chart-copy"><span>Занятость</span><strong>{percent(10_000 - metrics.unemploymentBps)}</strong></div>
            <SparkBars points={history} value={(point) => 10_000 - point.unemploymentBps} label="Динамика занятости" color="cyan" />
          </div>
          <div className="chart-row">
            <div className="chart-copy"><span>Кредитный портфель</span><strong>{compactMoney(metrics.loanStockCents)}</strong></div>
            <SparkBars points={history} value={(point) => point.loanStockCents} label="Динамика кредита" color="amber" />
          </div>
        </article>

        <article className="panel event-panel">
          <header className="panel-header">
            <div><span className="eyebrow">CAUSAL FEED</span><h2>События мира</h2></div>
            <span className="count-badge">{world.events.length}</span>
          </header>
          <div className="event-list">
            {latest.map((event) => <EventItem key={event.id} event={event} />)}
          </div>
        </article>
      </section>
    </>
  );
}

function Economy({ world, metrics }: { world: WorldState; metrics: MetricPoint }) {
  return (
    <>
      <section className="section-heading">
        <div><span className="eyebrow">РЕАЛЬНАЯ ЭКОНОМИКА</span><h1>Пять рынков, один производственный контур</h1></div>
        <p>Цена следует из предельных издержек, реализованного спроса и физического запаса.</p>
      </section>
      <section className="goods-grid">
        {world.goods.map((good) => {
          const producers = world.companies.filter((company) => company.active && company.goodId === good.id);
          const inventory = producers.reduce((sum, company) => sum + company.inventoryMilliUnits, 0);
          return (
            <article className="good-card" key={good.id}>
              <span className="good-index">{String(world.goods.indexOf(good) + 1).padStart(2, "0")}</span>
              <div><span className="eyebrow">{good.name}</span><strong>{formatMoney(metrics.priceByGoodCents[good.id] ?? good.basePriceCents)}</strong><small>за {good.unit}</small></div>
              <dl>
                <div><dt>Выпуск</dt><dd>{number.format((metrics.productionByGoodMilliUnits[good.id] ?? 0) / 1_000)}</dd></div>
                <div><dt>Продажи</dt><dd>{number.format((metrics.salesByGoodMilliUnits[good.id] ?? 0) / 1_000)}</dd></div>
                <div><dt>Запас</dt><dd>{number.format(inventory / 1_000)}</dd></div>
              </dl>
              <div className="recipe-line">{Object.keys(good.recipe).length ? `Факторы: ${Object.keys(good.recipe).map((id) => world.goods.find((item) => item.id === id)?.shortName).join(" + ")} + труд` : "Фактор: квалифицированный труд"}</div>
            </article>
          );
        })}
      </section>
      <article className="panel table-panel">
        <header className="panel-header"><div><span className="eyebrow">КОМПАНИИ</span><h2>Операционные книги</h2></div><span className="data-badge">{metrics.activeCompanies} ACTIVE</span></header>
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
                    <td><span className={`status-pill ${company.active ? company.distressMonths ? "status-warn" : "status-ok" : "status-off"}`}>{company.active ? company.distressMonths ? "давление" : "работает" : "закрыта"}</span></td>
                    <td>{company.employees.length}</td>
                    <td>{compactMoney(depositOf(world, company.id))}</td>
                    <td>{compactMoney(debt)}</td>
                    <td>{number.format(company.lastSalesMilliUnits / 1_000)}</td>
                    <td>{number.format(company.inventoryMilliUnits / 1_000)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}

function Institutions({ world, metrics }: { world: WorldState; metrics: MetricPoint }) {
  const governmentBook = entityBook(world, world.government.id);
  return (
    <>
      <section className="section-heading">
        <div><span className="eyebrow">ИНСТИТУТЫ</span><h1>Балансы, которые ограничивают решения</h1></div>
        <p>Банк не выдаёт кредит поверх капитального ограничения, а бюджет тратит только деньги со своего счёта.</p>
      </section>
      <section className="institution-grid">
        {world.banks.map((bank) => {
          const book = entityBook(world, bank.id);
          return (
            <article className="panel institution-card" key={bank.id}>
              <header><span className="institution-mark">Б</span><div><span className="eyebrow">КОММЕРЧЕСКИЙ БАНК</span><h2>{bank.name}</h2></div></header>
              <dl className="balance-list">
                <div><dt>Активы</dt><dd>{compactMoney(book.assets)}</dd></div>
                <div><dt>Обязательства</dt><dd>{compactMoney(book.liabilities)}</dd></div>
                <div><dt>Капитал</dt><dd>{compactMoney(book.capital)}</dd></div>
                <div><dt>Capital ratio</dt><dd>{percent(bankCapitalRatioBps(world, bank.id))}</dd></div>
              </dl>
              <div className="equation">АКТИВЫ = ОБЯЗАТЕЛЬСТВА + КАПИТАЛ <b>{book.assets === book.liabilities + book.capital ? "✓" : "!"}</b></div>
            </article>
          );
        })}
        <article className="panel institution-card">
          <header><span className="institution-mark">Ц</span><div><span className="eyebrow">ДЕНЕЖНАЯ ПОЛИТИКА</span><h2>{world.centralBank.name}</h2></div></header>
          <div className="policy-rate"><span>Ключевая ставка</span><strong>{percent(world.centralBank.policyRateBps)}</strong><small>цель по инфляции {percent(world.centralBank.inflationTargetBps)}</small></div>
          <p>Правило реагирует на фактический CPI и занятость раз в год. Прямого управления инфляцией нет.</p>
        </article>
        <article className="panel institution-card">
          <header><span className="institution-mark">Г</span><div><span className="eyebrow">ПУБЛИЧНЫЙ СЕКТОР</span><h2>Правительство</h2></div></header>
          <dl className="balance-list">
            <div><dt>Депозит бюджета</dt><dd>{compactMoney(depositOf(world, world.government.id))}</dd></div>
            <div><dt>Доходы ledger</dt><dd>{compactMoney(governmentBook.income)}</dd></div>
            <div><dt>Расходы ledger</dt><dd>{compactMoney(governmentBook.expenses)}</dd></div>
            <div><dt>НДФЛ / налог продаж</dt><dd>{percent(world.government.incomeTaxBps)} / {percent(world.government.salesTaxBps)}</dd></div>
          </dl>
        </article>
      </section>
      <article className="panel cohort-panel">
        <header className="panel-header"><div><span className="eyebrow">ДОМОХОЗЯЙСТВА</span><h2>Распределение состояния</h2></div><span className="data-badge">100 AGENTS</span></header>
        <div className="cohort-grid">
          {[0, 1, 2, 3].map((quartile) => {
            const sorted = [...world.households].sort((a, b) => depositOf(world, a.id) - depositOf(world, b.id));
            const group = sorted.slice(quartile * 25, quartile * 25 + 25);
            const average = group.reduce((sum, item) => sum + depositOf(world, item.id), 0) / group.length;
            const employed = group.filter((item) => item.employerId).length;
            return <div key={quartile}><span>Квартиль {quartile + 1}</span><strong>{compactMoney(average)}</strong><small>{employed}/25 заняты</small></div>;
          })}
        </div>
        <p className="cohort-note">Безработица {percent(metrics.unemploymentBps)} вычислена из реальных трудовых договоров, а не хранится отдельной переменной.</p>
      </article>
    </>
  );
}

function transactionAmount(transaction: LedgerTransaction): number {
  return transaction.entries
    .filter((entry) => entry.side === "debit")
    .reduce((sum, entry) => sum + entry.amountCents, 0);
}

function LedgerView({ world }: { world: WorldState }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = world.ledger.transactions
    .filter((transaction) => `${transaction.id} ${transaction.kind} ${transaction.memo}`.toLowerCase().includes(query.toLowerCase()))
    .slice(-100)
    .reverse();
  const selected = world.ledger.transactions.find((transaction) => transaction.id === selectedId) ?? filtered[0];
  return (
    <>
      <section className="section-heading ledger-heading">
        <div><span className="eyebrow">SOURCE OF TRUTH</span><h1>Global Ledger</h1></div>
        <div className="ledger-total"><span>Проводок</span><strong>{world.ledger.transactions.reduce((sum, transaction) => sum + transaction.entries.length, 0).toLocaleString("ru-RU")}</strong></div>
      </section>
      <div className="ledger-layout">
        <article className="panel transaction-list-panel">
          <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, тип или экономическая причина" /></label>
          <div className="transaction-list">
            {filtered.map((transaction) => (
              <button key={transaction.id} onClick={() => setSelectedId(transaction.id)} className={selected?.id === transaction.id ? "selected" : ""}>
                <span><b>{transaction.kind}</b><small>{transaction.id} · M{transaction.elapsedMonth + 1}</small></span>
                <strong>{compactMoney(transactionAmount(transaction))}</strong>
              </button>
            ))}
          </div>
        </article>
        <article className="panel transaction-detail">
          {selected ? (
            <>
              <header><span className="eyebrow">{selected.id}</span><h2>{selected.memo}</h2><p>Экономическая причина сохранена вместе с неизменяемым набором проводок.</p></header>
              <div className="entry-grid entry-head"><span>Счёт</span><span>Дебет</span><span>Кредит</span></div>
              {selected.entries.map((entry, index) => {
                const account = world.ledger.accounts[entry.accountId];
                return <div className="entry-grid" key={`${entry.accountId}-${index}`}><span><b>{account?.name}</b><small>{entry.accountId}</small></span><span>{entry.side === "debit" ? formatMoney(entry.amountCents) : "—"}</span><span>{entry.side === "credit" ? formatMoney(entry.amountCents) : "—"}</span></div>;
              })}
              <footer><span>Дебет = кредит</span><strong>{formatMoney(transactionAmount(selected))}</strong></footer>
            </>
          ) : <p>Операции пока не созданы.</p>}
        </article>
      </div>
    </>
  );
}

function Diagnostics({ world }: { world: WorldState }) {
  const invariants = useMemo(() => checkInvariants(world), [world]);
  const passed = invariants.filter((item) => item.ok).length;
  return (
    <>
      <section className="section-heading">
        <div><span className="eyebrow">SIMULATION CONTROL</span><h1>Экономика объясняет себя</h1></div>
        <div className={`diagnostic-score ${passed === invariants.length ? "all-pass" : "has-fail"}`}><strong>{passed}/{invariants.length}</strong><span>инвариантов</span></div>
      </section>
      <section className="diagnostic-grid">
        {invariants.map((item) => <article className={`invariant-card ${item.ok ? "pass" : "fail"}`} key={item.id}><span className="check-mark">{item.ok ? "✓" : "!"}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.id}</small></div></article>)}
      </section>
      <section className="two-column-grid diagnostic-notes">
        <article className="panel"><span className="eyebrow">SOURCE OF TRUTH</span><h2>Что нельзя менять напрямую</h2><ul><li>Деньги — только через Global Ledger.</li><li>Занятость — только через трудовой договор.</li><li>Товары — только через производство и Goods Movement Log.</li><li>Долг — согласованная пара «актив банка / обязательство заёмщика».</li></ul></article>
        <article className="panel"><span className="eyebrow">OBSERVABILITY</span><h2>Трассировка мира</h2><dl className="trace-stats"><div><dt>Domain events</dt><dd>{world.events.length.toLocaleString("ru-RU")}</dd></div><div><dt>Goods movements</dt><dd>{world.goodsMovements.length.toLocaleString("ru-RU")}</dd></div><div><dt>Ledger entries</dt><dd>{world.ledger.transactions.reduce((sum, transaction) => sum + transaction.entries.length, 0).toLocaleString("ru-RU")}</dd></div><div><dt>Active loans</dt><dd>{world.loans.filter((loan) => loan.status === "active").length}</dd></div></dl></article>
      </section>
    </>
  );
}

export function App() {
  const [world, setWorld] = useState<WorldState>(() => createWorld());
  const worldRef = useRef(world);
  const [view, setView] = useState<View>("overview");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("Мир готов к первому месяцу");
  const [saves, setSaves] = useState<SaveManifest[]>([]);
  const repository = useMemo(() => new SaveRepository(), []);
  const metrics = latestMetrics(world);
  const passing = useMemo(() => checkInvariants(world).every((item) => item.ok), [world]);

  const commit = (next: WorldState) => {
    worldRef.current = next;
    setWorld({ ...next });
  };

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

  const advance = async (months: number) => {
    if (busy) return;
    setBusy(true);
    setIsPlaying(false);
    setProgress(0);
    const next = worldRef.current;
    const chunk = months > 24 ? 6 : months;
    for (let completed = 0; completed < months; completed += chunk) {
      runMonths(next, Math.min(chunk, months - completed));
      setProgress(Math.min(100, Math.round(((completed + chunk) * 100) / months)));
      commit(next);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    setBusy(false);
    setProgress(100);
    setNotice(`${months} мес. просчитано · ${next.ledger.transactions.length.toLocaleString("ru-RU")} операций`);
    if (months >= 12) {
      repository.save(next, "Автосохранение", "autosave").then(() => repository.list().then(setSaves)).catch(() => undefined);
    }
  };

  const saveWorld = async () => {
    setNotice("Сохраняю сегменты истории…");
    const manifest = await repository.save(worldRef.current, "Ручное сохранение", "manual");
    setSaves(await repository.list());
    setNotice(`Сохранено: ${manifest.transactionCount.toLocaleString("ru-RU")} операций`);
  };

  const loadWorld = async () => {
    const target = saves[0];
    if (!target) {
      setNotice("Сохранений пока нет");
      return;
    }
    setBusy(true);
    try {
      const loaded = await repository.load(target.id);
      commit(loaded);
      setNotice(`Загружено «${target.label}»`);
    } finally {
      setBusy(false);
    }
  };

  const resetWorld = () => {
    if (!window.confirm("Создать новый мир? Текущее состояние останется только в сохранении.")) return;
    const next = createWorld();
    commit(next);
    setIsPlaying(false);
    setNotice("Создан новый детерминированный мир");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">EW</span><div><strong>ECONOMIC</strong><span>WORLD / α 0.1</span></div></div>
        <nav>{NAV_ITEMS.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span className="nav-mark">{item.label.slice(0, 1)}</span>{item.label}</button>)}</nav>
        <div className="sidebar-status"><span className="eyebrow">СТАТУС СИСТЕМЫ</span><div><i className={passing ? "ok" : "fail"} />{passing ? "Баланс соблюдён" : "Есть нарушение"}</div><small>{notice}</small></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="date-block"><span>СИМУЛЯЦИОННАЯ ДАТА</span><strong>{formatSimulationDate(world.clock)}</strong></div>
          <div className="sim-controls">
            <button className="icon-button" onClick={() => { stepMonth(worldRef.current); commit(worldRef.current); }} disabled={busy} aria-label="Один месяц">+1м</button>
            <button className={`play-button ${isPlaying ? "playing" : ""}`} onClick={() => setIsPlaying((value) => !value)} disabled={busy}>{isPlaying ? "Пауза" : "Запустить"}</button>
            <select aria-label="Скорость симуляции" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={1}>1 мес/с</option><option value={3}>3 мес/с</option><option value={12}>1 год/с</option></select>
          </div>
          <div className="save-controls"><button onClick={saveWorld} disabled={busy}>Сохранить</button><button onClick={loadWorld} disabled={busy || saves.length === 0}>Загрузить</button><button className="reset-button" onClick={resetWorld} disabled={busy}>Новый мир</button></div>
        </header>
        <div className="batchbar">
          <span>{busy ? `Расчёт… ${progress}%` : notice}</span>
          <div><button onClick={() => advance(12)} disabled={busy}>+ 1 год</button><button className="primary-batch" onClick={() => advance(240)} disabled={busy}>Автономные 20 лет</button></div>
          {busy && <i style={{ width: `${progress}%` }} />}
        </div>
        <main>
          {view === "overview" && <Overview world={world} metrics={metrics} />}
          {view === "economy" && <Economy world={world} metrics={metrics} />}
          {view === "institutions" && <Institutions world={world} metrics={metrics} />}
          {view === "ledger" && <LedgerView world={world} />}
          {view === "diagnostics" && <Diagnostics world={world} />}
        </main>
      </div>
      <nav className="mobile-nav">{NAV_ITEMS.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.label.slice(0, 1)}</span><small>{item.short}</small></button>)}</nav>
    </div>
  );
}
