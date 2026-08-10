import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSimulationDate } from "../core/clock.ts";
import { accountIds, balanceOf, depositOf, entityBook } from "../core/ledger.ts";
import { createWorld } from "../economy/create-world.ts";
import { checkInvariants } from "../economy/invariants.ts";
import { latestMetrics } from "../economy/metrics.ts";
import { runMonths, stepMonth } from "../economy/simulation.ts";
import { bankCapitalRatioBps } from "../finance/credit.ts";
import { bankLiquidityRatioBps } from "../finance/liquidity.ts";
import type { LedgerTransaction, MetricPoint, TransactionKind, WorldState } from "../domain/model.ts";
import { SaveRepository, type PersistenceDiagnostics, type SaveManifest } from "../persistence/save-repository.ts";
import { acceptJobOffer, applyForJob, availableOccupations, resignPlayerJob, setPlayerProfile, setPlayerSavingsTarget } from "../player/commands.ts";
import { playerFinancialSummary, playerHousehold, playerPerson, SKILL_LABELS, tracePlayerMoney } from "../player/system.ts";
import { applyUniversity, buyDurable, buyProperty, enrollUniversity, rentProperty, sellDurable, startTravel, travelOptions } from "../player/world-commands.ts";
import { BootSequence } from "./BootSequence.tsx";
import { LineAreaChart, MarketBars, MiniTrendChart } from "./charts.tsx";
import { companyValuation, declareDividend, issueBond, ownershipBps, raiseEquity, startIpo } from "../corporate/finance.ts";
import { openBrokerageAccount, placeOrder, portfolioSummary } from "../markets/exchange.ts";
import { APP_BUILD, applyAppUpdate, checkForUpdate, registerAppServiceWorker, serviceWorkerDiagnostics, type UpdateState } from "../pwa/update-manager.ts";

type View = "life" | "world" | "career" | "education" | "finances" | "economy" | "companies" | "markets" | "portfolio" | "banks" | "ledger" | "control" | "settings";

const NAV: Array<{ id: View; label: string; short: string }> = [
  { id: "life", label: "Моя жизнь", short: "Жизнь" },
  { id: "world", label: "Мир", short: "Мир" },
  { id: "career", label: "Карьера", short: "Карьера" },
  { id: "education", label: "Институты", short: "Вузы" },
  { id: "finances", label: "Мои финансы", short: "Финансы" },
  { id: "economy", label: "Экономика", short: "Экономика" },
  { id: "companies", label: "Компании", short: "Компании" },
  { id: "markets", label: "Рынки", short: "Рынки" },
  { id: "portfolio", label: "Портфель", short: "Портфель" },
  { id: "banks", label: "Банки", short: "Банки" },
  { id: "ledger", label: "Общий реестр", short: "Реестр" },
  { id: "control", label: "Контроль", short: "Контроль" },
  { id: "settings", label: "Настройки", short: "Настройки" },
];

const MOBILE_PRIMARY: Array<{ id: View; label: string }> = [
  { id: "life", label: "Главная" },
  { id: "economy", label: "Экономика" },
  { id: "markets", label: "Рынки" },
  { id: "career", label: "Карьера" },
];
const MOBILE_MORE = NAV.filter((item) => !MOBILE_PRIMARY.some((primary) => primary.id === item.id));

const TX_LABELS: Record<TransactionKind, string> = {
  GENESIS: "Начальный баланс", TRANSFER: "Перевод", WAGE: "Зарплата", INCOME_TAX: "Налог на доход", SALES_TAX: "Налог с продаж", CORPORATE_TAX: "Налог на прибыль", SOCIAL_TRANSFER: "Социальная выплата", GOODS_CLEARING: "Покупка товара", INPUT_PURCHASE: "Закупка сырья", CAPITAL_CONTRIBUTION: "Вклад в капитал", LOAN_ISSUED: "Выдача кредита", LOAN_INTEREST: "Проценты по кредиту", LOAN_PRINCIPAL: "Погашение кредита", LOAN_DEFAULT: "Дефолт", INVENTORY_SEED: "Начальные запасы", INVENTORY_TRANSFER: "Передача запасов", COGS: "Себестоимость продаж", PRODUCTION: "Производство", DEPRECIATION: "Амортизация", CAPITAL_INVESTMENT: "Капитальные вложения", ACCOUNTING_CLOSE: "Закрытие периода", INTERBANK_LOAN: "Межбанковский кредит", CENTRAL_BANK_FACILITY: "Кредит центрального банка", EDUCATION: "Краткий курс", UNIVERSITY_TUITION: "Оплата вуза", COHORT_INCOME: "Доход когорты", COHORT_CONSUMPTION: "Потребление когорты", MATERIALIZATION: "Материализация", DEMATERIALIZATION: "Дематериализация", TRAVEL: "Поездка", RENT: "Аренда", PROPERTY_PURCHASE: "Покупка жилья", DURABLE_PURCHASE: "Покупка актива", USED_ASSET: "Подержанный актив", LOGISTICS: "Логистика",
  EQUITY_ISSUE: "Выпуск акций", EQUITY_SECONDARY: "Сделка с акциями", DIVIDEND: "Дивиденд", BOND_ISSUE: "Выпуск облигаций", BOND_COUPON: "Купон", BOND_REPAYMENT: "Погашение облигации", ACQUISITION: "Поглощение", IPO: "IPO", BROKER_DEPOSIT: "Брокерский счёт", MARKET_TRADE: "Биржевая сделка", BROKER_FEE: "Комиссия брокера", EXCHANGE_FEE: "Комиссия биржи", BANKRUPTCY_DISTRIBUTION: "Распределение при банкротстве", SECURITY_REVALUATION: "Переоценка ценной бумаги",
};

const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const money = (cents: number) => rubles.format(cents / 100);
const currencyMoney = (cents: number, currency: string) => new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
const compactMoney = (cents: number) => {
  const value = cents / 100;
  if (Math.abs(value) >= 1_000_000_000) return `${number.format(value / 1_000_000_000)} млрд ₽`;
  if (Math.abs(value) >= 1_000_000) return `${number.format(value / 1_000_000)} млн ₽`;
  if (Math.abs(value) >= 1_000) return `${number.format(value / 1_000)} тыс. ₽`;
  return money(cents);
};
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const monthLabel = (point: MetricPoint) => `${point.elapsedMonth + 1}м`;
const EDUCATION_LABELS: Record<string, string> = { basic: "основное", secondary: "среднее", bachelor: "бакалавриат", master: "магистратура", doctorate: "докторантура" };

function entityLabel(world: WorldState, id: string): string {
  const sectorCityId = id.includes(":") ? id.split(":").at(-1) : undefined;
  const sectorCity = sectorCityId && world.cities.find((city) => city.id === sectorCityId);
  return world.people.find((item) => item.id === id)?.displayName
    ?? world.households.find((item) => item.id === id)?.displayName
    ?? world.companies.find((item) => item.id === id)?.name
    ?? world.universities.find((item) => item.id === id)?.shortName
    ?? world.populationCohorts.find((item) => item.id === id)?.id.replace("population-", "Когорта населения · ")
    ?? world.firmCohorts.find((item) => item.id === id)?.id.replace("firms-", "Когорта фирм · ")
    ?? (id.startsWith("housing-sector:") && sectorCity ? `Жилищный рынок · ${sectorCity.name}` : undefined)
    ?? (id.startsWith("transport-sector:") && sectorCity ? `Транспорт · ${sectorCity.name}` : undefined)
    ?? world.banks.find((item) => item.id === id)?.name
    ?? world.governments.find((item) => item.id === id)?.id.replace("government-", "Правительство · ")
    ?? world.centralBanks.find((item) => item.id === id)?.name
    ?? (id === "academy-provider" ? "Дополнительное обучение" : id);
}

function Section({ title, meta }: { title: string; meta?: string }) {
  return <header className="section-heading"><h1>{title}</h1>{meta && <span>{meta}</span>}</header>;
}

