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
import { SaveRepository, type SaveManifest } from "../persistence/save-repository.ts";
import { acceptJobOffer, applyForJob, availableOccupations, resignPlayerJob, setPlayerProfile, setPlayerSavingsTarget } from "../player/commands.ts";
import { playerFinancialSummary, playerHousehold, playerPerson, SKILL_LABELS, tracePlayerMoney } from "../player/system.ts";
import { applyUniversity, buyDurable, buyProperty, enrollUniversity, rentProperty, sellDurable, startTravel, travelOptions } from "../player/world-commands.ts";
import { BootSequence } from "./BootSequence.tsx";
import { DeltaSparkline, LineAreaChart, MarketBars } from "./charts.tsx";

type View = "life" | "world" | "career" | "education" | "finances" | "economy" | "banks" | "ledger" | "control";

const NAV: Array<{ id: View; label: string; short: string }> = [
  { id: "life", label: "Моя жизнь", short: "Жизнь" },
  { id: "world", label: "Мир", short: "Мир" },
  { id: "career", label: "Карьера", short: "Карьера" },
  { id: "education", label: "Институты", short: "Вузы" },
  { id: "finances", label: "Мои финансы", short: "Финансы" },
  { id: "economy", label: "Экономика", short: "Экономика" },
  { id: "banks", label: "Банки", short: "Банки" },
  { id: "ledger", label: "Общий реестр", short: "Реестр" },
  { id: "control", label: "Контроль", short: "Контроль" },
];

const TX_LABELS: Record<TransactionKind, string> = {
  GENESIS: "Начальный баланс", TRANSFER: "Перевод", WAGE: "Зарплата", INCOME_TAX: "Налог на доход", SALES_TAX: "Налог с продаж", CORPORATE_TAX: "Налог на прибыль", SOCIAL_TRANSFER: "Социальная выплата", GOODS_CLEARING: "Покупка товара", INPUT_PURCHASE: "Закупка сырья", CAPITAL_CONTRIBUTION: "Вклад в капитал", LOAN_ISSUED: "Выдача кредита", LOAN_INTEREST: "Проценты по кредиту", LOAN_PRINCIPAL: "Погашение кредита", LOAN_DEFAULT: "Дефолт", INVENTORY_SEED: "Начальные запасы", INVENTORY_TRANSFER: "Передача запасов", COGS: "Себестоимость продаж", PRODUCTION: "Производство", DEPRECIATION: "Амортизация", CAPITAL_INVESTMENT: "Капитальные вложения", ACCOUNTING_CLOSE: "Закрытие периода", INTERBANK_LOAN: "Межбанковский кредит", CENTRAL_BANK_FACILITY: "Кредит центрального банка", EDUCATION: "Краткий курс", UNIVERSITY_TUITION: "Оплата вуза", COHORT_INCOME: "Доход когорты", COHORT_CONSUMPTION: "Потребление когорты", MATERIALIZATION: "Материализация", DEMATERIALIZATION: "Дематериализация", TRAVEL: "Поездка", RENT: "Аренда", PROPERTY_PURCHASE: "Покупка жилья", DURABLE_PURCHASE: "Покупка актива", USED_ASSET: "Подержанный актив", LOGISTICS: "Логистика",
};

const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const money = (cents: number) => rubles.format(cents / 100);
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
    ?? (id === world.government.id ? "Правительство" : id === world.centralBank.id ? world.centralBank.name : id === "academy-provider" ? "Дополнительное обучение" : id);
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
  return <article className="kpi"><header><span>{label}</span>{why && <WhyButton title={label} text={why} open={open} />}</header><strong>{value}</strong><footer><small>{note ?? ""}</small>{values && <DeltaSparkline values={values} accent="mint" ariaLabel={`Динамика: ${label}`} />}</footer></article>;
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
  return <article className="panel"><header className="panel-title"><h2>Компании</h2><span>{world.companies.filter((item) => item.active).length} работают</span></header><div className="responsive-table"><table><thead><tr><th>Компания</th><th>Рынок</th><th>Статус</th><th>Штат</th><th>Деньги</th><th>Выручка</th><th>Прибыль</th></tr></thead><tbody>{world.companies.map((company) => { const report = company.financialReports.at(-1); return <tr key={company.id}><td><b>{company.name}</b><small>{company.id}</small></td><td>{world.goods.find((item) => item.id === company.goodId)?.shortName}</td><td><span className={`pill ${company.active && !company.distressMonths ? "ok" : "warn"}`}>{company.active ? company.distressMonths ? "Риск" : "Работает" : "Закрыта"}</span></td><td>{company.employees.length}</td><td>{compactMoney(depositOf(world, company.id))}</td><td>{compactMoney(company.lastGrossRevenueCents)}</td><td>{compactMoney(report?.netIncomeCents ?? 0)}</td></tr>; })}</tbody></table></div></article>;
}

function Banks({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  return <><Section title="Банки" meta={`${world.loans.filter((item) => item.status === "active").length} активных кредитов`} /><section className="bank-grid">{world.banks.map((bank) => { const book = entityBook(world, bank.id); const reserves = balanceOf(world, accountIds.bankReserve(bank.id)); const deposits = Object.values(world.ledger.accounts).filter((account) => account.ownerId === bank.id && account.category === "liability" && account.instrument === "deposit").reduce((sum, account) => sum + balanceOf(world, account.id), 0); const loans = world.loans.filter((loan) => loan.lenderBankId === bank.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0); return <article className="panel bank-card" key={bank.id}><header><div><span>Коммерческий банк</span><h2>{bank.name}</h2></div><WhyButton title={bank.name} text="Капитал поглощает убытки, а ликвидность нужна для межбанковских расчётов. Это разные ограничения кредитования." open={openWhy} /></header><dl><div><dt>Капитал</dt><dd>{compactMoney(book.capital)}</dd></div><div><dt>Норматив капитала</dt><dd>{percent(bankCapitalRatioBps(world, bank.id))}</dd></div><div><dt>Ликвидность</dt><dd>{compactMoney(reserves)}</dd></div><div><dt>Коэффициент ликвидности</dt><dd>{percent(bankLiquidityRatioBps(world, bank.id))}</dd></div><div><dt>Депозиты</dt><dd>{compactMoney(deposits)}</dd></div><div><dt>Кредитный портфель</dt><dd>{compactMoney(loans)}</dd></div></dl></article>; })}</section><article className="panel policy"><header className="panel-title"><h2>Центральный банк</h2><span>{world.centralBank.name}</span></header><div><Kpi label="Ключевая ставка" value={percent(world.centralBank.policyRateBps)} note="Пересмотр раз в квартал" open={openWhy} /><Kpi label="Цель инфляции" value={percent(world.centralBank.inflationTargetBps)} note="Годовой темп" open={openWhy} /><Kpi label="Кредиты ликвидности" value={world.bankFunding.filter((item) => item.kind === "central-bank" && item.status === "active").length.toString()} note="Активные договоры" open={openWhy} /></div></article></>;
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
  const [showBoot, setShowBoot] = useState(initialBoot);
  const [showOnboarding, setShowOnboarding] = useState(initialOnboarding);
  const [why, setWhy] = useState<{ title: string; text: string } | null>(null);
  const [notice, setNotice] = useState("Готово");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saves, setSaves] = useState<SaveManifest[]>([]);
  const repository = useMemo(() => new SaveRepository(), []);
  const commit = useCallback(() => { setWorld({ ...worldRef.current }); }, []);
  const completeBoot = useCallback(() => { try { sessionStorage.setItem("economic-world-booted-v2", "1"); } catch { /* недоступно */ } setShowBoot(false); }, []);
  const openWhy = useCallback((title: string, text: string) => setWhy({ title, text }), []);

  useEffect(() => { repository.list().then(setSaves).catch(() => setSaves([])); }, [repository]);
  useEffect(() => { if (!playing || busy) return; const timer = window.setInterval(() => { runMonths(worldRef.current, speed); commit(); }, 1_000); return () => window.clearInterval(timer); }, [playing, busy, speed, commit]);

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
  const passing = useMemo(() => checkInvariants(world).every((item) => item.ok), [world]);

  return <>
    {showBoot && <BootSequence onComplete={completeBoot} />}
    {!showBoot && showOnboarding && <Onboarding world={world} complete={profile} />}
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
          <div className="simulation-controls"><button onClick={() => { stepMonth(worldRef.current); commit(); setNotice("Выполнен 1 месяц"); }} disabled={busy}>+1 месяц</button><button className="primary" onClick={() => setPlaying((value) => !value)} disabled={busy}>{playing ? "Пауза" : "Запуск"}</button><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Скорость"><option value="1">1 мес./с</option><option value="3">3 мес./с</option><option value="12">12 мес./с</option></select></div>
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
          {view === "banks" && <Banks world={world} openWhy={openWhy} />}
          {view === "ledger" && <Ledger world={world} openWhy={openWhy} />}
          {view === "control" && <Control world={world} />}
        </main>
      </div>
      <nav className="mobile-nav">{NAV.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}>{item.short}</button>)}</nav>
    </div>
  </>;
}