function WhyButton({ title, text, open }: { title: string; text: string; open: (title: string, text: string) => void }) {
  return <button className="why-button" type="button" onClick={() => open(title, text)}>Почему?</button>;
}

function WhyModal({ value, close }: { value: { title: string; text: string } | null; close: () => void }) {
  useEffect(() => {
    if (!value) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [value, close]);
  if (!value) return null;
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="why-modal" role="dialog" aria-modal="true" aria-labelledby="why-title"><header><h2 id="why-title">{value.title}</h2><button onClick={close} aria-label="Закрыть">×</button></header><p>{value.text}</p><button className="primary" onClick={close}>Понятно</button></section></div>;
}

function Kpi({ label, value, note, values, why, open }: { label: string; value: string; note?: string; values?: number[]; why?: string; open: (title: string, text: string) => void }) {
  return <article className="kpi"><header><span>{label}</span>{why && <WhyButton title={label} text={why} open={open} />}</header><strong>{value}</strong><footer><small>{note ?? ""}</small>{values && <MiniTrendChart values={values} format={compactMoney} accent="mint" ariaLabel={`Динамика: ${label}`} />}</footer></article>;
}

function MyLife({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const summary = playerFinancialSummary(world);
  const person = playerPerson(world);
  const household = playerHousehold(world);
  const company = world.companies.find((item) => item.id === household.employerId);
  const occupation = world.occupations.find((item) => item.id === person.occupationId);
  const city = world.cities.find((item) => item.id === world.player.currentCityId);
  const enrollment = world.player.activeUniversityEnrollment;
  const program = enrollment && world.universityPrograms.find((item) => item.id === enrollment.programId);
  const history = world.player.monthlyHistory.slice(-24);
  return <>
    <Section title="Моя жизнь" meta={`${summary.age} лет · ${formatSimulationDate(world.clock)}`} />
    <section className="hero-state"><div><span>{city?.name ?? "В пути"}</span><h2>{occupation?.name ?? (program ? "Студент" : "Ищу работу")}</h2><p>{company?.name ?? program?.name ?? "Нет работодателя"}</p></div><div className="hero-balance"><span>Капитал</span><strong>{compactMoney(summary.netWorthCents)}</strong></div></section>
    <section className="kpi-grid four"><Kpi label="Деньги" value={compactMoney(summary.depositsCents)} note="На банковском счёте" values={history.map((item) => item.netWorthCents)} open={openWhy} why="Остаток на депозитном счёте вашего домохозяйства. Каждое изменение можно найти в общем реестре." /><Kpi label="Доход за месяц" value={compactMoney(summary.incomeCents)} note={company?.name ?? "Нет зарплаты"} open={openWhy} /><Kpi label="Расходы за месяц" value={compactMoney(summary.expensesCents)} note={`Цель накоплений ${percent(world.player.savingsTargetBps)}`} open={openWhy} /><Kpi label="Долг" value={compactMoney(summary.debtCents)} note={summary.debtCents ? "Есть обязательства" : "Нет кредитов"} open={openWhy} /></section>
    <section className="two-column"><article className="panel"><header className="panel-title"><h2>Капитал по месяцам</h2><WhyButton title="Капитал" text="Активы вашего домохозяйства за вычетом обязательств. Доход сам по себе не равен росту капитала: часть денег расходуется." open={openWhy} /></header><LineAreaChart values={history.map((item) => item.netWorthCents)} labels={history.map((item) => `${item.elapsedMonth + 1}м`)} format={compactMoney} ariaLabel="Капитал игрока" /></article><article className="panel"><header className="panel-title"><h2>История</h2><span>{world.player.timeline.length}</span></header><div className="timeline">{world.player.timeline.slice(-8).reverse().map((item) => <div key={item.id}><i /><span><b>{item.title}</b><small>{item.detail} · {item.elapsedMonth + 1}м</small></span></div>)}{!world.player.timeline.length && <p className="empty">События появятся после первого решения.</p>}</div></article></section>
  </>;
}

function Career({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const person = playerPerson(world);
  const household = playerHousehold(world);
  const employer = world.companies.find((item) => item.id === household.employerId);
  const occupation = world.occupations.find((item) => item.id === person.occupationId);
  const vacancies = world.companies.filter((item) => item.active).flatMap((company) => availableOccupations(world, company.id).slice(0, 2).map((job) => ({ company, job })));
  const apply = (companyId: string, occupationId: string) => { const answer = applyForJob(world, companyId, occupationId); commit(); notify(answer.reason); };
  return <><Section title="Карьера" meta={employer ? `${occupation?.name} · ${employer.name}` : "Доступен поиск работы"} />
    <section className="career-current panel"><div><span>Трудовой статус</span><h2>{occupation?.name ?? "Без работы"}</h2><p>{employer ? `${employer.name} · ${money(employer.wageCents)} в месяц` : "Выберите вакансию и отправьте заявку."}</p></div>{employer && <button className="danger" onClick={() => { resignPlayerJob(world); commit(); notify("Трудовой договор завершён"); }}>Уволиться</button>}{world.player.pendingJobOffer && <button className="primary" onClick={() => { const ok = acceptJobOffer(world); commit(); notify(ok ? "Предложение принято" : "Предложение недоступно"); }}>Принять предложение</button>}</section>
    <article className="panel"><header className="panel-title"><h2>Вакансии</h2><WhyButton title="Решение работодателя" text="Работодатель проверяет навыки, практический опыт, конкуренцию кандидатов и способность компании платить зарплату. Результат не определяется опытом или случайным числом." open={openWhy} /></header><div className="responsive-table"><table><thead><tr><th>Должность</th><th>Компания</th><th>Зарплата</th><th>Ключевые навыки</th><th /></tr></thead><tbody>{vacancies.map(({ company, job }) => <tr key={`${company.id}-${job.id}`}><td><b>{job.name}</b><small>Уровень {job.level}</small></td><td>{company.name}</td><td>{money(Math.round(company.wageCents * (0.88 + job.level * 0.11)))}</td><td>{Object.keys(job.requiredSkills).map((skill) => SKILL_LABELS[skill as keyof typeof SKILL_LABELS]).join(", ")}</td><td><button disabled={Boolean(household.employerId)} onClick={() => apply(company.id, job.id)}>Подать заявку</button></td></tr>)}</tbody></table></div></article>
    <article className="panel skills-panel"><header className="panel-title"><h2>Навыки</h2><span>0–100</span></header><div className="skill-grid">{Object.entries(person.skills).map(([id, value]) => <div key={id}><span>{SKILL_LABELS[id as keyof typeof SKILL_LABELS]}</span><strong>{number.format(value / 100)}</strong><i><b style={{ width: `${Math.min(100, value / 100)}%` }} /></i></div>)}</div></article>
  </>;
}

function Education({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const active = world.player.activeUniversityEnrollment;
  const activeProgram = active && world.universityPrograms.find((program) => program.id === active.programId);
  const activeUniversity = active && world.universities.find((university) => university.id === active.universityId);
  const institutions = [...world.universities].sort((left, right) => Number(right.cityId === world.player.currentCityId) - Number(left.cityId === world.player.currentCityId) || right.reputationBps - left.reputationBps);
  return <><Section title="Институты и университеты" meta={`${world.universities.length} вузов · ${world.universityPrograms.length} программ`} />
    {active && <section className="education-current panel"><div><span>Текущее обучение</span><h2>{activeProgram?.name}</h2><p>{activeUniversity?.shortName} · {active.completedMonths}/{active.durationMonths} мес.</p></div><strong>{Math.round(active.completedMonths * 100 / active.durationMonths)}%</strong></section>}
    <section className="institution-grid">{institutions.map((university) => { const city = world.cities.find((item) => item.id === university.cityId); return <article className="panel institution" key={university.id}><header><div><span>{university.type === "institute" ? "Институт" : "Университет"} · {city?.name}</span><h2>{university.shortName}</h2><small>{university.name}</small></div><b>{number.format(university.reputationBps / 100)}</b></header><div className="program-list">{university.programIds.map((programId) => { const program = world.universityPrograms.find((item) => item.id === programId)!; const application = world.player.universityApplications.find((item) => item.programId === program.id); const completed = world.player.completedProgramIds.includes(program.id); const requirements = Object.entries(program.requiredSkills).map(([skill, value]) => `${SKILL_LABELS[skill as keyof typeof SKILL_LABELS]} ${number.format((value ?? 0) / 100)}`).join(" · "); return <div className="program" key={program.id}><div><h3>{program.name}</h3><span>{program.degree === "bachelor" ? "Бакалавриат" : program.degree === "master" ? "Магистратура" : "Докторантура"} · {program.durationMonths / 12} г.</span></div><dl><div><dt>Обучение / год</dt><dd>{compactMoney(program.tuitionPerYearCents)}</dd></div><div><dt>Места</dt><dd>{program.capacity - program.occupiedSeats}/{program.capacity}</dd></div></dl><footer><WhyButton title="Условия поступления" text={`Минимальное образование: ${EDUCATION_LABELS[program.minimumEducation]}. Навыки: ${requirements}. Итог зависит от требований, репутации, конкурса и свободных мест.`} open={openWhy} />{completed ? <span className="pill ok">Диплом</span> : application?.status === "admitted" ? <button disabled={Boolean(active)} onClick={() => { const ok = enrollUniversity(world, program.id); commit(); notify(ok ? "Вы зачислены" : "Недостаточно средств или место недоступно"); }}>Зачислиться</button> : application?.status === "rejected" ? <span className="pill warn">Не пройден конкурс</span> : <button disabled={Boolean(active)} onClick={() => { const ok = applyUniversity(world, program.id); commit(); notify(ok ? "Конкурс пройден — подтвердите зачисление" : "Заявка отклонена"); }}>Подать документы</button>}</footer></div>; })}</div></article>; })}</section>
  </>;
}

function World({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const current = world.cities.find((city) => city.id === world.player.currentCityId)!;
  const [countryId, setCountryId] = useState(current.countryId);
  const [cityId, setCityId] = useState(current.id);
  const selected = world.cities.find((city) => city.id === cityId) ?? current;
  const options = travelOptions(world, selected.id);
  const housing = world.housingCohorts.filter((cohort) => cohort.cityId === current.id);
  const assets = world.player.durableAssetIds.map((id) => world.durableAssets.find((asset) => asset.id === id)).filter(Boolean);
  return <><Section title="Мир" meta={`${world.countries.length} стран · ${world.cities.length} городов`} />
    <section className="world-layout"><article className="panel world-browser"><div className="country-tabs">{world.countries.map((country) => <button className={country.id === countryId ? "active" : ""} key={country.id} onClick={() => { setCountryId(country.id); const first = world.cities.find((city) => city.countryId === country.id); if (first) setCityId(first.id); }}>{country.name}</button>)}</div><div className="city-list">{world.cities.filter((city) => city.countryId === countryId).map((city) => <button className={city.id === cityId ? "active" : ""} key={city.id} onClick={() => setCityId(city.id)}><span>{city.name}{city.id === current.id && <i>Сейчас</i>}</span><strong>{compactMoney(city.costOfLivingCents)}</strong></button>)}</div></article><article className="panel city-detail"><header><div><span>{world.countries.find((country) => country.id === selected.countryId)?.name}</span><h2>{selected.name}</h2></div><WhyButton title="Стоимость жизни" text="Рассчитывается из местных цен товаров и аренды. Доходы, занятость, свободное жильё и логистика обновляют показатели города." open={openWhy} /></header><dl><div><dt>Медианный доход</dt><dd>{compactMoney(selected.medianIncomeCents)}</dd></div><div><dt>Стоимость жизни</dt><dd>{compactMoney(selected.costOfLivingCents)}</dd></div><div><dt>Занятость</dt><dd>{percent(selected.employmentBps)}</dd></div><div><dt>Свободное жильё</dt><dd>{percent(selected.housingVacancyBps)}</dd></div></dl>{selected.id !== current.id && <div className="travel-options">{options.map((option) => <button key={option.mode} disabled={Boolean(world.player.activeTravel)} onClick={() => { const ok = startTravel(world, selected.id, option.mode, true); commit(); notify(ok ? "Переезд начался" : "Поездка недоступна"); }}><span>{option.mode === "air" ? "Самолёт" : option.mode === "rail" ? "Поезд" : "Автомобиль"}</span><b>{money(option.priceCents)}</b><small>{option.distanceKm.toLocaleString("ru-RU")} км · {option.durationDays} дн.</small></button>)}</div>}{selected.id === current.id && <span className="current-city">Текущее местоположение</span>}</article></section>
    <article className="panel"><header className="panel-title"><h2>Жильё · {current.name}</h2><span>{world.player.residencePropertyId ? "Жильё выбрано" : "Нет жилья"}</span></header><div className="asset-grid">{housing.map((cohort) => <div className="asset-card" key={cohort.id}><span>{cohort.type === "rental-apartment" ? "Арендная квартира" : cohort.type === "owned-apartment" ? "Квартира" : "Дом"}</span><strong>{cohort.averageSizeSqm} м²</strong><small>{cohort.availableUnits} свободно</small><div><button disabled={Boolean(world.player.residencePropertyId)} onClick={() => { const ok = rentProperty(world, cohort.id); commit(); notify(ok ? "Жильё арендовано" : "Аренда недоступна"); }}>Аренда {compactMoney(cohort.monthlyRentCents)}</button><button disabled={depositOf(world, world.player.householdId) < cohort.salePriceCents} onClick={() => { const ok = buyProperty(world, cohort.id); commit(); notify(ok ? "Недвижимость куплена" : "Покупка недоступна"); }}>Купить {compactMoney(cohort.salePriceCents)}</button></div></div>)}</div></article>
    <article className="panel goods-panel"><header className="panel-title"><h2>Товары длительного пользования</h2><span>{assets.length} в собственности</span></header><div className="asset-grid">{world.products.map((product) => <div className="asset-card" key={product.id}><span>{product.brand}</span><strong>{product.name}</strong><small>Качество {number.format(product.qualityBps / 100)} · срок {product.durabilityMonths} мес.</small><button disabled={depositOf(world, world.player.householdId) < product.priceCents} onClick={() => { const ok = buyDurable(world, product.id); commit(); notify(ok ? "Покупка завершена" : "Недостаточно средств"); }}>{compactMoney(product.priceCents)}</button></div>)}</div>{assets.length > 0 && <div className="owned-assets">{assets.map((asset) => { if (!asset) return null; const product = world.products.find((item) => item.id === asset.productId); return <div key={asset.id}><span>{product?.name}</span><b>Состояние {percent(asset.conditionBps)}</b><button onClick={() => { const ok = sellDurable(world, asset.id, "household-002"); commit(); notify(ok ? "Актив продан на вторичном рынке" : "Покупатель не смог оплатить"); }}>Продать · {compactMoney(asset.resaleValueCents)}</button></div>; })}</div>}</article>
  </>;
}

function MyFinances({ world, commit, openWhy }: { world: WorldState; commit: () => void; openWhy: (title: string, text: string) => void }) {
  const summary = playerFinancialSummary(world);
  const transactions = tracePlayerMoney(world);
  const history = world.player.monthlyHistory.slice(-24);
  return <><Section title="Мои финансы" meta={`Счёт в ${world.banks.find((item) => item.id === playerHousehold(world).bankId)?.name}`} /><section className="kpi-grid four"><Kpi label="Доход" value={compactMoney(summary.incomeCents)} note="Последний месяц" values={history.map((item) => item.incomeCents)} open={openWhy} /><Kpi label="Расходы" value={compactMoney(summary.expensesCents)} note="Последний месяц" values={history.map((item) => item.expensesCents)} open={openWhy} /><Kpi label="Сбережения" value={compactMoney(summary.savingsCents)} note={percent(summary.savingsRateBps)} values={history.map((item) => item.savingsCents)} open={openWhy} why="Доход минус фактические списания с депозитного счёта за месяц." /><Kpi label="Чистый капитал" value={compactMoney(summary.netWorthCents)} note={`Долг ${compactMoney(summary.debtCents)}`} values={history.map((item) => item.netWorthCents)} open={openWhy} /></section><article className="panel savings-control"><div><h2>Цель накоплений</h2><p>Определяет долю дохода, которую домохозяйство старается не тратить.</p></div><label><input type="range" min="500" max="8000" step="100" value={world.player.savingsTargetBps} onChange={(event) => { setPlayerSavingsTarget(world, Number(event.target.value)); commit(); }} /><strong>{percent(world.player.savingsTargetBps)}</strong></label></article><article className="panel"><header className="panel-title"><h2>Операции по счёту</h2><WhyButton title="Источник данных" text="Список собран из двойных проводок общего реестра. Здесь нет отдельного игрового кошелька или искусственного баланса." open={openWhy} /></header><TransactionRows transactions={transactions.slice(0, 40)} /></article></>;
}

function Economy({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const metrics = latestMetrics(world);
  const history = world.metricsHistory.slice(-36);
  return <><Section title="Экономика" meta={`${world.households.length} домохозяйств · ${metrics.activeCompanies} компаний`} /><section className="kpi-grid four"><Kpi label="ВВП" value={compactMoney(metrics.nominalGdpCents)} note={`Реальный ${compactMoney(metrics.realGdpCents)}`} values={history.map((item) => item.nominalGdpCents)} open={openWhy} why="ВВП по добавленной стоимости: выпуск компаний за вычетом промежуточного потребления. Он сверяется с потреблением, инвестициями, госрасходами и изменением запасов." /><Kpi label="Инфляция" value={percent(metrics.annualInflationBps)} note={`ИПЦ ${number.format(metrics.cpiBps / 100)}`} values={history.map((item) => item.annualInflationBps)} open={openWhy} /><Kpi label="Безработица" value={percent(metrics.unemploymentBps)} note={`${metrics.employedHouseholds} заняты`} values={history.map((item) => item.unemploymentBps)} open={openWhy} /><Kpi label="Ключевая ставка" value={percent(metrics.policyRateBps)} note={`Цель инфляции ${percent(world.centralBank.inflationTargetBps)}`} values={history.map((item) => item.policyRateBps)} open={openWhy} /></section><section className="two-column"><article className="panel"><header className="panel-title"><h2>Номинальный ВВП</h2><span>По месяцам</span></header><LineAreaChart values={history.map((item) => item.nominalGdpCents)} labels={history.map(monthLabel)} format={compactMoney} ariaLabel="Номинальный ВВП" /></article><article className="panel national-accounts"><header className="panel-title"><h2>Использование ВВП</h2><WhyButton title="Сверка ВВП" text={`Метод добавленной стоимости и метод расходов расходятся на ${money(metrics.gdpReconciliationGapCents)}.`} open={openWhy} /></header><dl><div><dt>Потребление</dt><dd>{compactMoney(metrics.householdConsumptionCents)}</dd></div><div><dt>Инвестиции</dt><dd>{compactMoney(metrics.capitalFormationCents)}</dd></div><div><dt>Государство</dt><dd>{compactMoney(metrics.governmentConsumptionCents)}</dd></div><div><dt>Запасы</dt><dd>{compactMoney(metrics.inventoryChangeCents)}</dd></div><div className="total"><dt>ВВП</dt><dd>{compactMoney(metrics.gdpExpenditureCents)}</dd></div></dl></article></section><section className="market-grid">{world.goods.map((good) => { const producers = world.companies.filter((company) => company.active && company.goodId === good.id); const inventory = producers.reduce((sum, company) => sum + company.inventoryMilliUnits, 0); return <article className="market-card" key={good.id}><header><h2>{good.shortName}</h2><strong>{money(metrics.priceByGoodCents[good.id])}</strong></header><MarketBars production={metrics.productionByGoodMilliUnits[good.id]} sales={metrics.salesByGoodMilliUnits[good.id]} /><dl><div><dt>Производство</dt><dd>{number.format(metrics.productionByGoodMilliUnits[good.id] / 1_000)}</dd></div><div><dt>Продажи</dt><dd>{number.format(metrics.salesByGoodMilliUnits[good.id] / 1_000)}</dd></div><div><dt>Запасы</dt><dd>{number.format(inventory / 1_000)}</dd></div></dl></article>; })}</section><CompanyTable world={world} /></>;
}

function CompanyTable({ world }: { world: WorldState }) {
  const countryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const companies = world.companies.filter((company) => company.headquartersCountryId === countryId);
  return <article className="panel"><header className="panel-title"><h2>Компании</h2><span>{companies.filter((item) => item.active).length} работают</span></header><div className="responsive-table"><table><thead><tr><th>Компания</th><th>Рынок</th><th>Статус</th><th>Штат</th><th>Деньги</th><th>Выручка</th><th>Прибыль</th></tr></thead><tbody>{companies.map((company) => { const report = company.financialReports.at(-1); return <tr key={company.id}><td><b>{company.name}</b><small>{company.id}</small></td><td>{world.goods.find((item) => item.id === company.goodId)?.shortName}</td><td><span className={`pill ${company.active && !company.distressMonths ? "ok" : "warn"}`}>{company.active ? company.distressMonths ? "Риск" : "Работает" : "Закрыта"}</span></td><td>{company.employees.length}</td><td>{compactMoney(depositOf(world, company.id))}</td><td>{compactMoney(company.lastGrossRevenueCents)}</td><td>{compactMoney(report?.netIncomeCents ?? 0)}</td></tr>; })}</tbody></table></div></article>;
}

function Companies({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const playerCountryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const localCompanies = world.companies.filter((company) => company.headquartersCountryId === playerCountryId);
  const [selectedId, setSelectedId] = useState(localCompanies[0]?.id ?? world.companies[0].id);
  const [tab, setTab] = useState<"overview" | "finance" | "ownership" | "debt" | "governance" | "events">("overview");
  const company = world.companies.find((item) => item.id === selectedId) ?? localCompanies[0] ?? world.companies[0];
  const country = world.countries.find((item) => item.id === company.headquartersCountryId)!;
  const city = world.cities.find((item) => item.id === company.headquartersCityId)!;
  const security = world.equitySecurities.find((item) => item.id === company.equitySecurityId)!;
  const holdings = world.equityHoldings.filter((holding) => holding.securityId === security.id).sort((a, b) => b.shares - a.shares);
  const bonds = world.corporateBonds.filter((bond) => bond.issuerCompanyId === company.id);
  const actions = world.corporateActions.filter((action) => action.companyId === company.id).slice(-12).reverse();
  const valuation = companyValuation(world, company.id);
  const playerShare = ownershipBps(world, security.id, world.player.householdId);
  const controlled = playerShare >= 5_001;
  const sharePrice = Math.max(1, Math.round(valuation.equityValueCents / Math.max(1, security.sharesOutstanding)));
  const act = (answer: { ok: boolean; message: string }) => { commit(); notify(answer.message); };
  return <>
    <Section title="Компании" meta={`${country.name} · ${localCompanies.length} компаний`} />
    <div className="company-explorer">
      <aside className="panel company-list">{localCompanies.map((item) => <button key={item.id} className={item.id === company.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span><b>{item.name}</b><small>{item.industry} · {world.cities.find((cityItem) => cityItem.id === item.cityId)?.name}</small></span><i className={item.active ? "ok" : "fail"}>{item.corporateStatus === "public" ? "Публичная" : item.active ? "Частная" : "Закрыта"}</i></button>)}</aside>
      <section className="panel company-detail">
        <header className="company-identity"><div><span>{country.name} · {city.name}</span><h2>{company.name}</h2><small>{company.industry} · уровень {company.representationTier} · {company.sizeClass === "large" ? "крупная" : company.sizeClass === "medium" ? "средняя" : "малая"}</small></div><div><b>{currencyMoney(depositOf(world, company.id), country.currencyReference)}</b><small>Деньги</small></div></header>
        <nav className="detail-tabs">{[["overview","Обзор"],["finance","Финансы"],["ownership","Собственность"],["debt","Долг"],["governance","Управление"],["events","События"]].map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</nav>
        {tab === "overview" && <div className="company-section"><dl className="metric-list"><div><dt>Статус</dt><dd>{company.active ? "Работает" : "Закрыта"}</dd></div><div><dt>Работники</dt><dd>{company.employees.length}</dd></div><div><dt>Производство</dt><dd>{number.format(company.lastProductionMilliUnits / 1_000)}</dd></div><div><dt>Загрузка</dt><dd>{percent(company.capacityUtilizationBps)}</dd></div><div><dt>Цена</dt><dd>{currencyMoney(company.priceCents, country.currencyReference)}</dd></div><div><dt>Качество</dt><dd>{number.format(company.qualityBps / 100)}</dd></div></dl></div>}
        {tab === "finance" && <div className="company-section"><section className="valuation-band"><div><span>Оценка капитала</span><strong>{currencyMoney(valuation.equityValueCents, country.currencyReference)}</strong></div><div><span>Диапазон стоимости бизнеса</span><strong>{currencyMoney(valuation.enterpriseValueLowCents, country.currencyReference)} — {currencyMoney(valuation.enterpriseValueHighCents, country.currencyReference)}</strong></div><div><span>WACC</span><strong>{percent(valuation.waccBps)}</strong></div><WhyButton title="Метод оценки" text={`${valuation.method}. Оценка не создаёт деньги и не меняет реестр.`} open={openWhy} /></section><dl className="metric-list"><div><dt>Выручка</dt><dd>{currencyMoney(company.lastGrossRevenueCents, country.currencyReference)}</dd></div><div><dt>Расходы</dt><dd>{currencyMoney(company.lastOperatingExpenseCents, country.currencyReference)}</dd></div><div><dt>Нераспределённая прибыль</dt><dd>{currencyMoney(company.retainedEarningsCents, country.currencyReference)}</dd></div><div><dt>Капитал</dt><dd>{currencyMoney(company.productiveCapital.bookValueCents, country.currencyReference)}</dd></div></dl></div>}
        {tab === "ownership" && <div className="company-section"><div className="cap-table"><header><span>Владелец</span><span>Акции</span><span>Доля</span><span>Стоимость приобретения</span></header>{holdings.map((holding) => <div key={holding.id}><span>{entityLabel(world, holding.ownerId)}</span><b>{holding.shares.toLocaleString("ru-RU")}</b><b>{percent(Math.round(holding.shares * 10_000 / security.sharesOutstanding))}</b><b>{currencyMoney(holding.costBasisCents, security.currencyId)}</b></div>)}</div><footer className="register-total"><span>В обращении</span><b>{security.sharesOutstanding.toLocaleString("ru-RU")}</b></footer></div>}
        {tab === "debt" && <div className="company-section">{bonds.length ? <div className="bond-list">{bonds.map((bond) => <article key={bond.id}><span>{bond.id} · {bond.seniority === "senior" ? "старший" : "субординированный"}</span><strong>{currencyMoney(bond.outstandingFaceValueCents, bond.currencyId)}</strong><small>Купон {percent(bond.couponBps)} · погашение {bond.maturityMonth + 1}м · {bond.status}</small></article>)}</div> : <p className="empty">Облигаций нет.</p>}</div>}
        {tab === "governance" && <div className="company-section"><dl className="metric-list"><div><dt>Контроль игрока</dt><dd>{percent(playerShare)}</dd></div><div><dt>Совет директоров</dt><dd>{world.corporateBoards.find((board) => board.id === company.boardId)?.directorOwnerIds.map((id) => entityLabel(world, id)).join(", ")}</dd></div><div><dt>Материнская компания</dt><dd>{company.parentCompanyId ? entityLabel(world, company.parentCompanyId) : "Нет"}</dd></div><div><dt>Дочерние компании</dt><dd>{company.subsidiaryIds.length}</dd></div></dl></div>}
        {tab === "events" && <div className="company-section action-list">{actions.length ? actions.map((action) => <article key={action.id}><span>{action.elapsedMonth + 1}м</span><b>{action.title}</b><strong>{currencyMoney(action.amountCents, country.currencyReference)}</strong></article>) : <p className="empty">Корпоративных событий нет.</p>}</div>}
        {controlled && <footer className="corporate-actions"><button onClick={() => act(raiseEquity(world, company.id, world.player.householdId, Math.min(500_000_00, Math.floor(depositOf(world, world.player.householdId) / 4)), sharePrice))}>Внести капитал</button><button disabled={company.retainedEarningsCents <= 0} onClick={() => act(declareDividend(world, company.id, Math.min(company.retainedEarningsCents, Math.floor(depositOf(world, company.id) / 10))))}>Дивиденд</button><button onClick={() => act(issueBond(world, company.id, world.player.householdId, Math.min(250_000_00, Math.floor(depositOf(world, world.player.householdId) / 5)), 850, 36))}>Купить выпуск облигаций</button>{company.corporateStatus === "private" && <button className="primary" onClick={() => act(startIpo(world, company.id, world.player.householdId, Math.min(500_000_00, Math.floor(depositOf(world, world.player.householdId) / 4)), sharePrice))}>Провести IPO</button>}</footer>}
      </section>
    </div>
  </>;
}

function Markets({ world, commit, notify }: { world: WorldState; commit: () => void; notify: (text: string) => void }) {
  const countryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const exchange = world.exchanges.find((item) => item.countryId === countryId)!;
  const broker = world.brokers.find((item) => item.countryId === countryId)!;
  const account = world.brokerageAccounts.find((item) => item.ownerId === world.player.householdId && item.brokerId === broker.id && item.status === "active");
  const listings = world.listings.filter((listing) => listing.exchangeId === exchange.id);
  const [selectedSecurityId, setSelectedSecurityId] = useState(listings[0]?.securityId ?? "");
  const listing = listings.find((item) => item.securityId === selectedSecurityId) ?? listings[0];
  const [quantity, setQuantity] = useState(10);
  const [price, setPrice] = useState(listing?.lastPriceCents ?? 1_000);
  const orders = listing ? world.marketOrders.filter((order) => order.securityId === listing.securityId && (order.status === "open" || order.status === "partially-filled")) : [];
  const bars = listing ? world.ohlcvBars.filter((bar) => bar.securityId === listing.securityId).slice(-24) : [];
  const submit = (side: "buy" | "sell") => {
    if (!account || !listing) return;
    const answer = placeOrder(world, account.id, listing.securityId, side, "limit", quantity, price);
    commit(); notify(answer.message);
  };
  return <>
    <Section title="Рынки" meta={`${exchange.name} · ${exchange.currencyId}`} />
    {!account && <article className="panel broker-open"><div><span>{broker.name}</span><h2>Брокерский счёт</h2><small>Расчёты идут с реального банковского депозита. Валютный обмен не моделируется.</small></div><button className="primary" onClick={() => { const answer = openBrokerageAccount(world, world.player.householdId, broker.id); commit(); notify(answer.message); }}>Открыть счёт</button></article>}
    <section className="listing-strip">{listings.map((item) => { const company = world.companies.find((companyItem) => companyItem.id === item.companyId)!; const changeBps = Math.round((item.lastPriceCents - item.previousCloseCents) * 10_000 / Math.max(1, item.previousCloseCents)); return <button className={listing?.id === item.id ? "active" : ""} key={item.id} onClick={() => { setSelectedSecurityId(item.securityId); setPrice(item.lastPriceCents); }}><span>{item.ticker}</span><b>{currencyMoney(item.lastPriceCents, item.currencyId)}</b><small className={changeBps >= 0 ? "positive" : "negative"}>{changeBps >= 0 ? "+" : ""}{percent(changeBps)}</small><i>{company.name}</i></button>; })}</section>
    {listing ? <div className="market-workspace"><article className="panel market-chart"><header className="panel-title"><h2>{listing.ticker}</h2><span>OHLCV · сделки формируют цену</span></header><LineAreaChart values={bars.map((bar) => bar.closeCents)} labels={bars.map((bar) => `${bar.elapsedMonth + 1}м`)} format={(value) => currencyMoney(value, listing.currencyId)} ariaLabel={`Цена ${listing.ticker}`} /></article><article className="panel order-ticket"><header className="panel-title"><h2>Заявка</h2><span>{broker.name}</span></header><label>Количество<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} /></label><label>Лимитная цена<input type="number" min="1" value={price} onChange={(event) => setPrice(Math.max(1, Number(event.target.value)))} /></label><div><button disabled={!account} onClick={() => submit("sell")}>Продать</button><button className="primary" disabled={!account} onClick={() => submit("buy")}>Купить</button></div><small>Сумма: {currencyMoney(quantity * price, listing.currencyId)}</small></article><article className="panel order-book"><header className="panel-title"><h2>Книга заявок</h2><span>Цена · время</span></header><div className="book-head"><span>Покупка</span><span>Цена</span><span>Продажа</span></div>{[...orders].sort((a,b) => (b.limitPriceCents ?? 0) - (a.limitPriceCents ?? 0)).slice(0, 16).map((order) => <div key={order.id}><b>{order.side === "buy" ? order.remainingQuantity : "—"}</b><span>{currencyMoney(order.limitPriceCents ?? listing.lastPriceCents, listing.currencyId)}</span><b>{order.side === "sell" ? order.remainingQuantity : "—"}</b></div>)}{!orders.length && <p className="empty">Нет открытых заявок.</p>}</article></div> : <p className="empty">На локальной бирже пока нет инструментов.</p>}
  </>;
}

function Portfolio({ world }: { world: WorldState }) {
  const summary = portfolioSummary(world, world.player.householdId);
  const countryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const currency = world.countries.find((country) => country.id === countryId)?.currencyReference ?? "RUB";
  return <><Section title="Портфель" meta={`${summary.positions.length} позиций`} /><section className="kpi-grid four"><Kpi label="Деньги" value={currencyMoney(summary.cashCents, currency)} open={() => undefined} /><Kpi label="Рыночная стоимость" value={currencyMoney(summary.marketValueCents, currency)} open={() => undefined} /><Kpi label="Нереализованный результат" value={currencyMoney(summary.unrealizedPnlCents, currency)} open={() => undefined} /><Kpi label="Дивиденды и купоны" value={currencyMoney(summary.realizedIncomeCents, currency)} open={() => undefined} /></section><article className="panel"><header className="panel-title"><h2>Позиции</h2><span>Средняя стоимость и результат</span></header><div className="responsive-table"><table><thead><tr><th>Инструмент</th><th>Количество</th><th>Цена</th><th>Стоимость</th><th>Затраты</th><th>Результат</th></tr></thead><tbody>{summary.positions.map((position) => <tr key={position.securityId}><td><b>{position.ticker}</b><small>{world.companies.find((company) => company.equitySecurityId === position.securityId)?.name}</small></td><td>{position.shares.toLocaleString("ru-RU")}</td><td>{currencyMoney(position.priceCents, currency)}</td><td>{currencyMoney(position.valueCents, currency)}</td><td>{currencyMoney(position.costBasisCents, currency)}</td><td className={position.pnlCents >= 0 ? "positive" : "negative"}>{currencyMoney(position.pnlCents, currency)}</td></tr>)}</tbody></table>{!summary.positions.length && <p className="empty">Позиции появятся после покупки акций.</p>}</div></article></>;
}

function Banks({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const countryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const banks = world.banks.filter((bank) => bank.countryId === countryId);
  const centralBank = world.centralBanks.find((bank) => bank.countryId === countryId) ?? world.centralBank;
  return <><Section title="Банки" meta={`${world.loans.filter((item) => item.status === "active" && banks.some((bank) => bank.id === item.lenderBankId)).length} активных кредитов`} /><section className="bank-grid">{banks.map((bank) => { const book = entityBook(world, bank.id); const reserves = balanceOf(world, accountIds.bankReserve(bank.id)); const deposits = Object.values(world.ledger.accounts).filter((account) => account.ownerId === bank.id && account.category === "liability" && account.instrument === "deposit").reduce((sum, account) => sum + balanceOf(world, account.id), 0); const loans = world.loans.filter((loan) => loan.lenderBankId === bank.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0); return <article className="panel bank-card" key={bank.id}><header><div><span>Коммерческий банк</span><h2>{bank.name}</h2></div><WhyButton title={bank.name} text="Капитал поглощает убытки, а ликвидность нужна для межбанковских расчётов. Это разные ограничения кредитования." open={openWhy} /></header><dl><div><dt>Капитал</dt><dd>{compactMoney(book.capital)}</dd></div><div><dt>Норматив капитала</dt><dd>{percent(bankCapitalRatioBps(world, bank.id))}</dd></div><div><dt>Ликвидность</dt><dd>{compactMoney(reserves)}</dd></div><div><dt>Коэффициент ликвидности</dt><dd>{percent(bankLiquidityRatioBps(world, bank.id))}</dd></div><div><dt>Депозиты</dt><dd>{compactMoney(deposits)}</dd></div><div><dt>Кредитный портфель</dt><dd>{compactMoney(loans)}</dd></div></dl></article>; })}</section><article className="panel policy"><header className="panel-title"><h2>Центральный банк</h2><span>{centralBank.name}</span></header><div><Kpi label="Ключевая ставка" value={percent(centralBank.policyRateBps)} note="Пересмотр раз в квартал" open={openWhy} /><Kpi label="Цель инфляции" value={percent(centralBank.inflationTargetBps)} note="Годовой темп" open={openWhy} /><Kpi label="Кредиты ликвидности" value={world.bankFunding.filter((item) => item.lenderId === centralBank.id && item.status === "active").length.toString()} note="Активные договоры" open={openWhy} /></div></article></>;
}

function transactionAmount(transaction: LedgerTransaction): number {
  return Math.max(0, ...transaction.entries.map((entry) => entry.amountCents));
}

function TransactionRows({ transactions, select, selectedId }: { transactions: LedgerTransaction[]; select?: (id: string) => void; selectedId?: string }) {
  if (!transactions.length) return <p className="empty">Операций пока нет.</p>;
  return <div className="transaction-rows">{transactions.map((transaction) => <button className={selectedId === transaction.id ? "selected" : ""} key={transaction.id} onClick={() => select?.(transaction.id)}><span><b>{TX_LABELS[transaction.kind]}</b><small>{transaction.memo} · {transaction.elapsedMonth + 1}м</small></span><strong>{compactMoney(transactionAmount(transaction))}</strong></button>)}</div>;
}

function Ledger({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = world.ledger.transactions.filter((transaction) => `${transaction.id} ${TX_LABELS[transaction.kind]} ${transaction.memo}`.toLowerCase().includes(query.toLowerCase())).slice(-150).reverse();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = world.ledger.transactions.find((item) => item.id === selectedId) ?? filtered[0];
  return <><Section title="Общий реестр" meta={`${world.ledger.transactions.length.toLocaleString("ru-RU")} операций`} /><div className="ledger-grid"><article className="panel ledger-list"><label className="search"><span>Поиск</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, тип или назначение" /></label><TransactionRows transactions={filtered} select={setSelectedId} selectedId={selected?.id} /></article><article className="panel transaction-detail">{selected ? <><header><div><span>{selected.id} · {selected.elapsedMonth + 1} месяц</span><h2>{TX_LABELS[selected.kind]}</h2></div><strong>{money(transactionAmount(selected))}</strong></header><button className="memo" onClick={() => openWhy(TX_LABELS[selected.kind], selected.memo)}>Причина операции</button><div className="entry-head"><span>Счёт</span><span>Дебет</span><span>Кредит</span></div>{selected.entries.map((entry, index) => { const account = world.ledger.accounts[entry.accountId]; return <div className="entry-row" key={`${entry.accountId}-${index}`}><span><b>{account?.name}</b><small>{entityLabel(world, account?.ownerId ?? "")}</small></span><span>{entry.side === "debit" ? money(entry.amountCents) : "—"}</span><span>{entry.side === "credit" ? money(entry.amountCents) : "—"}</span></div>; })}<footer>Проводка сбалансирована</footer></> : <p className="empty">Операций пока нет.</p>}</article></div></>;
}

function Control({ world }: { world: WorldState }) {
  const invariants = checkInvariants(world);
  const events = world.events.filter((event) => event.type !== "MonthClosed" && event.type !== "AccountingPeriodClosed").slice(-12).reverse();
  const diagnostics = world.diagnostics;
  return <>
    <Section title="Контроль" meta={`${invariants.filter((item) => item.ok).length}/${invariants.length} проверок пройдено`} />
    <section className="kpi-grid four">
      <Kpi label="Население" value={diagnostics.populationRepresented.toLocaleString("ru-RU")} note={`${diagnostics.highFidelityPersons} персон подробно`} open={() => undefined} />
      <Kpi label="Фирмы" value={diagnostics.businessesRepresented.toLocaleString("ru-RU")} note={`${diagnostics.explicitFirms} подробно`} open={() => undefined} />
      <Kpi label="Горячий реестр" value={diagnostics.ledgerHotTransactions.toLocaleString("ru-RU")} note={`${diagnostics.ledgerArchivedTransactions.toLocaleString("ru-RU")} в архиве`} open={() => undefined} />
      <Kpi label="Размер сохранения" value={`${number.format(diagnostics.estimatedSaveBytes / 1_000_000)} МБ`} note={`${diagnostics.deterministicWorkUnits} расчётных единиц`} open={() => undefined} />
    </section>
    <section className="invariant-grid">{invariants.map((item) => <article className={`invariant ${item.ok ? "pass" : "fail"}`} key={item.id}><span>{item.ok ? "Норма" : "Ошибка"}</span><div><small>{item.section}</small><h2>{item.title}</h2><p>{item.detail}</p></div></article>)}</section>
    <article className="panel"><header className="panel-title"><h2>Причинные события</h2><span>{world.events.length}</span></header><div className="event-grid">{events.map((event) => <article key={event.id}><i className={event.severity} /><span><b>{event.title}</b><small>{event.detail}</small></span><time>{event.elapsedMonth + 1}м</time></article>)}</div></article>
  </>;
}

const UPDATE_LABELS: Record<UpdateState, string> = {
  unsupported: "Не поддерживается",
  current: "Актуальная версия",
  checking: "Проверка…",
  available: "Доступно обновление",
  applying: "Обновление…",
  offline: "Нет сети",
  error: "Ошибка проверки",
};

function Settings({ repository, updateState, autosaveState, checkUpdate, updateNow, forceUpdate }: { repository: SaveRepository; updateState: UpdateState; autosaveState: string; checkUpdate: () => void; updateNow: () => void; forceUpdate: () => void }) {
  const [persistence, setPersistence] = useState<PersistenceDiagnostics | null>(null);
  const [worker, setWorker] = useState<{ controlled: boolean; state: string; scriptUrl: string | null; cacheNames: string[] } | null>(null);
  useEffect(() => { void Promise.all([repository.diagnostics(), serviceWorkerDiagnostics()]).then(([storage, serviceWorker]) => { setPersistence(storage); setWorker(serviceWorker); }); }, [repository, updateState, autosaveState]);
  return <><Section title="Настройки" meta={`Версия ${APP_BUILD.version}`} /><section className="settings-grid"><article className="panel settings-card"><header className="panel-title"><h2>Приложение</h2><span>{UPDATE_LABELS[updateState]}</span></header><dl><div><dt>Версия</dt><dd>{APP_BUILD.version}</dd></div><div><dt>Сборка</dt><dd>{APP_BUILD.buildId}</dd></div><div><dt>Коммит</dt><dd>{APP_BUILD.commit}</dd></div><div><dt>Дата сборки</dt><dd>{new Date(APP_BUILD.buildDate).toLocaleString("ru-RU")}</dd></div></dl><footer><button onClick={checkUpdate}>Проверить</button><button className="primary" onClick={updateNow}>Обновить сейчас</button><button className="danger" onClick={forceUpdate}>Принудительно обновить</button></footer></article><article className="panel settings-card"><header className="panel-title"><h2>Сохранение</h2><span>{autosaveState}</span></header><dl><div><dt>Активный мир</dt><dd>{persistence?.activeWorldId ?? "—"}</dd></div><div><dt>Последняя запись</dt><dd>{persistence?.lastAutosaveIso ? new Date(persistence.lastAutosaveIso).toLocaleString("ru-RU") : "—"}</dd></div><div><dt>Схема хранилища</dt><dd>{persistence?.databaseVersion ?? "—"}</dd></div><div><dt>Использовано</dt><dd>{persistence?.usageBytes ? `${number.format(persistence.usageBytes / 1_000_000)} МБ` : "—"}</dd></div></dl></article><article className="panel settings-card"><header className="panel-title"><h2>Офлайн</h2><span>{worker?.controlled ? "Активен" : "Подготовка"}</span></header><dl><div><dt>Service Worker</dt><dd>{worker?.state ?? "—"}</dd></div><div><dt>Кэши приложения</dt><dd>{worker?.cacheNames.filter((name) => name.startsWith("economic-world-app-")).length ?? 0}</dd></div><div><dt>Сценарий</dt><dd>{worker?.scriptUrl?.split("/").at(-1) ?? "—"}</dd></div><div><dt>Данные мира</dt><dd>IndexedDB не очищается при обновлении</dd></div></dl></article></section></>;
}

function Onboarding({ world, complete }: { world: WorldState; complete: (name: string, profile: string) => void }) {
  const [name, setName] = useState(playerPerson(world).displayName === "Игрок" ? "" : playerPerson(world).displayName);
  const [profile, setProfile] = useState("student");
  return <div className="modal-layer onboarding-layer"><section className="onboarding" role="dialog" aria-modal="true"><span>ECONOMIC WORLD</span><h1>Начало экономической жизни</h1><label>Имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Игрок" /></label><fieldset><legend>Начальный профиль</legend>{[["student", "Студент", "19 лет · базовые экономика и статистика"], ["office", "Офисный сотрудник", "21 год · коммуникация и бухгалтерия"], ["analyst", "Начинающий аналитик", "22 года · высшее образование"], ["developer", "Разработчик", "21 год · программирование и данные"]].map(([id, title, note]) => <label className={profile === id ? "selected" : ""} key={id}><input type="radio" name="profile" value={id} checked={profile === id} onChange={() => setProfile(id)} /><span><b>{title}</b><small>{note}</small></span></label>)}</fieldset><button className="primary" onClick={() => complete(name, profile)}>Войти в мир</button></section></div>;
}

function initialBoot(): boolean { try { return sessionStorage.getItem("economic-world-booted-v2") !== "1"; } catch { return true; } }
function initialOnboarding(): boolean { try { return localStorage.getItem("economic-world-onboarded-v2") !== "1"; } catch { return true; } }

export function App() {
  const [world, setWorld] = useState<WorldState>(() => createWorld());
  const worldRef = useRef(world);
  const [view, setView] = useState<View>("life");
  const [moreOpen, setMoreOpen] = useState(false);
  const [showBoot, setShowBoot] = useState(initialBoot);
  const [showOnboarding, setShowOnboarding] = useState(initialOnboarding);
  const [why, setWhy] = useState<{ title: string; text: string } | null>(null);
  const [notice, setNotice] = useState("Готово");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saves, setSaves] = useState<SaveManifest[]>([]);
  const [restoring, setRestoring] = useState(true);
  const [autosaveState, setAutosaveState] = useState("Ожидание");
  const [updateState, setUpdateState] = useState<UpdateState>("current");
  const autosaveTimer = useRef<number | null>(null);
  const autosaveChain = useRef<Promise<unknown>>(Promise.resolve());
  const moreDragStart = useRef<number | null>(null);
  const repository = useMemo(() => new SaveRepository(), []);
  const commit = useCallback(() => { setWorld({ ...worldRef.current }); }, []);
  const completeBoot = useCallback(() => { try { sessionStorage.setItem("economic-world-booted-v2", "1"); } catch { /* недоступно */ } setShowBoot(false); }, []);
  const openWhy = useCallback((title: string, text: string) => setWhy({ title, text }), []);

  const saveActiveNow = useCallback(async () => {
    const snapshot = structuredClone(worldRef.current);
    const cityId = snapshot.player.currentCityId;
    const countryId = snapshot.cities.find((city) => city.id === cityId)?.countryId;
    setAutosaveState("Сохранение…");
    autosaveChain.current = autosaveChain.current.then(() => repository.saveActive(snapshot, { route: view, cityId, countryId })).then(() => setAutosaveState("Сохранено")).catch(() => setAutosaveState("Ошибка сохранения"));
    await autosaveChain.current;
  }, [repository, view]);

  useEffect(() => { repository.list().then(setSaves).catch(() => setSaves([])); }, [repository]);
  useEffect(() => {
    let active = true;
    void repository.loadActive().then((restored) => {
      if (!active || !restored) return;
      worldRef.current = restored.world;
      setWorld(restored.world);
      if (restored.uiState && NAV.some((item) => item.id === restored.uiState!.route)) setView(restored.uiState.route as View);
      setNotice(restored.recovered ? "Восстановлена резервная контрольная точка" : "Активный мир восстановлен");
    }).catch(() => setNotice("Создан новый мир")).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [repository]);
  useEffect(() => {
    void registerAppServiceWorker(() => setUpdateState("available"));
  }, []);
  useEffect(() => {
    if (restoring) return;
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => { void saveActiveNow(); }, 450);
    return () => { if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current); };
  }, [world, view, restoring, saveActiveNow]);
  useEffect(() => { if (!playing || busy || restoring) return; const timer = window.setInterval(() => { runMonths(worldRef.current, speed); commit(); }, 1_000); return () => window.clearInterval(timer); }, [playing, busy, restoring, speed, commit]);

  const advance = async (months: number) => {
    if (busy) return;
    setBusy(true); setPlaying(false); setProgress(0);
    for (let done = 0; done < months; done += 3) { const count = Math.min(3, months - done); runMonths(worldRef.current, count); setProgress(Math.round(((done + count) * 100) / months)); commit(); await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); }
    setBusy(false); setNotice(`Выполнено: ${months} мес.`);
  };
  const save = async () => { setBusy(true); try { await repository.save(worldRef.current, "Ручное сохранение", "manual"); setSaves(await repository.list()); setNotice("Мир сохранён"); } finally { setBusy(false); } };
  const load = async () => { const target = saves[0]; if (!target) return; setBusy(true); try { worldRef.current = await repository.load(target.id); commit(); setNotice("Сохранение загружено"); } finally { setBusy(false); } };
  const reset = () => { if (!window.confirm("Создать новый мир?")) return; worldRef.current = createWorld(); commit(); setPlaying(false); setShowOnboarding(true); setNotice("Новый мир создан"); };
  const profile = (name: string, profileId: string) => { setPlayerProfile(worldRef.current, name, profileId); commit(); try { localStorage.setItem("economic-world-onboarded-v2", "1"); } catch { /* недоступно */ } setShowOnboarding(false); };
  const checkUpdate = async () => { setUpdateState("checking"); setUpdateState(await checkForUpdate()); };
  const updateNow = async (force = false) => { setUpdateState("applying"); try { await applyAppUpdate(saveActiveNow, force); } catch { setUpdateState("error"); } };
  const passing = useMemo(() => checkInvariants(world).every((item) => item.ok), [world]);

  return <>
    {showBoot && <BootSequence onComplete={completeBoot} />}
    {!showBoot && showOnboarding && <Onboarding world={world} complete={profile} />}
    {restoring && <div className="restore-screen"><span>Восстановление мира…</span></div>}
    <WhyModal value={why} close={() => setWhy(null)} />
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>EW</span><div><b>ECONOMIC WORLD</b><small>Экономическая система</small></div></div>
        <nav>{NAV.map((item, index) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><span>{String(index + 1).padStart(2, "0")}</span>{item.label}</button>)}</nav>
        <footer><i className={passing ? "ok" : "fail"} /><span>{passing ? "Система в норме" : "Есть нарушение"}</span></footer>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="date"><span>Дата мира</span><strong>{formatSimulationDate(world.clock)}</strong></div>
          <div className="simulation-controls"><button onClick={() => { stepMonth(worldRef.current); commit(); setNotice("Выполнен 1 месяц"); }} disabled={busy || restoring}>+1 месяц</button><button className="primary" onClick={() => setPlaying((value) => !value)} disabled={busy || restoring}>{playing ? "Пауза" : "Запуск"}</button><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Скорость" disabled={restoring}><option value="1">1 мес./с</option><option value="3">3 мес./с</option><option value="12">12 мес./с</option></select></div>
          <div className="world-actions"><button onClick={save} disabled={busy}>Сохранить</button><button onClick={load} disabled={busy || !saves.length}>Загрузить</button><button onClick={reset} disabled={busy}>Новый мир</button></div>
        </header>
        <div className="quick-run"><span>{busy ? `Расчёт · ${progress}%` : notice}</span><div><button onClick={() => advance(12)} disabled={busy}>+1 год</button><button onClick={() => advance(240)} disabled={busy}>+20 лет</button></div>{busy && <i style={{ width: `${progress}%` }} />}</div>
        <main>
          {view === "life" && <MyLife world={world} openWhy={openWhy} />}
          {view === "world" && <World world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "career" && <Career world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "education" && <Education world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "finances" && <MyFinances world={world} commit={commit} openWhy={openWhy} />}
          {view === "economy" && <Economy world={world} openWhy={openWhy} />}
          {view === "companies" && <Companies world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "markets" && <Markets world={world} commit={commit} notify={setNotice} />}
          {view === "portfolio" && <Portfolio world={world} />}
          {view === "banks" && <Banks world={world} openWhy={openWhy} />}
          {view === "ledger" && <Ledger world={world} openWhy={openWhy} />}
          {view === "control" && <Control world={world} />}
          {view === "settings" && <Settings repository={repository} updateState={updateState} autosaveState={autosaveState} checkUpdate={() => { void checkUpdate(); }} updateNow={() => { void updateNow(false); }} forceUpdate={() => { void updateNow(true); }} />}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Основные разделы">{MOBILE_PRIMARY.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => { setView(item.id); setMoreOpen(false); }}>{item.label}</button>)}<button className={MOBILE_MORE.some((item) => item.id === view) ? "active" : ""} onClick={() => setMoreOpen(true)}>Ещё</button></nav>
      {moreOpen && <div className="more-layer" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setMoreOpen(false); }}><section className="more-sheet" role="dialog" aria-modal="true" aria-label="Все разделы" onPointerDown={(event) => { moreDragStart.current = event.clientY; }} onPointerUp={(event) => { if (moreDragStart.current !== null && event.clientY - moreDragStart.current > 70) setMoreOpen(false); moreDragStart.current = null; }}><header><h2>Разделы</h2><button aria-label="Закрыть" onClick={() => setMoreOpen(false)}>×</button></header><div>{MOBILE_MORE.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => { setView(item.id); setMoreOpen(false); }}><span>{item.label}</span><small>Открыть</small></button>)}</div></section></div>}
    </div>
  </>;
}
