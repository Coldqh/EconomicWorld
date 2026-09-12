import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSimulationDate } from "../core/clock.ts";
import { accountIds, balanceOf, bankAccountBalance, bankAccountsForOwner, depositOf, entityBook, openBankAccount, setPrimaryBankAccount } from "../core/ledger.ts";
import { createWorld } from "../economy/create-world.ts";
import { explanationText, whyFor } from "../economy/why-engine.ts";
import { checkInvariants } from "../economy/invariants.ts";
import { runSimulationOffThread, type SimulationRun } from "../economy/simulation-client.ts";
import { bankCapitalRatioBps } from "../finance/credit.ts";
import { bankLiquidityRatioBps } from "../finance/liquidity.ts";
import type { LedgerTransaction, TransactionKind, WorldState } from "../domain/model.ts";
import { SaveRepository, type PersistenceDiagnostics, type SaveManifest } from "../persistence/save-repository.ts";
import { acceptJobOffer, applyForJob, availableOccupations, graduateSalaryBonusBps, resignPlayerJob, setPlayerFoodPlan, setPlayerProfile, setPlayerReportingCurrency, setPlayerSavingsTarget } from "../player/commands.ts";
import { playerFinancialSummary, playerHousehold, playerMonthCashFlow, playerPerson, SKILL_LABELS, tracePlayerMoney } from "../player/system.ts";
import { applyUniversity, buyDurable, buyProperty, enrollUniversity, rentProperty, sellDurable, startTravel, travelOptions } from "../player/world-commands.ts";
import { hasHigherEducation, isStateFundedFirstDegree, studentJourney, studentMonthlySupportCents } from "../player/student-journey.ts";
import { BootSequence } from "./BootSequence.tsx";
import { LineAreaChart, MiniTrendChart, TradingChart, YieldCurveChart } from "./charts.tsx";
import { companyValuation, declareDividend, issueBond, ownershipBps, raiseEquity } from "../corporate/finance.ts";
import { bidPlayerAuction, buyPlayerInsurance, callPlayerPeCapital, createPlayerPeFund, filePlayerInsuranceClaim, financePlayerCompany, incorporatePlayerCompany, initiatePlayerAcquisition, initiatePlayerIPO, sourceAndStartPlayerPeDeal, startPlayerPeExit } from "../player/economic-gameplay.ts";
import { openBrokerageAccount, placeOrder, portfolioSummary } from "../markets/exchange.ts";
import { formatCompactMoney, formatMoney } from "../finance/currencies.ts";
import { executeFxConversion, quoteFxConversion, valueInReportingCurrency } from "../finance/fx-market.ts";
import { calculateFundNav, subscribeFund } from "../finance/institutional.ts";
import { buyToCover, marginAccountState, openMarginAccount, placeMarginBuy, placeShortSale } from "../finance/leverage.ts";
import { APP_BUILD, applyAppUpdate, checkForUpdate, registerAppServiceWorker, serviceWorkerDiagnostics, type UpdateState } from "../pwa/update-manager.ts";
import { FEATURE_UNLOCKS, featureAccess, isFeatureActionable, isFeatureVisible, nextUnlocks, reputationTier, setInterfacePreference, xpRequiredForLevel } from "../player/progression.ts";

type View = "life" | "world" | "career" | "education" | "finances" | "progression" | "information" | "economy" | "global" | "geoeconomics" | "political-economy" | "defense" | "lab" | "companies" | "markets" | "portfolio" | "banks" | "ledger" | "control" | "settings";

const GeoeconomicsPanel = lazy(() => import("./phase-panels/GeoeconomicsPanel.tsx"));
const PoliticalEconomyPanel = lazy(() => import("./phase-panels/PoliticalEconomyPanel.tsx"));
const EconomicLabPanel = lazy(() => import("./phase-panels/EconomicLabPanel.tsx"));
const DiagnosticsPanel = lazy(() => import("./phase-panels/DiagnosticsPanel.tsx"));
const DefenseConflictPanel = lazy(() => import("./phase-panels/DefenseConflictPanel.tsx"));
const AdvancedMarketsPanel = lazy(() => import("./phase-panels/AdvancedMarketsPanel.tsx"));

const NAV: Array<{ id: View; label: string; short: string }> = [
  { id: "life", label: "Моя жизнь", short: "Жизнь" },
  { id: "world", label: "Мир", short: "Мир" },
  { id: "career", label: "Карьера", short: "Карьера" },
  { id: "education", label: "Институты", short: "Вузы" },
  { id: "finances", label: "Мои финансы", short: "Финансы" },
  { id: "progression", label: "Профиль", short: "Профиль" },
  { id: "information", label: "Данные и оценки", short: "Данные" },
  { id: "economy", label: "Экономика", short: "Экономика" },
  { id: "global", label: "Мировая экономика", short: "Мир" },
  { id: "geoeconomics", label: "Геоэкономика", short: "Гео" },
  { id: "political-economy", label: "Институты и власть", short: "Институты" },
  { id: "defense", label: "Оборона и конфликты", short: "Оборона" },
  { id: "lab", label: "Экономическая лаборатория", short: "Лаборатория" },
  { id: "companies", label: "Компании", short: "Компании" },
  { id: "markets", label: "Рынки", short: "Рынки" },
  { id: "portfolio", label: "Портфель", short: "Портфель" },
  { id: "banks", label: "Банки", short: "Банки" },
  { id: "ledger", label: "Общий реестр", short: "Реестр" },
  { id: "control", label: "Контроль", short: "Контроль" },
  { id: "settings", label: "Настройки", short: "Настройки" },
];

const MOBILE_PRIORITY: View[] = ["life", "career", "finances", "world", "markets", "companies", "economy", "progression"];

const TX_LABELS: Record<TransactionKind, string> = {
  GENESIS: "Начальный баланс", TRANSFER: "Перевод", WAGE: "Зарплата", INCOME_TAX: "Налог на доход", SALES_TAX: "Налог с продаж", CORPORATE_TAX: "Налог на прибыль", SOCIAL_TRANSFER: "Социальная выплата", GOODS_CLEARING: "Покупка товара", INPUT_PURCHASE: "Закупка сырья", CAPITAL_CONTRIBUTION: "Вклад в капитал", LOAN_ISSUED: "Выдача кредита", LOAN_INTEREST: "Проценты по кредиту", LOAN_PRINCIPAL: "Погашение кредита", LOAN_DEFAULT: "Дефолт", INVENTORY_SEED: "Начальные запасы", INVENTORY_TRANSFER: "Передача запасов", COGS: "Себестоимость продаж", PRODUCTION: "Производство", DEPRECIATION: "Амортизация", CAPITAL_INVESTMENT: "Капитальные вложения", ASSET_IMPAIRMENT: "Обесценение актива", ACCOUNTING_CLOSE: "Закрытие периода", INTERBANK_LOAN: "Межбанковский кредит", CENTRAL_BANK_FACILITY: "Кредит центрального банка", EDUCATION: "Краткий курс", UNIVERSITY_TUITION: "Оплата вуза", COHORT_INCOME: "Доход когорты", COHORT_CONSUMPTION: "Потребление когорты", MATERIALIZATION: "Материализация", DEMATERIALIZATION: "Дематериализация", TRAVEL: "Поездка", RENT: "Аренда", PROPERTY_PURCHASE: "Покупка жилья", DURABLE_PURCHASE: "Покупка актива", USED_ASSET: "Подержанный актив", LOGISTICS: "Логистика",
  EQUITY_ISSUE: "Выпуск акций", EQUITY_SECONDARY: "Сделка с акциями", DIVIDEND: "Дивиденд", BOND_ISSUE: "Выпуск облигаций", BOND_COUPON: "Купон", BOND_REPAYMENT: "Погашение облигации", ACQUISITION: "Поглощение", IPO: "Первичное размещение", BROKER_DEPOSIT: "Брокерский счёт", MARKET_TRADE: "Биржевая сделка", BROKER_FEE: "Комиссия брокера", EXCHANGE_FEE: "Комиссия биржи", BANKRUPTCY_DISTRIBUTION: "Распределение при банкротстве", SECURITY_REVALUATION: "Переоценка ценной бумаги",
  FX_TRADE: "Валютная сделка", FUND_SUBSCRIPTION: "Подписка на фонд", FUND_REDEMPTION: "Погашение паёв", MANAGEMENT_FEE: "Комиссия за управление", PERFORMANCE_FEE: "Комиссия за результат", PENSION_CONTRIBUTION: "Пенсионный взнос", ETF_CREATION: "Создание паёв биржевого фонда", ETF_REDEMPTION: "Погашение паёв биржевого фонда", UNDERWRITING_FEE: "Комиссия андеррайтера", MARGIN_FINANCE: "Маржинальное финансирование", MARGIN_REPAYMENT: "Погашение маржи", SECURITIES_BORROW: "Заём бумаг", BORROW_FEE: "Комиссия за заём", DIVIDEND_COMPENSATION: "Компенсация дивиденда", REPO_OPEN: "Открытие репо", REPO_REPAYMENT: "Погашение репо", COLLATERAL_PLEDGE: "Залог", PRIME_BROKER_LOSS: "Убыток прайм-брокера",
  PROPERTY_TAX: "Налог на имущество", DERIVATIVE_PREMIUM: "Премия по деривативу", DERIVATIVE_SETTLEMENT: "Расчёт по деривативу", FUTURES_INITIAL_MARGIN: "Начальная маржа", FUTURES_VARIATION_MARGIN: "Вариационная маржа", SWAP_SETTLEMENT: "Расчёт по свопу", TRS_SETTLEMENT: "Расчёт по свопу совокупного дохода", CDS_PREMIUM: "Премия по кредитной защите", CDS_SETTLEMENT: "Выплата кредитной защиты", FX_FORWARD_SETTLEMENT: "Расчёт по валютному форварду", DERIVATIVE_DEFAULT: "Дефолт по деривативу",
  SOVEREIGN_ISSUE: "Выпуск госдолга", SOVEREIGN_COUPON: "Купон по госдолгу", SOVEREIGN_REPAYMENT: "Погашение госдолга", SOVEREIGN_RESTRUCTURE: "Реструктуризация госдолга", SOVEREIGN_WRITE_DOWN: "Списание госдолга", PUBLIC_INVESTMENT: "Государственные инвестиции", TARIFF: "Таможенный тариф", SUBSIDY: "Субсидия", FOREIGN_AID: "Внешняя помощь", SOVEREIGN_LOAN: "Суверенный кредит", PROCUREMENT: "Госзакупка", CORRUPTION_LEAKAGE: "Утечка средств", LOBBYING: "Лоббирование", OPEN_MARKET_PURCHASE: "Покупка на открытом рынке", OPEN_MARKET_SALE: "Продажа на открытом рынке", QE: "Количественное смягчение", QT: "Количественное ужесточение", DEPOSIT_INSURANCE: "Страхование вкладов",
  INSURANCE_PREMIUM: "Страховая премия", INSURANCE_CLAIM: "Страховая выплата", REINSURANCE_PREMIUM: "Перестрахование", AUCTION_SETTLEMENT: "Расчёт по аукциону",
};

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const money = (amountMinor: number, currencyId = "RUB") => formatMoney(amountMinor, currencyId);
const currencyMoney = (amountMinor: number, currencyId: string) => formatMoney(amountMinor, currencyId);
const compactMoney = (amountMinor: number, currencyId = "RUB") => formatCompactMoney(amountMinor, currencyId);
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const EDUCATION_LABELS: Record<string, string> = { basic: "основное", secondary: "среднее", bachelor: "бакалавриат", master: "магистратура", doctorate: "докторантура" };
const TIMEFRAME_LABELS = { "1M": "1М", "6M": "6М", "1Y": "1Г", "5Y": "5Л", "ALL": "ВСЁ" } as const;
const STATUS_LABELS: Record<string, string> = {
  active: "активен", repaid: "погашен", defaulted: "дефолт", sourcing: "поиск цели", diligence: "проверка",
  owned: "в портфеле", "covenant-breach": "нарушение ковенант", exited: "выход завершён", failed: "неуспешно",
  reported: "заявлен", reserved: "зарезервирован", paid: "выплачен", denied: "отказано", open: "открыт",
  closed: "закрыт", settled: "рассчитан", proposed: "предложен", approved: "одобрен", rejected: "отклонён",
};
const AUCTION_TYPE_LABELS: Record<string, string> = {
  "sovereign-bond": "государственная облигация", procurement: "госзакупка", privatization: "приватизация",
  "bankruptcy-asset": "актив банкрота", license: "лицензия", company: "компания",
};
const AUCTION_MECHANISM_LABELS: Record<string, string> = {
  english: "английский", dutch: "голландский", "first-price": "первой цены", "reverse-first-price": "обратной первой цены",
  vickrey: "Викри", "uniform-price": "единой цены", "pay-as-bid": "по цене заявки",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

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
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!value) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { window.removeEventListener("keydown", handler); previouslyFocused?.focus(); };
  }, [value, close]);
  if (!value) return null;
  return <div className="modal-layer" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={dialogRef} className="why-modal" role="dialog" aria-modal="true" aria-labelledby="why-title" aria-describedby="why-description"><header><h2 id="why-title">{value.title}</h2><button onClick={close} aria-label="Закрыть">×</button></header><p id="why-description">{value.text}</p><button className="primary" onClick={close}>Понятно</button></section></div>;
}

function Kpi({ label, value, note, values, why, open }: { label: string; value: string; note?: string; values?: number[]; why?: string; open: (title: string, text: string) => void }) {
  return <article className="kpi"><header><span>{label}</span>{why && <WhyButton title={label} text={why} open={open} />}</header><strong>{value}</strong><footer><small>{note ?? ""}</small>{values && <MiniTrendChart values={values} format={compactMoney} accent="mint" ariaLabel={`Динамика: ${label}`} />}</footer></article>;
}

function MyLife({ world, commit, notify, openWhy, navigate }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void; navigate: (view: View) => void }) {
  const [tab, setTab] = useState<"lifestyle" | "housing" | "assets" | "shop">("lifestyle");
  const summary = playerFinancialSummary(world);
  const person = playerPerson(world);
  const household = playerHousehold(world);
  const company = world.companies.find((item) => item.id === household.employerId);
  const occupation = world.occupations.find((item) => item.id === person.occupationId);
  const city = world.cities.find((item) => item.id === world.player.currentCityId);
  const enrollment = world.player.activeUniversityEnrollment;
  const program = enrollment && world.universityPrograms.find((item) => item.id === enrollment.programId);
  const history = world.player.monthlyHistory.slice(-24);
  const currency = world.countries.find((country) => country.id === city?.countryId)?.currencyReference ?? "RUB";
  const netWorth = valueInReportingCurrency(world, world.player.householdId, world.player.reportingCurrencyId);
  const housing = world.housingCohorts.filter((cohort) => cohort.cityId === city?.id);
  const assets = world.player.durableAssetIds.map((id) => world.durableAssets.find((asset) => asset.id === id)).filter(Boolean);
  const plans = [["minimal", "Минимальный", 12], ["basic", "Базовый", 18], ["good", "Хороший", 27], ["premium", "Премиальный", 40]] as const;
  const journey = studentJourney(world);
  const journeyComplete = journey.every((step) => step.complete);
  return <>
    <Section title="Моя жизнь" meta={`${summary.age} лет · ${formatSimulationDate(world.clock)}`} />
    <section className="hero-state"><div><span>{city?.name ?? "В пути"}</span><h2>{occupation?.name ?? (program ? "Студент" : hasHigherEducation(world) ? "Выпускник" : "Абитуриент")}</h2><p>{company?.name ?? program?.name ?? (hasHigherEducation(world) ? "Нет работодателя" : "Выберите институт")}</p></div><div className="hero-balance"><span>Капитал · {world.player.reportingCurrencyId}</span><strong>{compactMoney(netWorth.totalMinor, world.player.reportingCurrencyId)}</strong></div></section>
    {!journeyComplete && <article className="panel student-journey"><header className="panel-title"><div><span>ВВЕДЕНИЕ В ИГРУ</span><h2>Студенческий путь</h2></div><button className="primary" onClick={() => navigate(hasHigherEducation(world) ? "career" : "education")}>{hasHigherEducation(world) ? "Перейти к карьере" : "Перейти к институтам"}</button></header><div>{journey.map((step, index) => <section className={`${step.complete ? "complete" : ""} ${step.current ? "current" : ""}`} key={step.id}><i>{step.complete ? "✓" : index + 1}</i><span><b>{step.title}</b><small>{step.detail}</small></span></section>)}</div></article>}
    <div className="compact-tabs">{[["lifestyle", "Образ жизни"], ["housing", "Жильё"], ["assets", "Мои активы"], ["shop", "Магазин"]].map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</div>
    {tab === "lifestyle" && <><section className="kpi-grid four"><Kpi label="Основной счёт" value={compactMoney(summary.depositsCents, currency)} note={currency} values={history.map((item) => item.netWorthCents)} open={openWhy} /><Kpi label="Доход" value={compactMoney(summary.incomeCents, currency)} note={company?.name ?? "Нет зарплаты"} open={openWhy} /><Kpi label="Расходы" value={compactMoney(summary.expensesCents, currency)} note="Фактические списания" open={openWhy} /><Kpi label="Валютная переоценка" value={compactMoney(netWorth.translationEffectMinor, world.player.reportingCurrencyId)} note="Иностранные активы" open={openWhy} /></section><article className="panel food-plan"><header className="panel-title"><h2>Рацион</h2><span>Ежемесячно по местной цене</span></header><div>{plans.map(([id, label, quantity]) => <button className={world.player.foodPlanId === id ? "active" : ""} key={id} onClick={() => { setPlayerFoodPlan(world, id); commit(); notify(`Рацион: ${label}`); }}><b>{label}</b><small>{quantity} корзин · местный рынок</small></button>)}</div></article></>}
    {tab === "housing" && <article className="panel"><header className="panel-title"><h2>Жильё · {city?.name}</h2><span>{world.player.residencePropertyId ? "Выбрано" : "Не выбрано"}</span></header><div className="asset-grid">{housing.map((cohort) => <div className="asset-card" key={cohort.id}><span>{cohort.type === "rental-apartment" ? "Арендная квартира" : cohort.type === "owned-apartment" ? "Квартира" : "Дом"}</span><strong>{cohort.averageSizeSqm} м²</strong><small>{cohort.availableUnits} свободно</small><div><button disabled={Boolean(world.player.residencePropertyId)} onClick={() => { const ok = rentProperty(world, cohort.id); commit(); notify(ok ? "Жильё арендовано" : "Аренда недоступна"); }}>Аренда {compactMoney(cohort.monthlyRentCents, currency)}</button><button disabled={depositOf(world, world.player.householdId) < cohort.salePriceCents} onClick={() => { const ok = buyProperty(world, cohort.id); commit(); notify(ok ? "Недвижимость куплена" : "Покупка недоступна"); }}>Купить {compactMoney(cohort.salePriceCents, currency)}</button></div></div>)}</div></article>}
    {tab === "assets" && <article className="panel goods-panel"><header className="panel-title"><h2>Активы</h2><span>{assets.length}</span></header>{assets.length ? <div className="owned-assets">{assets.map((asset) => { if (!asset) return null; const product = world.products.find((item) => item.id === asset.productId); return <div key={asset.id}><span>{product?.name}</span><b>Состояние {percent(asset.conditionBps)}</b><button onClick={() => { const ok = sellDurable(world, asset.id, "household-002"); commit(); notify(ok ? "Актив продан" : "Покупатель не оплатил"); }}>Продать · {compactMoney(asset.resaleValueCents, currency)}</button></div>; })}</div> : <p className="empty">Покупок пока нет.</p>}</article>}
    {tab === "shop" && <article className="panel goods-panel"><header className="panel-title"><h2>Магазин</h2><span>Покупки только вручную</span></header><div className="asset-grid">{world.products.map((product) => { const seller = world.companies.find((item) => item.id === product.sellerId); const productCurrency = world.countries.find((country) => country.id === seller?.headquartersCountryId)?.currencyReference ?? currency; return <div className="asset-card" key={product.id}><span>{product.brand}</span><strong>{product.name}</strong><small>Качество {number.format(product.qualityBps / 100)}</small><button disabled={productCurrency !== currency || depositOf(world, world.player.householdId) < product.priceCents} onClick={() => { const ok = buyDurable(world, product.id); commit(); notify(ok ? "Покупка завершена" : `Нужен счёт в ${productCurrency}`); }}>{compactMoney(product.priceCents, productCurrency)}</button></div>; })}</div></article>}
    <section className="two-column"><article className="panel"><header className="panel-title"><h2>Капитал по месяцам</h2><WhyButton title="Капитал" text="Активы за вычетом обязательств." open={openWhy} /></header><LineAreaChart values={history.map((item) => item.netWorthCents)} labels={history.map((item) => `${item.elapsedMonth + 1}м`)} format={(value) => compactMoney(value, currency)} ariaLabel="Капитал игрока" /></article><article className="panel"><header className="panel-title"><h2>История</h2><span>{world.player.timeline.length}</span></header><div className="timeline">{world.player.timeline.slice(-8).reverse().map((item) => <div key={item.id}><i /><span><b>{item.title}</b><small>{item.detail} · {item.elapsedMonth + 1}м</small></span></div>)}{!world.player.timeline.length && <p className="empty">Событий нет.</p>}</div></article></section>
  </>;
}

function Career({ world, commit, notify, openWhy, navigate }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void; navigate: (view: View) => void }) {
  const person = playerPerson(world);
  const household = playerHousehold(world);
  const employer = world.companies.find((item) => item.id === household.employerId);
  const occupation = world.occupations.find((item) => item.id === person.occupationId);
  const vacancies = world.companies.filter((item) => item.active).flatMap((company) => availableOccupations(world, company.id).slice(0, 2).map((job) => ({ company, job })));
  const currentCountryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const salaryCurrency = world.countries.find((country) => country.id === currentCountryId)?.currencyReference ?? "RUB";
  const salaryAccount = bankAccountsForOwner(world, household.id, salaryCurrency)[0];
  const careerReady = hasHigherEducation(world);
  const apply = (companyId: string, occupationId: string) => { const answer = applyForJob(world, companyId, occupationId); commit(); notify(answer.reason); };
  return <><Section title="Карьера" meta={employer ? `${occupation?.name} · ${employer.name}` : careerReady ? "Доступен поиск работы" : "Откроется после диплома"} />
    <section className="career-current panel"><div><span>Трудовой статус</span><h2>{occupation?.name ?? (careerReady ? "Выпускник" : "Студент")}</h2><p>{employer ? `${employer.name} · ${money(employer.wageCents, salaryCurrency)} в месяц` : careerReady ? "Выберите вакансию и отправьте заявку." : "Профессия определяется полученной специальностью. Сначала завершите институт."}</p></div>{!careerReady && <button className="primary" onClick={() => navigate("education")}>Перейти к институтам</button>}{employer && <button className="danger" onClick={() => { resignPlayerJob(world); commit(); notify("Трудовой договор завершён"); }}>Уволиться</button>}{world.player.pendingJobOffer && (salaryAccount ? <button className="primary" onClick={() => { const ok = acceptJobOffer(world); commit(); notify(ok ? "Предложение принято" : "Предложение недоступно"); }}>Принять предложение</button> : <button className="primary" onClick={() => { const bank = world.banks.find((item) => item.countryId === currentCountryId); const answer = bank ? openBankAccount(world, household.id, bank.id, true) : { ok: false, message: "Банк не найден" }; commit(); notify(answer.ok ? `Счёт ${salaryCurrency} открыт` : answer.message); }}>Открыть счёт {salaryCurrency}</button>)}</section>
    {careerReady ? <article className="panel"><header className="panel-title"><h2>Вакансии · текущий город</h2><WhyButton title="Решение работодателя" text="Специальность определяет доступные профессии. Качество института, навыки и конкуренция влияют на предложение и зарплату." open={openWhy} /></header><div className="responsive-table"><table><thead><tr><th>Должность</th><th>Компания</th><th>Зарплата</th><th>Ключевые навыки</th><th /></tr></thead><tbody>{vacancies.map(({ company, job }) => { const application = [...world.player.jobApplications].reverse().find((item) => item.companyId === company.id && item.occupationId === job.id); const diplomaBonus = graduateSalaryBonusBps(world, job.id); return <tr key={`${company.id}-${job.id}`}><td><b>{job.name}</b><small>{application ? `${application.status === "offered" ? "Предложение получено" : application.status === "rejected" ? "Отказ" : "Заявка отправлена"} · ${application.reason}` : `Диплом: +${number.format(diplomaBonus / 100)}% к предложению`}</small></td><td>{company.name}</td><td>{money(Math.round(company.wageCents * (0.88 + job.level * 0.11) * (10_000 + diplomaBonus) / 10_000), salaryCurrency)}</td><td>{Object.keys(job.requiredSkills).map((skill) => SKILL_LABELS[skill as keyof typeof SKILL_LABELS]).join(", ")}</td><td><button disabled={Boolean(household.employerId)} onClick={() => apply(company.id, job.id)}>Подать заявку</button></td></tr>; })}</tbody></table></div>{!vacancies.length && <p className="empty">Для этой специальности в текущем городе нет подходящих вакансий.</p>}</article> : <article className="panel career-locked"><h2>Вакансии пока закрыты</h2><p>Выбор программы определит доступные профессии. Экономика ведёт к аналитике и финансам, программная инженерия — к разработке, магистратура по финансам — к управлению капиталом.</p></article>}
    <article className="panel skills-panel"><header className="panel-title"><h2>Навыки</h2><span>0–100</span></header><div className="skill-grid">{Object.entries(person.skills).map(([id, value]) => <div key={id}><span>{SKILL_LABELS[id as keyof typeof SKILL_LABELS]}</span><strong>{number.format(value / 100)}</strong><i><b style={{ width: `${Math.min(100, value / 100)}%` }} /></i></div>)}</div></article>
  </>;
}

function Education({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const [browseAll, setBrowseAll] = useState(false);
  const [countryFilter, setCountryFilter] = useState("all");
  const [query, setQuery] = useState("");
  const active = world.player.activeUniversityEnrollment;
  const activeProgram = active && world.universityPrograms.find((program) => program.id === active.programId);
  const activeUniversity = active && world.universities.find((university) => university.id === active.universityId);
  const support = studentMonthlySupportCents(world);
  const institutions = [...world.universities].filter((university) => {
    const countryId = world.cities.find((city) => city.id === university.cityId)?.countryId;
    const matchesScope = browseAll ? countryFilter === "all" || countryId === countryFilter : university.cityId === world.player.currentCityId;
    const text = `${university.name} ${university.shortName} ${university.programIds.map((id) => world.universityPrograms.find((program) => program.id === id)?.name).join(" ")}`.toLowerCase();
    return matchesScope && text.includes(query.toLowerCase());
  }).sort((left, right) => right.reputationBps - left.reputationBps);
  return <><Section title="Институты и университеты" meta={`${world.universities.length} вузов · ${world.universityPrograms.length} программ`} />
    {active && <section className="education-current panel"><div><span>Текущее обучение</span><h2>{activeProgram?.name}</h2><p>{activeUniversity?.shortName} · {active.completedMonths}/{active.durationMonths} мес. · стипендия {compactMoney(support, world.player.reportingCurrencyId)}/мес.</p></div><strong>{Math.round(active.completedMonths * 100 / active.durationMonths)}%</strong></section>}
    <div className="filter-bar"><button className={!browseAll ? "active" : ""} onClick={() => setBrowseAll(false)}>В текущем городе</button><button className={browseAll ? "active" : ""} onClick={() => setBrowseAll(true)}>Все вузы</button>{browseAll && <select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}><option value="all">Все страны</option>{world.countries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}</select>}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск вуза или программы" /></div>
    <section className="institution-grid">{institutions.map((university) => { const city = world.cities.find((item) => item.id === university.cityId); const universityCurrency = world.countries.find((country) => country.id === city?.countryId)?.currencyReference ?? "RUB"; return <article className="panel institution" key={university.id}><header><div><span>{university.type === "institute" ? "Институт" : "Университет"} · {city?.name}</span><h2>{university.shortName}</h2><small>{university.name}</small></div><b>{number.format(university.reputationBps / 100)}</b></header><div className="program-list">{university.programIds.map((programId) => { const program = world.universityPrograms.find((item) => item.id === programId)!; const application = world.player.universityApplications.find((item) => item.programId === program.id); const completed = world.player.completedProgramIds.includes(program.id); const localRequired = program.attendanceMode === "ON_CAMPUS" && university.cityId !== world.player.currentCityId; const stateFunded = isStateFundedFirstDegree(world, program); const requirements = Object.entries(program.requiredSkills).map(([skill, value]) => `${SKILL_LABELS[skill as keyof typeof SKILL_LABELS]} ${number.format((value ?? 0) / 100)}`).join(" · "); return <div className="program" key={program.id}><div><h3>{program.name}</h3><span>{program.degree === "bachelor" ? "Бакалавриат" : program.degree === "master" ? "Магистратура" : "Докторантура"} · {program.durationMonths / 12} г. · {program.attendanceMode === "REMOTE" ? "Дистанционно" : "Очно"}</span></div><dl><div><dt>Финансирование</dt><dd>{stateFunded ? "Бюджетное место" : compactMoney(program.tuitionPerYearCents, universityCurrency) + "/год"}</dd></div><div><dt>Места</dt><dd>{program.capacity - program.occupiedSeats}/{program.capacity}</dd></div></dl><footer><WhyButton title="Условия поступления" text={`Минимальное образование: ${EDUCATION_LABELS[program.minimumEducation]}. Навыки: ${requirements}. Специальность и качество вуза влияют на доступные профессии и зарплатное предложение.`} open={openWhy} />{completed ? <span className="pill ok">Диплом</span> : application?.status === "admitted" ? localRequired ? <button onClick={() => notify(`Для начала обучения переезжайте в ${city?.name}. Откройте раздел «Мир».`)}>Спланировать переезд</button> : <button disabled={Boolean(active)} onClick={() => { const ok = enrollUniversity(world, program.id); commit(); notify(ok ? `Вы зачислены · ${stateFunded ? "бюджетное место" : "обучение оплачено"}` : `Для оплаты нужен счёт ${universityCurrency}`); }}>Зачислиться</button> : application?.status === "rejected" ? <span className="pill warn">Не пройден конкурс</span> : <button disabled={Boolean(active)} onClick={() => { const ok = applyUniversity(world, program.id); commit(); notify(ok ? `Поступление подтверждено${localRequired ? ` · переезжайте в ${city?.name}` : ""}` : "Заявка отклонена"); }}>Подать документы</button>}</footer></div>; })}</div></article>; })}</section>
  </>;
}

function World({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const current = world.cities.find((city) => city.id === world.player.currentCityId)!;
  const [countryId, setCountryId] = useState(current.countryId);
  const [cityId, setCityId] = useState(current.id);
  const selected = world.cities.find((city) => city.id === cityId) ?? current;
  const currentCurrency = world.countries.find((country) => country.id === current.countryId)?.currencyReference ?? "RUB";
  const selectedCurrency = world.countries.find((country) => country.id === selected.countryId)?.currencyReference ?? "RUB";
  const options = travelOptions(world, selected.id);
  return <><Section title="Мир" meta={`${world.countries.length} стран · ${world.cities.length} городов`} />
    <section className="world-layout"><article className="panel world-browser"><div className="country-tabs">{world.countries.map((country) => <button className={country.id === countryId ? "active" : ""} key={country.id} onClick={() => { setCountryId(country.id); const first = world.cities.find((city) => city.countryId === country.id); if (first) setCityId(first.id); }}>{country.name}</button>)}</div><div className="city-list">{world.cities.filter((city) => city.countryId === countryId).map((city) => <button className={city.id === cityId ? "active" : ""} key={city.id} onClick={() => setCityId(city.id)}><span>{city.name}{city.id === current.id && <i>Сейчас</i>}</span><strong>{compactMoney(city.costOfLivingCents, world.countries.find((country) => country.id === city.countryId)?.currencyReference ?? "RUB")}</strong></button>)}</div></article><article className="panel city-detail"><header><div><span>{world.countries.find((country) => country.id === selected.countryId)?.name}</span><h2>{selected.name}</h2></div><WhyButton title="Стоимость жизни" text="Рассчитывается из местных цен товаров и аренды. Доходы, занятость, свободное жильё и логистика обновляют показатели города." open={openWhy} /></header><dl><div><dt>Медианный доход</dt><dd>{compactMoney(selected.medianIncomeCents, selectedCurrency)}</dd></div><div><dt>Стоимость жизни</dt><dd>{compactMoney(selected.costOfLivingCents, selectedCurrency)}</dd></div><div><dt>Занятость</dt><dd>{percent(selected.employmentBps)}</dd></div><div><dt>Свободное жильё</dt><dd>{percent(selected.housingVacancyBps)}</dd></div></dl>{selected.id !== current.id && <div className="travel-options">{options.map((option) => <button key={option.mode} disabled={Boolean(world.player.activeTravel)} onClick={() => { const ok = startTravel(world, selected.id, option.mode, true); commit(); notify(ok ? "Переезд начался" : "Поездка недоступна"); }}><span>{option.mode === "air" ? "Самолёт" : option.mode === "rail" ? "Поезд" : "Автомобиль"}</span><b>{currencyMoney(option.priceCents, currentCurrency)}</b><small>{option.distanceKm.toLocaleString("ru-RU")} км · {option.durationDays} дн.</small></button>)}</div>}{selected.id === current.id && <span className="current-city">Текущее местоположение</span>}</article></section>
  </>;
}

function MyFinances({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const summary = playerFinancialSummary(world);
  const transactions = tracePlayerMoney(world);
  const history = world.player.monthlyHistory.slice(-24);
  const accounts = bankAccountsForOwner(world, world.player.householdId);
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState(10_000);
  const from = accounts.find((account) => account.id === fromId) ?? accounts[0];
  const to = accounts.find((account) => account.id === toId) ?? accounts.find((account) => account.id !== from?.id);
  const quote = from && to ? quoteFxConversion(world, from.currencyId, to.currencyId, amount) : null;
  const currentCountryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const localBanks = world.banks.filter((bank) => bank.countryId === currentCountryId);
  const netWorth = valueInReportingCurrency(world, world.player.householdId, world.player.reportingCurrencyId);
  const classifiedFlow = playerMonthCashFlow(world);
  const previousNetWorth = history.at(-2)?.netWorthCents ?? netWorth.totalMinor;
  const netWorthChange = netWorth.totalMinor - previousNetWorth;
  return <><Section title="Мои финансы" meta={`${accounts.length} банковских счетов`} /><section className="kpi-grid four"><Kpi label="Чистый капитал" value={compactMoney(netWorth.totalMinor, world.player.reportingCurrencyId)} note={`Отчётная валюта ${world.player.reportingCurrencyId}`} values={history.map((item) => item.netWorthCents)} open={openWhy} /><Kpi label="Доход" value={compactMoney(summary.incomeCents, from?.currencyId ?? "RUB")} note="Последний месяц" open={openWhy} /><Kpi label="Расходы" value={compactMoney(summary.expensesCents, from?.currencyId ?? "RUB")} note="Последний месяц" open={openWhy} /><Kpi label="Валютная переоценка" value={compactMoney(netWorth.translationEffectMinor, world.player.reportingCurrencyId)} note="Иностранные позиции" open={openWhy} /></section>
    <article className="panel"><header className="panel-title"><h2>Денежный поток</h2><span>{world.player.reportingCurrencyId}</span></header><dl className="metric-list"><div><dt>Жизнь и операции</dt><dd>{compactMoney(classifiedFlow.income - classifiedFlow.expenses, world.player.reportingCurrencyId)}</dd></div><div><dt>Инвестиции</dt><dd>{compactMoney(classifiedFlow.investing, world.player.reportingCurrencyId)}</dd></div><div><dt>Финансирование</dt><dd>{compactMoney(classifiedFlow.financing, world.player.reportingCurrencyId)}</dd></div><div><dt>Изменение денег</dt><dd>{compactMoney(classifiedFlow.netCashChange, world.player.reportingCurrencyId)}</dd></div><div><dt>Изменение капитала</dt><dd>{compactMoney(netWorthChange, world.player.reportingCurrencyId)}</dd></div></dl></article>
    <article className="panel bank-accounts"><header className="panel-title"><h2>Банковские счета</h2><select value={world.player.reportingCurrencyId} onChange={(event) => { setPlayerReportingCurrency(world, event.target.value); commit(); }} aria-label="Отчётная валюта">{world.currencies.map((currency) => <option key={currency.id}>{currency.id}</option>)}</select></header><div>{accounts.map((account) => { const bank = world.banks.find((item) => item.id === account.bankId); return <button className={account.isPrimary ? "active" : ""} key={account.id} onClick={() => { setPrimaryBankAccount(world, world.player.householdId, account.id); commit(); }}><span>{bank?.name}<small>{account.isPrimary ? "Основной" : "Сделать основным"}</small></span><strong>{formatMoney(bankAccountBalance(world, account.id), account.currencyId)}</strong></button>; })}</div><footer>{localBanks.map((bank) => <button key={bank.id} onClick={() => { const answer = openBankAccount(world, world.player.householdId, bank.id, true); commit(); notify(answer.message); }}>Открыть {bank.baseCurrency} · {bank.name}</button>)}</footer></article>
    <article className="panel fx-ticket"><header className="panel-title"><h2>Обмен валюты</h2><span>Спот · двойная проводка</span></header><div className="fx-fields"><label>Отдаёте<select value={from?.id ?? ""} onChange={(event) => setFromId(event.target.value)}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.currencyId} · {formatMoney(bankAccountBalance(world, account.id), account.currencyId)}</option>)}</select></label><label>Получаете<select value={to?.id ?? ""} onChange={(event) => setToId(event.target.value)}>{accounts.filter((account) => account.id !== from?.id).map((account) => <option value={account.id} key={account.id}>{account.currencyId}</option>)}</select></label><label>Сумма<input type="number" min="1" value={amount} onChange={(event) => setAmount(Math.max(1, Number(event.target.value)))} /></label></div>{quote ? <dl className="metric-list"><div><dt>Курс</dt><dd>{number.format(quote.ratePpm / 1_000_000)}</dd></div><div><dt>Спред</dt><dd>{percent(quote.spreadBps)}</dd></div><div><dt>Комиссия</dt><dd>{formatMoney(quote.feeMinor, quote.toCurrencyId)}</dd></div><div><dt>Вы получите</dt><dd>{formatMoney(quote.amountToMinor, quote.toCurrencyId)}</dd></div></dl> : <p className="empty">Откройте второй валютный счёт.</p>}<button className="primary" disabled={!from || !to || !quote} onClick={() => { if (!from || !to) return; const answer = executeFxConversion(world, world.player.householdId, from.id, to.id, amount); commit(); notify(answer.message); }}>Обменять</button></article>
    <article className="panel savings-control"><div><h2>Цель накоплений</h2></div><label><input type="range" min="500" max="8000" step="100" value={world.player.savingsTargetBps} onChange={(event) => { setPlayerSavingsTarget(world, Number(event.target.value)); commit(); }} /><strong>{percent(world.player.savingsTargetBps)}</strong></label></article><article className="panel"><header className="panel-title"><h2>Операции</h2></header><TransactionRows world={world} transactions={transactions.slice(0, 40)} /></article></>;
}

function Economy({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const currentCountryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const [scope, setScope] = useState<"country" | "world">("country");
  const [countryId, setCountryId] = useState(currentCountryId);
  const [tab, setTab] = useState<"macro" | "government" | "central-bank">("macro");
  const country = world.countries.find((item) => item.id === countryId) ?? world.countries[0];
  const visibleThroughMonth = world.player.interfacePreferences.developerTrueState ? world.clock.elapsedMonths : world.clock.elapsedMonths - 2;
  const metricHistory = world.countryMetricsHistory.filter((point) => point.countryId === country.id && point.elapsedMonth <= visibleThroughMonth).slice(-36);
  const macroHistory = world.macroHistory.filter((point) => point.countryId === country.id && point.elapsedMonth <= visibleThroughMonth).slice(-60);
  const metric = metricHistory.at(-1);
  const macro = world.countryMacroStates.find((state) => state.countryId === country.id);
  const macroPoint = macroHistory.at(-1);
  const previousMacro = macroHistory.at(-2);
  const budget = world.governmentBudgets.find((item) => item.countryId === country.id);
  const area = world.monetaryAreas.find((item) => item.id === country.monetaryAreaId);
  const authority = world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId) ?? world.centralBank;
  const centralBankSheet = world.centralBankBalanceSheets.find((sheet) => sheet.centralBankId === authority.id);
  const policyDecision = [...world.monetaryPolicyDecisions].reverse().find((decision) => decision.centralBankId === authority.id);
  const yieldCurves = world.yieldCurveHistory.filter((snapshot) => snapshot.countryId === country.id);
  const auctions = world.sovereignAuctions.filter((auction) => auction.countryId === country.id).slice(-12).reverse();
  const nominalGdp = macroPoint?.nominalGdpMinor ?? metric?.nominalGdpMinor ?? 0;
  const realGdp = macroPoint?.realGdpMinor ?? metric?.realGdpMinor ?? 0;
  const debtToGdpBps = macroPoint?.debtToGdpBps ?? (nominalGdp > 0 ? Math.round((budget?.publicDebtMinor ?? 0) * 10_000 / (nominalGdp * 12)) : null);
  const budgetBalanceBps = Math.round((budget?.budgetBalanceMinor ?? 0) * 10_000 / Math.max(1, nominalGdp));
  const gdpWhy = [
    ["Потребление", (macroPoint?.consumptionContributionMinor ?? 0) - (previousMacro?.consumptionContributionMinor ?? macroPoint?.consumptionContributionMinor ?? 0)],
    ["Инвестиции", (macroPoint?.investmentContributionMinor ?? 0) - (previousMacro?.investmentContributionMinor ?? macroPoint?.investmentContributionMinor ?? 0)],
    ["Государство", (macroPoint?.governmentContributionMinor ?? 0) - (previousMacro?.governmentContributionMinor ?? macroPoint?.governmentContributionMinor ?? 0)],
    ["Запасы", macroPoint?.inventoryContributionMinor ?? 0],
  ].map(([label, value]) => `${label}: ${(value as number) >= 0 ? "+" : ""}${compactMoney(value as number, country.currencyReference)}`).join("\n");
  const inflationWhy = `Спрос: ${percent(macro?.demandPressureBps ?? 0)}\nЗарплаты: ${percent(macro?.wagePressureBps ?? 0)}\nСырьё и энергия: ${percent(macro?.inputPressureBps ?? 0)}\nЖилищные услуги: ${percent(macro?.housingServicesPressureBps ?? 0)}`;
  const policyWhy = policyDecision
    ? `Инфляция: ${percent(policyDecision.observedInflationBps)}\nРазрыв выпуска: ${percent(policyDecision.outputGapBps)}\nБезработица: ${percent(policyDecision.unemploymentBps)}\nФинансовый стресс: ${percent(policyDecision.financialStressBps)}\nНейтральная ставка: ${percent(policyDecision.neutralRateBps)}`
    : "Решение ещё не принималось.";

  return <>
    <Section title="Экономика" meta={scope === "world" ? "Страны" : `${country.name} · ${country.currencyReference} · задержка ${Math.max(0, world.clock.elapsedMonths - visibleThroughMonth)} мес.`} />
    <div className="market-filters macro-filters"><div className="compact-tabs"><button className={tab === "macro" ? "active" : ""} onClick={() => setTab("macro")}>Макро</button><button className={tab === "government" ? "active" : ""} onClick={() => setTab("government")}>Государство</button><button className={tab === "central-bank" ? "active" : ""} onClick={() => setTab("central-bank")}>Центральный банк</button></div><div className="filter-bar"><select value={countryId} onChange={(event) => { setCountryId(event.target.value); setScope("country"); }} aria-label="Страна">{world.countries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className={scope === "world" ? "active" : ""} onClick={() => setScope(scope === "world" ? "country" : "world")}>Мир</button></div></div>
    {scope === "world" ? <section className="country-macro-grid">{world.countries.map((item) => { const point = [...world.macroHistory].reverse().find((candidate) => candidate.countryId === item.id); const state = world.countryMacroStates.find((candidate) => candidate.countryId === item.id); return <button key={item.id} onClick={() => { setCountryId(item.id); setScope("country"); }}><span>{item.name}<small>{item.currencyReference} · {state?.businessCycle === "recession" ? "рецессия" : state?.businessCycle === "recovery" ? "восстановление" : state?.businessCycle === "slowdown" ? "замедление" : "рост"}</small></span><b>{percent(point?.gdpGrowthBps ?? 0)}</b><i>{percent(point?.inflationBps ?? 0)} инфл. · долг {point ? percent(point.debtToGdpBps) : "—"}</i></button>; })}</section> : <>
      {tab === "macro" && <>
        <section className="macro-kpi-grid"><Kpi label="Реальный ВВП" value={compactMoney(realGdp, country.currencyReference)} values={macroHistory.map((point) => point.realGdpMinor)} why={gdpWhy} open={openWhy} /><Kpi label="Номинальный ВВП" value={compactMoney(nominalGdp, country.currencyReference)} open={openWhy} /><Kpi label="Рост ВВП" value={percent(macroPoint?.gdpGrowthBps ?? metric?.gdpGrowthBps ?? 0)} why={gdpWhy} open={openWhy} /><Kpi label="Инфляция" value={percent(macroPoint?.inflationBps ?? metric?.inflationBps ?? 0)} why={inflationWhy} open={openWhy} /><Kpi label="Безработица" value={percent(macroPoint?.unemploymentBps ?? metric?.unemploymentBps ?? 0)} open={openWhy} /><Kpi label="Ключевая ставка" value={percent(authority.policyRateBps)} why={policyWhy} open={openWhy} /><Kpi label="Рост кредита" value={percent(macro?.creditGrowthBps ?? 0)} open={openWhy} /><Kpi label="Баланс бюджета" value={percent(budgetBalanceBps)} open={openWhy} /><Kpi label="Госдолг / ВВП" value={debtToGdpBps === null ? "—" : percent(debtToGdpBps)} open={openWhy} /><Kpi label="Доходность 10 лет" value={percent(macro?.tenYearYieldBps ?? 0)} open={openWhy} /></section>
        <section className="two-column macro-charts"><article className="panel"><header className="panel-title"><h2>Выпуск</h2><span>{country.currencyReference}</span></header><LineAreaChart values={macroHistory.map((point) => point.realGdpMinor)} labels={macroHistory.map((point) => `${point.elapsedMonth + 1}м`)} format={(value) => compactMoney(value, country.currencyReference)} ariaLabel={`Реальный ВВП ${country.name}`} /></article><article className="panel"><header className="panel-title"><h2>Кривая доходности</h2><span>{macro?.businessCycle}</span></header><YieldCurveChart snapshots={yieldCurves} ariaLabel={`Кривая доходности ${country.name}`} /></article></section>
      </>}
      {tab === "government" && <section className="government-layout"><article className="panel"><header className="panel-title"><h2>Бюджет</h2><span>{budget?.budgetBalanceMinor && budget.budgetBalanceMinor >= 0 ? "Профицит" : "Дефицит"}</span></header><dl className="metric-list"><div><dt>Доходы</dt><dd>{compactMoney(budget?.totalRevenueMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Расходы</dt><dd>{compactMoney(budget?.totalSpendingMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Баланс</dt><dd className={(budget?.budgetBalanceMinor ?? 0) >= 0 ? "positive" : "negative"}>{compactMoney(budget?.budgetBalanceMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Первичный баланс</dt><dd>{compactMoney(budget?.primaryBalanceMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Проценты</dt><dd>{compactMoney(budget?.interestSpendingMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Инвестиции</dt><dd>{compactMoney(budget?.publicInvestmentMinor ?? 0, country.currencyReference)}</dd></div></dl></article><article className="panel"><header className="panel-title"><h2>Государственный долг</h2><span>{debtToGdpBps === null ? "—" : percent(debtToGdpBps)}</span></header><dl className="metric-list"><div><dt>Долг</dt><dd>{compactMoney(budget?.publicDebtMinor ?? 0, country.currencyReference)}</dd></div><div><dt>К погашению за год</dt><dd>{compactMoney(budget?.debtDueNext12MonthsMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Средний срок</dt><dd>{budget?.averageMaturityMonths ?? 0} мес.</dd></div><div><dt>Фискальный стресс</dt><dd>{percent(budget?.fiscalStressBps ?? 0)}</dd></div></dl></article><article className="panel auction-panel"><header className="panel-title"><h2>Аукционы</h2><span>{auctions.length}</span></header><div className="bond-list">{auctions.map((auction) => <article key={auction.id}><span>{auction.maturityBucket} · {auction.status === "settled" ? "размещён" : auction.status === "failed" ? "не состоялся" : "объявлен"}</span><strong>{compactMoney(auction.allocatedFaceValueMinor || auction.targetFaceValueMinor, auction.currencyId)}</strong><small>{auction.clearingYieldBps === null ? "—" : percent(auction.clearingYieldBps)} · заявок {auction.bidCount}</small></article>)}</div></article><article className="panel"><header className="panel-title"><h2>Кривая доходности</h2></header><YieldCurveChart snapshots={yieldCurves} ariaLabel={`Государственный долг ${country.name}`} /></article></section>}
      {tab === "central-bank" && <section className="central-bank-layout"><article className="panel"><header className="panel-title"><h2>{authority.name}</h2><WhyButton title="Почему изменилась ставка?" text={policyWhy} open={openWhy} /></header><dl className="metric-list"><div><dt>Ключевая ставка</dt><dd>{percent(authority.policyRateBps)}</dd></div><div><dt>Цель инфляции</dt><dd>{percent(authority.inflationTargetBps)}</dd></div><div><dt>Инфляция</dt><dd>{percent(macroPoint?.inflationBps ?? 0)}</dd></div><div><dt>Разрыв выпуска</dt><dd>{percent(macro?.outputGapBps ?? 0)}</dd></div><div><dt>Ожидания</dt><dd>{percent(macro?.inflationExpectationsBps ?? 0)}</dd></div><div><dt>Доверие</dt><dd>{percent(macro?.centralBankCredibilityBps ?? 0)}</dd></div></dl></article><article className="panel"><header className="panel-title"><h2>Баланс</h2><span>{country.currencyReference}</span></header><dl className="metric-list"><div><dt>Государственные бумаги</dt><dd>{compactMoney(centralBankSheet?.governmentSecuritiesMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Кредиты банкам</dt><dd>{compactMoney(centralBankSheet?.bankLendingMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Резервы банков</dt><dd>{compactMoney(centralBankSheet?.bankReservesMinor ?? 0, country.currencyReference)}</dd></div><div><dt>Капитал</dt><dd>{compactMoney(centralBankSheet?.equityMinor ?? 0, country.currencyReference)}</dd></div><div><dt>QE</dt><dd>{compactMoney(centralBankSheet?.qePurchasesMinor ?? 0, country.currencyReference)}</dd></div><div><dt>QT</dt><dd>{compactMoney(centralBankSheet?.qtSalesMinor ?? 0, country.currencyReference)}</dd></div></dl></article><article className="panel"><header className="panel-title"><h2>Ликвидность</h2><span>{area?.name}</span></header><div className="bond-list">{world.bankFunding.filter((funding) => funding.lenderId === authority.id && funding.status === "active").map((funding) => <article key={funding.id}><span>{entityLabel(world, funding.borrowerBankId)}</span><strong>{compactMoney(funding.remainingCents, country.currencyReference)}</strong><small>{percent(funding.annualRateBps)} · {funding.collateralPledgeId ? "под залог" : "без залога"}</small></article>)}</div>{!world.bankFunding.some((funding) => funding.lenderId === authority.id && funding.status === "active") && <p className="empty">Активных кредитов ликвидности нет.</p>}</article></section>}
    </>}
  </>;
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
  const netDebt = valuation.enterpriseValueCents - valuation.equityValueCents;
  const activeOffer = [...world.mAndADeals].reverse().find((item) => item.targetCompanyId === company.id && !["closed", "failed"].includes(item.status));
  const playerShare = ownershipBps(world, security.id, world.player.householdId);
  const controlled = playerShare >= 5_001;
  const internalAccess = company.ownerHouseholdId === world.player.householdId || controlled;
  const publicReport = company.corporateStatus === "public" ? company.financialReports.at(-1) : undefined;
  const sharePrice = Math.max(1, Math.round(valuation.equityValueCents / Math.max(1, security.sharesOutstanding)));
  const act = (answer: { ok: boolean; message: string }) => { commit(); notify(answer.message); };
  return <>
    <Section title="Компании" meta={`${country.name} · ${localCompanies.length} компаний`} />
    <section className="panel corporate-actions"><button className="primary" disabled={!isFeatureActionable(world, "companies")} onClick={() => { const created = incorporatePlayerCompany(world, world.player.currentCityId, world.goods[0].id, "Компания игрока", Math.min(1_000_000, Math.floor(depositOf(world, world.player.householdId) / 3))); commit(); notify(created ? "Компания зарегистрирована" : "Недостаточно капитала или нет доступного банка"); }}>Создать компанию</button><span>{isFeatureActionable(world, "companies") ? "Доступно при достаточном капитале" : "Требуется уровень 16"}</span></section>
    <div className="company-explorer">
      <aside className="panel company-list">{localCompanies.map((item) => <button key={item.id} className={item.id === company.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span><b>{item.name}</b><small>{item.industry} · {world.cities.find((cityItem) => cityItem.id === item.cityId)?.name}</small></span><i className={item.active ? "ok" : "fail"}>{item.corporateStatus === "public" ? "Публичная" : item.active ? "Частная" : "Закрыта"}</i></button>)}</aside>
      <section className="panel company-detail">
        <header className="company-identity"><div><span>{country.name} · {city.name}</span><h2>{company.name}</h2><small>{company.industry} · уровень {company.representationTier} · {company.sizeClass === "large" ? "крупная" : company.sizeClass === "medium" ? "средняя" : "малая"}</small></div><div><b>{internalAccess ? currencyMoney(depositOf(world, company.id), country.currencyReference) : "НЕТ ДОСТУПА"}</b><small>{internalAccess ? "ВНУТРЕННЕЕ" : company.corporateStatus === "public" ? "ПУБЛИЧНЫЙ ОТЧЁТ" : "ЧАСТНАЯ КОМПАНИЯ"}</small></div></header>
        <nav className="detail-tabs">{[["overview","Обзор"],["finance","Финансы"],["ownership","Собственность"],["debt","Долг"],["governance","Управление"],["events","События"]].map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</nav>
        {tab === "overview" && <div className="company-section"><dl className="metric-list"><div><dt>Статус</dt><dd>{company.active ? "Работает" : "Закрыта"}</dd></div><div><dt>Работники</dt><dd>{company.employees.length}</dd></div><div><dt>Производство</dt><dd>{number.format(company.lastProductionMilliUnits / 1_000)}</dd></div><div><dt>Загрузка</dt><dd>{percent(company.capacityUtilizationBps)}</dd></div><div><dt>Цена</dt><dd>{currencyMoney(company.priceCents, country.currencyReference)}</dd></div><div><dt>Качество</dt><dd>{number.format(company.qualityBps / 100)}</dd></div></dl></div>}
        {tab === "finance" && <div className="company-section"><section className="valuation-band"><div><span>Стоимость бизнеса</span><strong>{company.corporateStatus === "public" || internalAccess ? currencyMoney(valuation.enterpriseValueCents, country.currencyReference) : "ОЦЕНКА НЕДОСТУПНА"}</strong></div><div><span>Чистый долг</span><strong>{internalAccess ? currencyMoney(netDebt, country.currencyReference) : "НЕТ ДОСТУПА"}</strong></div><div><span>Стоимость собственного капитала</span><strong>{company.corporateStatus === "public" || internalAccess ? currencyMoney(valuation.equityValueCents, country.currencyReference) : "ОЦЕНКА НЕДОСТУПНА"}</strong></div>{activeOffer && <><div><span>Предложение акционерам</span><strong>{currencyMoney(activeOffer.offerPriceMinor, country.currencyReference)}</strong></div><div><span>Премия</span><strong>{percent(activeOffer.premiumBps)}</strong></div></>}<div><span>Средняя стоимость капитала</span><strong>{company.corporateStatus === "public" || internalAccess ? percent(valuation.waccBps) : "—"}</strong></div><WhyButton title="Почему изменилась прибыль?" text={internalAccess || publicReport ? explanationText(whyFor(world, "company", company.id), `${valuation.method}. Оценка не создаёт деньги и не меняет реестр.`) : "Частная компания не раскрывает финансовые данные."} open={openWhy} /></section><dl className="metric-list"><div><dt>Выручка</dt><dd>{internalAccess ? currencyMoney(company.lastGrossRevenueCents, country.currencyReference) : publicReport ? currencyMoney(publicReport.revenueCents, country.currencyReference) : "НЕИЗВЕСТНО"}</dd></div><div><dt>Операционный поток</dt><dd>{internalAccess ? currencyMoney(company.lastGrossRevenueCents - company.lastOperatingExpenseCents, country.currencyReference) : publicReport ? currencyMoney(publicReport.operatingCashFlowCents, country.currencyReference) : "НЕИЗВЕСТНО"}</dd></div><div><dt>Нераспределённая прибыль</dt><dd>{internalAccess ? currencyMoney(company.retainedEarningsCents, country.currencyReference) : "НЕТ ДОСТУПА"}</dd></div><div><dt>Капитал</dt><dd>{internalAccess ? currencyMoney(company.productiveCapital.bookValueCents, country.currencyReference) : publicReport ? currencyMoney(publicReport.productiveCapitalCents, country.currencyReference) : "НЕИЗВЕСТНО"}</dd></div></dl></div>}
        {tab === "ownership" && <div className="company-section"><div className="cap-table"><header><span>Владелец</span><span>Акции</span><span>Доля</span><span>Стоимость приобретения</span></header>{holdings.map((holding) => <div key={holding.id}><span>{entityLabel(world, holding.ownerId)}</span><b>{holding.shares.toLocaleString("ru-RU")}</b><b>{percent(Math.round(holding.shares * 10_000 / security.sharesOutstanding))}</b><b>{currencyMoney(holding.costBasisCents, security.currencyId)}</b></div>)}</div><footer className="register-total"><span>В обращении</span><b>{security.sharesOutstanding.toLocaleString("ru-RU")}</b></footer></div>}
        {tab === "debt" && <div className="company-section">{bonds.length ? <div className="bond-list">{bonds.map((bond) => <article key={bond.id}><span>{bond.id} · {bond.seniority === "senior" ? "старший" : "субординированный"}</span><strong>{currencyMoney(bond.outstandingFaceValueCents, bond.currencyId)}</strong><small>Купон {percent(bond.couponBps)} · погашение {bond.maturityMonth + 1}м · {statusLabel(bond.status)}</small></article>)}</div> : <p className="empty">Облигаций нет.</p>}</div>}
        {tab === "governance" && <div className="company-section"><dl className="metric-list"><div><dt>Контроль игрока</dt><dd>{percent(playerShare)}</dd></div><div><dt>Совет директоров</dt><dd>{world.corporateBoards.find((board) => board.id === company.boardId)?.directorOwnerIds.map((id) => entityLabel(world, id)).join(", ")}</dd></div><div><dt>Материнская компания</dt><dd>{company.parentCompanyId ? entityLabel(world, company.parentCompanyId) : "Нет"}</dd></div><div><dt>Дочерние компании</dt><dd>{company.subsidiaryIds.length}</dd></div></dl></div>}
        {tab === "events" && <div className="company-section action-list">{actions.length ? actions.map((action) => <article key={action.id}><span>{action.elapsedMonth + 1}м</span><b>{action.title}</b><strong>{currencyMoney(action.amountCents, country.currencyReference)}</strong></article>) : <p className="empty">Корпоративных событий нет.</p>}</div>}
        {controlled && <footer className="corporate-actions"><button onClick={() => act(raiseEquity(world, company.id, world.player.householdId, Math.min(500_000_00, Math.floor(depositOf(world, world.player.householdId) / 4)), sharePrice))}>Внести капитал</button><button onClick={() => { const loan = financePlayerCompany(world, company.id, 5_000_000); commit(); notify(loan ? `Кредит одобрен: ${percent(loan.annualRateBps)}` : "Подходящих кредитных предложений нет"); }}>Сравнить кредиты</button><button disabled={company.retainedEarningsCents <= 0} onClick={() => act(declareDividend(world, company.id, Math.min(company.retainedEarningsCents, Math.floor(depositOf(world, company.id) / 10))))}>Дивиденд</button><button onClick={() => act(issueBond(world, company.id, world.player.householdId, Math.min(250_000_00, Math.floor(depositOf(world, world.player.householdId) / 5)), 850, 36))}>Купить выпуск облигаций</button>{company.corporateStatus === "private" && <button className="primary" disabled={!isFeatureActionable(world, "corporate-transactions")} onClick={() => { const ipo = initiatePlayerIPO(world, company.id); commit(); notify(ipo ? "Первичное размещение: начата подготовка" : "Первичное размещение недоступно"); }}>Начать первичное размещение</button>}<button disabled={!isFeatureActionable(world, "corporate-transactions")} onClick={() => { const target = world.companies.find((item) => item.active && item.id !== company.id && item.goodId === company.goodId); const deal = target && initiatePlayerAcquisition(world, company.id, target.id); commit(); notify(deal ? "Предложение о слиянии или поглощении направлено" : "Подходящая цель не найдена"); }}>Предложить слияние или поглощение</button></footer>}
      </section>
    </div>
  </>;
}

function Markets({ world, commit, notify, openWhy }: { world: WorldState; commit: () => void; notify: (text: string) => void; openWhy: (title: string, text: string) => void }) {
  const localCountryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const [scope, setScope] = useState<"local" | "country" | "world">("local");
  const [countryId, setCountryId] = useState(localCountryId);
  const [assetClass, setAssetClass] = useState<"stocks" | "fx" | "bonds" | "indices" | "funds" | "derivatives">("stocks");
  const [timeframe, setTimeframe] = useState<"1M" | "6M" | "1Y" | "5Y" | "ALL">("1Y");
  const [orderType, setOrderType] = useState<"market" | "limit">("limit");
  const allowedExchangeIds = new Set(world.exchanges.filter((exchange) => scope === "world" || exchange.countryId === (scope === "local" ? localCountryId : countryId)).map((exchange) => exchange.id));
  const listings = world.listings.filter((listing) => allowedExchangeIds.has(listing.exchangeId));
  const [selectedSecurityId, setSelectedSecurityId] = useState("");
  const listing = listings.find((item) => item.securityId === selectedSecurityId) ?? listings[0];
  const exchange = listing ? world.exchanges.find((item) => item.id === listing.exchangeId) : world.exchanges.find((item) => item.countryId === localCountryId);
  const broker = exchange ? world.brokers.find((item) => item.countryId === exchange.countryId && item.exchangeIds.includes(exchange.id)) : undefined;
  const settlement = listing ? bankAccountsForOwner(world, world.player.householdId, listing.currencyId)[0] : undefined;
  const account = broker && world.brokerageAccounts.find((item) => item.ownerId === world.player.householdId && item.brokerId === broker.id && item.currencyId === listing?.currencyId && item.status === "active");
  const [quantity, setQuantity] = useState(10);
  const [price, setPrice] = useState(listing?.lastPriceCents ?? 1_000);
  const orders = listing ? world.marketOrders.filter((order) => order.securityId === listing.securityId && (order.status === "open" || order.status === "partially-filled")) : [];
  const periods = { "1M": 1, "6M": 6, "1Y": 12, "5Y": 60, "ALL": Number.POSITIVE_INFINITY } as const;
  const bars = listing ? world.ohlcvBars.filter((bar) => bar.securityId === listing.securityId).slice(-periods[timeframe]) : [];
  const margin = account && world.marginAccounts.find((item) => item.brokerageAccountId === account.id && item.ownerId === world.player.householdId && item.status !== "closed");
  const marginState = margin ? marginAccountState(world, margin.id) : null;
  const submit = (side: "buy" | "sell") => {
    if (!account || !listing) return;
    const answer = placeOrder(world, account.id, listing.securityId, side, orderType, quantity, orderType === "limit" ? price : null);
    commit(); notify(answer.message);
  };
  const marginBuy = () => { if (!margin || !listing) return; const answer = placeMarginBuy(world, margin.id, listing.securityId, quantity, orderType === "limit" ? price : undefined); commit(); notify(answer.message); };
  const short = () => { if (!margin || !listing) return; const lender = world.funds.find((fund) => world.equityHoldings.some((holding) => holding.ownerId === fund.id && holding.securityId === listing.securityId && holding.shares >= quantity)); if (!lender) { notify("Нет доступного кредитора бумаг"); return; } const answer = placeShortSale(world, margin.id, lender.id, listing.securityId, quantity); commit(); notify(answer.message); };
  const selectListing = (securityId: string, lastPrice: number) => { setSelectedSecurityId(securityId); setPrice(lastPrice); };
  const stockRows = listings.map((item) => { const company = world.companies.find((entry) => entry.id === item.companyId); const security = world.equitySecurities.find((entry) => entry.id === item.securityId); const lastBar = world.ohlcvBars.filter((bar) => bar.securityId === item.securityId).at(-1); return { item, company, marketCap: (security?.sharesOutstanding ?? 0) * item.lastPriceCents, volume: lastBar?.volume ?? 0, change: Math.round((item.lastPriceCents - item.previousCloseCents) * 10_000 / Math.max(1, item.previousCloseCents)) }; });
  return <>
    <Section title="Рынки" meta={exchange ? `${exchange.name} · ${exchange.currencyId}` : "Глобальный обзор"} />
    <div className="market-filters"><div className="compact-tabs">{[["stocks","Акции"],["fx","Валюты"],["bonds","Облигации"],["indices","Индексы"],["funds","Фонды"],["derivatives","Деривативы"]].map(([id,label]) => <button className={assetClass === id ? "active" : ""} key={id} onClick={() => setAssetClass(id as typeof assetClass)}>{label}</button>)}</div><div className="filter-bar"><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="local">Текущий рынок</option><option value="country">Страна</option><option value="world">Весь мир</option></select>{scope === "country" && <select value={countryId} onChange={(event) => setCountryId(event.target.value)}>{world.countries.map((country) => <option value={country.id} key={country.id}>{country.name}</option>)}</select>}</div></div>
    {assetClass === "stocks" && <>
      <article className="panel market-screener"><div className="responsive-table"><table><thead><tr><th>Тикер</th><th>Компания</th><th>Цена</th><th>Изменение</th><th>Капитализация</th><th>Объём</th><th>Отрасль</th><th>Страна</th></tr></thead><tbody>{stockRows.map(({ item, company, marketCap, volume, change }) => <tr className={listing?.id === item.id ? "selected" : ""} key={item.id} onClick={() => selectListing(item.securityId, item.lastPriceCents)}><td><b>{item.ticker}</b></td><td>{company?.name}</td><td>{currencyMoney(item.lastPriceCents, item.currencyId)}</td><td className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{percent(change)}</td><td>{compactMoney(marketCap, item.currencyId)}</td><td>{volume.toLocaleString("ru-RU")}</td><td>{company?.industry}</td><td>{world.countries.find((country) => country.id === company?.headquartersCountryId)?.name}</td></tr>)}</tbody></table>{!stockRows.length && <p className="empty">Инструментов нет.</p>}</div></article>
      {listing && broker && <>
        {!account && <article className="panel broker-open"><div><span>{broker.name}</span><h2>Расчётный счёт · {listing.currencyId}</h2><small>{settlement ? currencyMoney(bankAccountBalance(world, settlement.id), settlement.currencyId) : `Сначала откройте банковский счёт в ${listing.currencyId}`}</small></div><button className="primary" disabled={!settlement || broker.countryId !== localCountryId} onClick={() => { const answer = openBrokerageAccount(world, world.player.householdId, broker.id, settlement?.id); commit(); notify(answer.message); }}>Открыть брокерский счёт</button></article>}
        <div className="market-workspace"><article className="panel market-chart"><header className="panel-title"><h2>{listing.ticker}</h2><div><WhyButton title="Почему изменилась цена?" text={explanationText(whyFor(world, "price", listing.securityId))} open={openWhy} /><WhyButton title="Почему изменился спред?" text={explanationText(whyFor(world, "liquidity", listing.securityId))} open={openWhy} /></div><div className="timeframes">{(["1M","6M","1Y","5Y","ALL"] as const).map((period) => <button className={timeframe === period ? "active" : ""} key={period} onClick={() => setTimeframe(period)}>{TIMEFRAME_LABELS[period]}</button>)}</div></header><TradingChart bars={bars} format={(value) => currencyMoney(value, listing.currencyId)} ariaLabel={`Свечной график ${listing.ticker}`} /></article><article className="panel order-ticket"><header className="panel-title"><h2>Заявка</h2><span>{broker.name}</span></header><div className="compact-tabs"><button className={orderType === "market" ? "active" : ""} onClick={() => setOrderType("market")}>Рыночная</button><button className={orderType === "limit" ? "active" : ""} onClick={() => setOrderType("limit")}>Лимитная</button></div><label>Количество<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} /></label>{orderType === "limit" && <label>Цена<input type="number" min="1" value={price} onChange={(event) => setPrice(Math.max(1, Number(event.target.value)))} /></label>}<div><button disabled={!account} onClick={() => submit("sell")}>Продать</button><button className="primary" disabled={!account} onClick={() => submit("buy")}>Купить</button></div>{account && !margin && <button onClick={() => { const answer = openMarginAccount(world, world.player.householdId, account.id); commit(); notify(answer.message); }}>Открыть маржинальный счёт</button>}{margin && <div className="leverage-actions"><button onClick={marginBuy}>Купить с плечом</button><button onClick={short}>Продать в шорт</button><small>Капитал {currencyMoney(marginState?.equityMinor ?? 0, margin.currencyId)} · плечо {number.format((marginState?.leverageBps ?? 0) / 10_000)}×</small></div>}<small>Сумма: {currencyMoney(quantity * (orderType === "limit" ? price : listing.lastPriceCents), listing.currencyId)}</small></article><article className="panel order-book"><header className="panel-title"><h2>Книга заявок</h2><span>Количество · цена</span></header><div className="book-head"><span>Покупка</span><span>Цена</span><span>Продажа</span></div>{[...orders].sort((a,b) => (b.limitPriceCents ?? listing.lastPriceCents) - (a.limitPriceCents ?? listing.lastPriceCents)).slice(0, 16).map((order) => <div key={order.id}><b>{order.side === "buy" ? order.remainingQuantity : "—"}</b><span>{currencyMoney(order.limitPriceCents ?? listing.lastPriceCents, listing.currencyId)}</span><b>{order.side === "sell" ? order.remainingQuantity : "—"}</b></div>)}{!orders.length && <p className="empty">Нет заявок.</p>}</article></div>
      </>}
    </>}
    {assetClass === "fx" && <article className="panel"><header className="panel-title"><h2>Валютный рынок</h2><span>Исполняемые котировки</span></header><div className="responsive-table"><table><thead><tr><th>Пара</th><th>Покупка</th><th>Продажа</th><th>Спред</th><th>Объём базы</th></tr></thead><tbody>{world.fxPairs.map((pair) => <tr key={pair.id}><td><b>{pair.baseCurrencyId}/{pair.quoteCurrencyId}</b></td><td>{number.format(pair.askRatePpm / 1_000_000)}</td><td>{number.format(pair.bidRatePpm / 1_000_000)}</td><td>{percent(pair.spreadBps)}</td><td>{formatCompactMoney(pair.volumeBaseMinor, pair.baseCurrencyId)}</td></tr>)}</tbody></table></div></article>}
    {assetClass === "bonds" && <article className="panel"><header className="panel-title"><h2>Облигации</h2><span>Первичный рынок</span></header><div className="bond-list">{world.corporateBonds.filter((bond) => bond.status === "active").map((bond) => <article key={bond.id}><span>{entityLabel(world, bond.issuerCompanyId)}</span><strong>{currencyMoney(bond.outstandingFaceValueCents, bond.currencyId)}</strong><small>Купон {percent(bond.couponBps)} · погашение {bond.maturityMonth + 1}м</small></article>)}</div></article>}
    {assetClass === "indices" && <article className="panel"><header className="panel-title"><h2>Индексы</h2><span>Справочно · не торгуются</span></header><div className="fund-grid">{world.marketIndices.map((index) => <article key={index.id}><span>{world.exchanges.find((item) => item.id === index.exchangeId)?.shortName}</span><h3>{index.name}</h3><strong>{number.format(index.levelBps / 100)}</strong><small>{index.constituentSecurityIds.length} компонентов</small></article>)}</div></article>}
    {assetClass === "funds" && <><article className="panel"><header className="panel-title"><h2>Фонды</h2><button disabled={!isFeatureActionable(world, "private-equity")} onClick={() => { const fund = createPlayerPeFund(world, Math.max(1_000_000, Math.floor(depositOf(world, world.player.householdId) / 2))); commit(); notify(fund ? "Фонд прямых инвестиций создан; капитал пока заявлен инвесторами" : "Для фонда прямых инвестиций нужен капитал"); }}>Создать фонд прямых инвестиций</button></header><div className="fund-grid">{world.funds.map((fund) => { const nav = calculateFundNav(world, fund.id); const source = bankAccountsForOwner(world, world.player.householdId, fund.currencyId)[0]; return <article key={fund.id}><span>{fund.type === "open-end" ? "Открытый" : fund.type === "etf" ? "Биржевой фонд" : fund.type === "hedge" ? "Хедж-фонд" : fund.type === "pension" ? "Пенсионный" : "Частный капитал"}</span><h3>{fund.name}</h3><strong>{compactMoney(nav.navMinor, fund.currencyId)}</strong><small>Стоимость пая {currencyMoney(nav.navPerUnitMinor, fund.currencyId)} · комиссия {percent(fund.managementFeeBps)}</small><button disabled={!source} onClick={() => { const answer = subscribeFund(world, fund.id, world.player.householdId, Math.min(100_000, source ? Math.floor(bankAccountBalance(world, source.id) / 10) : 0), source?.id); commit(); notify(answer.message); }}>Купить паи</button></article>; })}</div></article><article className="panel"><header className="panel-title"><h2>Аукционы</h2><span>{world.economicAuctions.filter((item) => item.status === "open").length} открыто</span></header><div className="bond-list">{world.economicAuctions.filter((item) => item.status === "open").map((auction) => <article key={auction.id}><span>{AUCTION_TYPE_LABELS[auction.objectType] ?? auction.objectType} · {AUCTION_MECHANISM_LABELS[auction.mechanism] ?? auction.mechanism}</span><strong>{auction.quantity.toLocaleString("ru-RU")}</strong><button onClick={() => { const bid = bidPlayerAuction(world, auction.id, Math.max(auction.reserveMinor, 100), 1); commit(); notify(bid ? "Заявка подана" : "Заявка отклонена правилами аукциона"); }}>Подать заявку</button></article>)}</div></article></>}
    {assetClass === "funds" && <PlayerPeInsurance world={world} commit={commit} notify={notify} />}
    {assetClass === "derivatives" && <Suspense fallback={<p className="empty">Загрузка срочного рынка…</p>}><AdvancedMarketsPanel world={world} exchange={exchange} listings={listings} commit={commit} notify={notify} /></Suspense>}
  </>;
}

function PlayerPeInsurance({ world, commit, notify }: { world: WorldState; commit: () => void; notify: (text: string) => void }) {
  const playerManagers = new Set(world.assetManagers.filter((item) => item.ownerId === world.player.householdId).map((item) => item.id));
  const playerFunds = world.funds.filter((item) => item.type === "private-capital" && playerManagers.has(item.managerId));
  const activePolicy = world.insurancePolicies.find((item) => item.policyholderId === world.player.householdId && item.status === "active");
  const claim = activePolicy && world.insuranceClaims.find((item) => item.policyId === activePolicy.id);
  return <section className="market-workspace">
    <article className="panel"><header className="panel-title"><h2>Мои фонды прямых инвестиций</h2><span>{playerFunds.length}</span></header><div className="bond-list">{playerFunds.map((fund) => { const state = world.privateEquityFunds.find((item) => item.fundId === fund.id); const deals = world.privateEquityDeals.filter((item) => item.fundId === fund.id); const openDeal = deals.find((item) => item.status === "owned" || item.status === "covenant-breach"); return <article key={fund.id}><span>{fund.name}</span><strong>{compactMoney(state?.navMinor ?? 0, fund.currencyId)}</strong><small>Обязательства {compactMoney(state?.committedCapitalMinor ?? 0, fund.currencyId)} · вызвано {compactMoney(state?.calledCapitalMinor ?? 0, fund.currencyId)} · свободно {compactMoney(state?.dryPowderMinor ?? 0, fund.currencyId)}</small><small>Сделки: {deals.length}{openDeal ? ` · ${entityLabel(world, openDeal.targetCompanyId)} · ${statusLabel(openDeal.status)}` : ""}</small><div><button disabled={!state || state.calledCapitalMinor >= state.committedCapitalMinor} onClick={() => { const received = callPlayerPeCapital(world, fund.id, Math.max(1, Math.floor((state!.committedCapitalMinor - state!.calledCapitalMinor) / 2))); commit(); notify(received ? `Получено ${currencyMoney(received, fund.currencyId)}` : "Вызов капитала не исполнен"); }}>Вызвать капитал</button><button disabled={!state?.dryPowderMinor || Boolean(deals.some((item) => !["exited", "failed"].includes(item.status)))} onClick={() => { const deal = sourceAndStartPlayerPeDeal(world, fund.id); commit(); notify(deal ? `Инвесткомитет одобрил ${entityLabel(world, deal.targetCompanyId)}` : "Подходящая цель не найдена"); }}>Найти сделку</button><button disabled={!openDeal || world.clock.elapsedMonths - openDeal.entryMonth < 24} onClick={() => { const route = openDeal && startPlayerPeExit(world, openDeal.id); commit(); notify(route ? `Запущен выход: ${route}` : "Условия выхода пока не выполнены"); }}>Начать выход</button></div></article>; })}{!playerFunds.length && <p className="empty">Создайте фонд прямых инвестиций, чтобы управлять обязательствами, сделками и выходами.</p>}</div></article>
    <article className="panel"><header className="panel-title"><h2>Страхование</h2><span>{activePolicy ? "Активно" : "Нет полиса"}</span></header>{activePolicy ? <div className="bond-list"><article><span>{world.insurers.find((item) => item.id === activePolicy.insurerId)?.name}</span><strong>{compactMoney(activePolicy.limitMinor, world.insurers.find((item) => item.id === activePolicy.insurerId)?.currencyId ?? "RUB")}</strong><small>Премия {compactMoney(activePolicy.annualPremiumMinor, world.insurers.find((item) => item.id === activePolicy.insurerId)?.currencyId ?? "RUB")} · франшиза {compactMoney(activePolicy.deductibleMinor, world.insurers.find((item) => item.id === activePolicy.insurerId)?.currencyId ?? "RUB")}</small><button disabled={Boolean(claim)} onClick={() => { const filed = filePlayerInsuranceClaim(world, activePolicy.id); commit(); notify(filed ? `Убыток зарегистрирован: ${statusLabel(filed.status)}` : "Убыток не принят"); }}>Заявить убыток</button></article></div> : <button className="primary" onClick={() => { const policy = buyPlayerInsurance(world); commit(); notify(policy ? `Полис оформлен · премия ${policy.annualPremiumMinor.toLocaleString("ru-RU")}` : "Нет доступного предложения или средств"); }}>Сравнить и купить полис</button>}</article>
  </section>;
}

function Portfolio({ world, commit, notify }: { world: WorldState; commit: () => void; notify: (text: string) => void }) {
  const summary = portfolioSummary(world, world.player.householdId);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [portion, setPortion] = useState(100);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState(1);
  const reporting = valueInReportingCurrency(world, world.player.householdId, world.player.reportingCurrencyId);
  const sell = (securityId: string, shares: number) => { const listing = world.listings.find((item) => item.securityId === securityId); const brokerage = listing && world.brokerageAccounts.find((item) => item.ownerId === world.player.householdId && item.currencyId === listing.currencyId && world.brokers.find((broker) => broker.id === item.brokerId)?.exchangeIds.includes(listing.exchangeId)); if (!listing || !brokerage) { notify("Нет подходящего брокерского счёта"); return; } const quantity = Math.max(1, Math.floor(shares * portion / 100)); const answer = placeOrder(world, brokerage.id, securityId, "sell", orderType, quantity, orderType === "limit" ? limitPrice : null); commit(); notify(answer.message); if (answer.ok) setSellingId(null); };
  return <><Section title="Портфель" meta={`${summary.positions.length} позиций · отчёт в ${world.player.reportingCurrencyId}`} /><section className="kpi-grid four"><Kpi label="Чистый капитал" value={currencyMoney(reporting.totalMinor, world.player.reportingCurrencyId)} open={() => undefined} /><Kpi label="Банковские счета" value={bankAccountsForOwner(world, world.player.householdId).length.toString()} open={() => undefined} /><Kpi label="Инструменты" value={(summary.positions.length + world.fundUnitHoldings.filter((item) => item.investorId === world.player.householdId).length).toString()} open={() => undefined} /><Kpi label="Валютный эффект" value={currencyMoney(reporting.translationEffectMinor, world.player.reportingCurrencyId)} open={() => undefined} /></section><article className="panel"><header className="panel-title"><h2>Позиции</h2><span>В валюте инструмента</span></header><div className="responsive-table"><table><thead><tr><th>Инструмент</th><th>Количество</th><th>Цена</th><th>Стоимость</th><th>Затраты</th><th>Результат</th><th /></tr></thead><tbody>{summary.positions.map((position) => { const listing = world.listings.find((item) => item.securityId === position.securityId); const currency = listing?.currencyId ?? "RUB"; return <tr key={position.securityId}><td><b>{position.ticker}</b><small>{world.companies.find((company) => company.equitySecurityId === position.securityId)?.name ?? world.funds.find((fund) => fund.unitSecurityId === position.securityId)?.name}</small></td><td>{position.shares.toLocaleString("ru-RU")}</td><td>{currencyMoney(position.priceCents, currency)}</td><td>{currencyMoney(position.valueCents, currency)}</td><td>{currencyMoney(position.costBasisCents, currency)}</td><td className={position.pnlCents >= 0 ? "positive" : "negative"}>{currencyMoney(position.pnlCents, currency)}</td><td><button onClick={() => { setSellingId(position.securityId); setLimitPrice(position.priceCents); }}>Продать</button></td></tr>; })}</tbody></table>{!summary.positions.length && <p className="empty">Позиции появятся после покупки.</p>}</div></article>{sellingId && (() => { const position = summary.positions.find((item) => item.securityId === sellingId)!; const listing = world.listings.find((item) => item.securityId === sellingId); return <article className="panel sell-ticket"><header className="panel-title"><h2>Продать {position.ticker}</h2><button onClick={() => setSellingId(null)}>×</button></header><div className="compact-tabs">{[25,50,75,100].map((value) => <button className={portion === value ? "active" : ""} key={value} onClick={() => setPortion(value)}>{value}%</button>)}</div><div className="compact-tabs"><button className={orderType === "market" ? "active" : ""} onClick={() => setOrderType("market")}>Рыночная</button><button className={orderType === "limit" ? "active" : ""} onClick={() => setOrderType("limit")}>Лимитная</button></div>{orderType === "limit" && <label>Цена<input type="number" min="1" value={limitPrice} onChange={(event) => setLimitPrice(Math.max(1, Number(event.target.value)))} /></label>}<button className="primary" onClick={() => sell(sellingId, position.shares)}>Разместить заявку · {Math.max(1, Math.floor(position.shares * portion / 100)).toLocaleString("ru-RU")}</button><small>{listing ? currencyMoney(Math.floor(position.shares * portion / 100) * (orderType === "limit" ? limitPrice : listing.lastPriceCents), listing.currencyId) : ""}</small></article>; })()}<article className="panel"><header className="panel-title"><h2>Короткие позиции</h2><span>{world.shortPositions.filter((item) => item.status === "open" && world.marginAccounts.find((account) => account.id === item.marginAccountId)?.ownerId === world.player.householdId).length}</span></header><div className="bond-list">{world.shortPositions.filter((item) => item.status === "open" && world.marginAccounts.find((account) => account.id === item.marginAccountId)?.ownerId === world.player.householdId).map((position) => { const listing = world.listings.find((item) => item.securityId === position.securityId)!; return <article key={position.id}><span>{listing?.ticker}</span><strong>-{position.quantity.toLocaleString("ru-RU")}</strong><small>Вход {currencyMoney(position.entryPriceMinor, listing.currencyId)} · заём {currencyMoney(position.accruedBorrowFeeMinor, listing.currencyId)}</small><button onClick={() => { const answer = buyToCover(world, position.id); commit(); notify(answer.message); }}>Закрыть</button></article>; })}</div></article></>;
}

function Banks({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const countryId = world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru";
  const banks = world.banks.filter((bank) => bank.countryId === countryId);
  const country = world.countries.find((item) => item.id === countryId)!;
  const area = world.monetaryAreas.find((item) => item.id === country.monetaryAreaId);
  const centralBank = world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId) ?? world.centralBank;
  return <><Section title="Банки" meta={`${world.loans.filter((item) => item.status === "active" && banks.some((bank) => bank.id === item.lenderBankId)).length} активных кредитов`} /><section className="bank-grid">{banks.map((bank) => { const book = entityBook(world, bank.id); const reserves = balanceOf(world, accountIds.bankReserve(bank.id)); const deposits = Object.values(world.ledger.accounts).filter((account) => account.ownerId === bank.id && account.category === "liability" && account.instrument === "deposit").reduce((sum, account) => sum + balanceOf(world, account.id), 0); const loans = world.loans.filter((loan) => loan.lenderBankId === bank.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0); return <article className="panel bank-card" key={bank.id}><header><div><span>Коммерческий банк</span><h2>{bank.name}</h2></div><WhyButton title="Почему изменились условия кредита?" text={explanationText(whyFor(world, "bank", bank.id), "Новых кредитных решений пока нет.")} open={openWhy} /></header><dl><div><dt>Капитал</dt><dd>{compactMoney(book.capital, bank.baseCurrency)}</dd></div><div><dt>Норматив капитала</dt><dd>{percent(bankCapitalRatioBps(world, bank.id))}</dd></div><div><dt>Ликвидность</dt><dd>{compactMoney(reserves, bank.baseCurrency)}</dd></div><div><dt>Коэффициент ликвидности</dt><dd>{percent(bankLiquidityRatioBps(world, bank.id))}</dd></div><div><dt>Депозиты</dt><dd>{compactMoney(deposits, bank.baseCurrency)}</dd></div><div><dt>Кредитный портфель</dt><dd>{compactMoney(loans, bank.baseCurrency)}</dd></div></dl></article>; })}</section><article className="panel policy"><header className="panel-title"><h2>Денежная власть</h2><span>{centralBank.name} · {area?.name}</span></header><div><Kpi label="Ключевая ставка" value={percent(centralBank.policyRateBps)} open={openWhy} /><Kpi label="Цель инфляции" value={percent(centralBank.inflationTargetBps)} open={openWhy} /><Kpi label="Кредиты ликвидности" value={world.bankFunding.filter((item) => item.lenderId === centralBank.id && item.status === "active").length.toString()} open={openWhy} /></div></article></>;
}

function transactionAmount(transaction: LedgerTransaction): number {
  return Math.max(0, ...transaction.entries.map((entry) => entry.amountCents));
}

function transactionLabel(world: WorldState, transaction: LedgerTransaction): string {
  const currencies = [...new Set(transaction.entries.map((entry) => world.ledger.accounts[entry.accountId]?.currency).filter(Boolean))];
  return currencies.length === 1 ? compactMoney(transactionAmount(transaction), currencies[0]) : `${currencies.length} валюты`;
}

function TransactionRows({ world, transactions, select, selectedId }: { world: WorldState; transactions: LedgerTransaction[]; select?: (id: string) => void; selectedId?: string }) {
  if (!transactions.length) return <p className="empty">Операций пока нет.</p>;
  return <div className="transaction-rows">{transactions.map((transaction) => <button className={selectedId === transaction.id ? "selected" : ""} key={transaction.id} onClick={() => select?.(transaction.id)}><span><b>{TX_LABELS[transaction.kind]}</b><small>{transaction.memo} · {transaction.elapsedMonth + 1}м</small></span><strong>{transactionLabel(world, transaction)}</strong></button>)}</div>;
}

function Ledger({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = world.ledger.transactions.filter((transaction) => `${transaction.id} ${TX_LABELS[transaction.kind]} ${transaction.memo}`.toLowerCase().includes(query.toLowerCase())).slice(-150).reverse();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = world.ledger.transactions.find((item) => item.id === selectedId) ?? filtered[0];
  return <><Section title="Общий реестр" meta={`${world.ledger.transactions.length.toLocaleString("ru-RU")} операций`} /><div className="ledger-grid"><article className="panel ledger-list"><label className="search"><span>Поиск</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, тип или назначение" /></label><TransactionRows world={world} transactions={filtered} select={setSelectedId} selectedId={selected?.id} /></article><article className="panel transaction-detail">{selected ? <><header><div><span>{selected.id} · {selected.elapsedMonth + 1} месяц</span><h2>{TX_LABELS[selected.kind]}</h2></div><strong>{transactionLabel(world, selected)}</strong></header><button className="memo" onClick={() => openWhy(TX_LABELS[selected.kind], selected.memo)}>Причина операции</button><div className="entry-head"><span>Счёт</span><span>Дебет</span><span>Кредит</span></div>{selected.entries.map((entry, index) => { const account = world.ledger.accounts[entry.accountId]; return <div className="entry-row" key={`${entry.accountId}-${index}`}><span><b>{account?.name}</b><small>{entityLabel(world, account?.ownerId ?? "")}</small></span><span>{entry.side === "debit" ? currencyMoney(entry.amountCents, account?.currency ?? "RUB") : "—"}</span><span>{entry.side === "credit" ? currencyMoney(entry.amountCents, account?.currency ?? "RUB") : "—"}</span></div>; })}<footer>Проводка сбалансирована</footer></> : <p className="empty">Операций пока нет.</p>}</article></div></>;
}

function countLabels<T>(rows: readonly T[], key: (row: T) => string): Array<readonly [string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function GlobalEconomy({ world, openWhy }: { world: WorldState; openWhy: (title: string, text: string) => void }) {
  const [countryId, setCountryId] = useState(world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru");
  const [tab, setTab] = useState<"trade" | "commodities" | "external" | "fx">("trade");
  const country = world.countries.find((item) => item.id === countryId)!;
  const flows = world.tradeFlows.filter((flow) => flow.exporterCountryId === countryId || flow.importerCountryId === countryId).slice(-80).reverse();
  const bop = [...world.balanceOfPayments].reverse().find((item) => item.countryId === countryId);
  const niip = [...world.internationalInvestmentPositions].reverse().find((item) => item.countryId === countryId);
  const pressure = [...world.fxPressureHistory].reverse().find((item) => item.countryId === countryId);
  const partners = countLabels(flows, (flow) => flow.exporterCountryId === countryId ? flow.importerCountryId : flow.exporterCountryId).slice(0, 8);
  return <><Section title="Мировая экономика" meta={`${world.tradeFlows.length} активных поставок · ${world.globalCommodities.length} рынков`} />
    <div className="market-filters macro-filters"><div className="compact-tabs">{[["trade","Торговля"],["commodities","Сырьё"],["external","Внешний сектор"],["fx","Валютное давление"]].map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</div><select value={countryId} onChange={(event) => setCountryId(event.target.value)}>{world.countries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    {tab === "trade" && <><section className="kpi-grid four"><Kpi label="Экспорт" value={compactMoney(bop?.goodsExportsUsdMinor ?? 0,"USD")} open={openWhy} /><Kpi label="Импорт" value={compactMoney(bop?.goodsImportsUsdMinor ?? 0,"USD")} open={openWhy} /><Kpi label="Маршруты" value={String(world.tradeRoutes.filter((route) => route.originCountryId === countryId || route.destinationCountryId === countryId).length)} open={openWhy} /><Kpi label="Порты" value={String(world.ports.filter((port) => port.countryId === countryId).length)} open={openWhy} /></section><section className="two-column"><article className="panel diagnostic-card"><header className="panel-title"><h2>Партнёры</h2><span>{country.name}</span></header><div className="diagnostic-list">{partners.map(([id,count]) => <div key={id}><span>{world.countries.find((item) => item.id === id)?.name ?? id}</span><strong>{count}</strong></div>)}</div></article><article className="panel diagnostic-card"><header className="panel-title"><h2>Поставки</h2><span>{flows.length}</span></header><div className="diagnostic-list">{flows.slice(0,10).map((flow) => <div key={flow.id}><span>{world.globalCommodities.find((item) => item.id === flow.commodityId)?.name} · {flow.exporterCountryId.toUpperCase()} → {flow.importerCountryId.toUpperCase()}</span><strong>{number.format(flow.quantityMilliUnits/1000)}</strong></div>)}</div></article></section></>}
    {tab === "commodities" && <section className="commodity-board">{world.commodityMarkets.map((market) => <article className="panel" key={market.commodityId}><span>{world.globalCommodities.find((item) => item.id === market.commodityId)?.category}</span><h2>{world.globalCommodities.find((item) => item.id === market.commodityId)?.name}</h2><strong>{currencyMoney(market.spotPriceUsdMinor,"USD")}</strong><small>{percent(market.shortageBps)} дефицит · {number.format(market.globalInventoryMilliUnits/1000)} запас</small></article>)}</section>}
    {tab === "external" && <section className="kpi-grid four"><Kpi label="Текущий счёт" value={compactMoney(bop?.currentAccountUsdMinor ?? 0,"USD")} open={openWhy} /><Kpi label="Финансовый счёт" value={compactMoney(bop?.financialAccountUsdMinor ?? 0,"USD")} open={openWhy} /><Kpi label="Чистая международная позиция" value={compactMoney(niip?.netInternationalInvestmentPositionUsdMinor ?? 0,"USD")} open={openWhy} /><Kpi label="Внешний долг" value={compactMoney((niip?.publicExternalDebtUsdMinor ?? 0)+(niip?.privateExternalDebtUsdMinor ?? 0),"USD")} open={openWhy} /></section>}
    {tab === "fx" && <section className="two-column"><article className="panel national-accounts"><dl><div><dt>Торговля</dt><dd>{compactMoney(pressure?.tradePressureUsdMinor ?? 0,"USD")}</dd></div><div><dt>Капитал</dt><dd>{compactMoney(pressure?.capitalFlowPressureUsdMinor ?? 0,"USD")}</dd></div><div><dt>Дифференциал ставок</dt><dd>{percent(pressure?.rateDifferentialBps ?? 0)}</dd></div><div><dt>Интервенции</dt><dd>{compactMoney(pressure?.interventionUsdMinor ?? 0,"USD")}</dd></div></dl></article><article className="panel diagnostic-card"><header className="panel-title"><h2>Режим</h2><button onClick={() => openWhy("Валютное давление", `Фактические причины: ${pressure?.causeIds.join(", ") || "нет исполненных потоков"}`)}>Почему?</button></header><dl><div><dt>Режим</dt><dd>{world.fxRegimes.find((item) => item.countryId === countryId)?.regime}</dd></div><div><dt>Резервы</dt><dd>{compactMoney(world.reservePortfolios.find((item) => item.countryId === countryId)?.totalUsdMinor ?? 0,"USD")}</dd></div></dl></article></section>}
  </>;
}

/* Legacy inline screens retained temporarily as source reference. The active
 * implementations are code-split in phase-panels and are not bundled here.
function EconomicLab({ world }: { world: WorldState }) {
  const [countryId, setCountryId] = useState("ru");
  const [rateDelta, setRateDelta] = useState(100);
  const [horizon, setHorizon] = useState(12);
  const [duration, setDuration] = useState(12);
  const [policyMode, setPolicyMode] = useState<"RATE_SHOCK" | "RATE_PATH" | "POLICY_RULE_SHIFT">("RATE_SHOCK");
  const [historicalYear, setHistoricalYear] = useState(world.baselineReference.referenceYear);
  const [result, setResult] = useState<EconomicLabResult | null>(null);
  const [validation, setValidation] = useState<CalibrationResult[]>([]);
  const [running, setRunning] = useState(false);
  const run = () => { setRunning(true); window.setTimeout(() => { setResult(runEconomicLab(world, { countryId, horizonMonths: horizon, policyRateDeltaBps: rateDelta, policyDurationMonths: duration, policyMode, historicalStartYear: historicalYear })); setRunning(false); }, 0); };
  const validate = async () => {
    setRunning(true);
    const series = await loadHistoricalSeries(countryId);
    window.setTimeout(() => {
      const validationWorld = createHistoricalValidationWorld(world, historicalYear);
      const points = validationWorld.macroHistory.filter((point) => point.countryId === countryId);
      setValidation(series.map((reference) => compareCalibrationSeries(
        alignReferenceSeriesToWorld(reference, validationWorld.clock.startYear, validationWorld.clock.startMonth),
        simulatedMetricSeries(reference.metric, points),
      )));
      setRunning(false);
    }, 0);
  };
  return <><Section title="Экономическая лаборатория" meta="Детерминированный контрфактический клон" /><section className="lab-layout"><article className="panel lab-controls"><label>Страна<select value={countryId} onChange={(event) => setCountryId(event.target.value)}>{world.countries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}</select></label><label>Исторический старт<select value={historicalYear} onChange={(event) => setHistoricalYear(Number(event.target.value))}>{[2019,2020,2021,2022,2023].map((year) => <option key={year} value={year}>{year}</option>)}</select></label><label>Режим ставки<select value={policyMode} onChange={(event) => setPolicyMode(event.target.value as typeof policyMode)}><option value="RATE_SHOCK">Шок ставки</option><option value="RATE_PATH">Траектория ставки</option><option value="POLICY_RULE_SHIFT">Сдвиг правила ЦБ</option></select></label><label>Изменение ставки, п.п.<input type="number" value={rateDelta/100} step="0.25" onChange={(event) => setRateDelta(Math.round(Number(event.target.value)*100))} /></label><label>Длительность<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value="3">3 месяца</option><option value="6">6 месяцев</option><option value="12">1 год</option><option value="24">2 года</option></select></label><label>Горизонт<select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}><option value="6">6 месяцев</option><option value="12">1 год</option><option value="24">2 года</option></select></label><button className="primary" disabled={running} onClick={run}>{running ? "Расчёт…" : "Сравнить миры"}</button><button onClick={() => { void validate(); }}>Сверить с {historicalYear}–2023</button></article><div>{result ? <><section className="kpi-grid two">{result.deltas.map((delta) => <Kpi key={delta.metric} label={delta.metric} value={number.format(delta.delta)} note={`${number.format(delta.baseline)} → ${number.format(delta.counterfactual)}`} open={() => undefined} />)}</section><article className="panel diagnostic-card"><header className="panel-title"><h2>Наблюдаемая цепочка</h2><span>{result.deterministicFingerprint}</span></header><div className="diagnostic-list">{result.causalChain.map((link,index) => <div key={`${link.to}-${index}`}><span>{link.from} → {link.to}</span><strong>{number.format(link.observedContribution)}</strong></div>)}</div></article></> : <article className="panel empty">Задайте изменение и запустите сравнение.</article>}{validation.length > 0 && <article className="panel diagnostic-card"><header className="panel-title"><h2>Историческая проверка</h2><span>{validation.length} рядов</span></header><div className="diagnostic-list">{validation.map((item) => <div key={item.seriesId}><span>{item.seriesId} · корр. {percent(item.correlationBps)}</span><strong>RMSE {number.format(item.rootMeanSquaredError)}</strong></div>)}</div></article>}</div></section></>;
}

function Control({ world }: { world: WorldState }) {
  const [tab, setTab] = useState<"performance" | "save" | "ledger" | "finance" | "countries">("performance");
  const invariants = checkInvariants(world);
  const events = world.events.filter((event) => event.type !== "MonthClosed" && event.type !== "AccountingPeriodClosed").slice(-12).reverse();
  const diagnostics = world.diagnostics;
  const breakdown = diagnostics.saveBreakdown;
  const derivativeRecords = [...world.derivativeContracts.map((contract) => ({ type: contract.type, motive: contract.decision?.motive ?? "Без мотива" })), ...world.history.compactedDerivativeRecords.map((contract) => ({ type: contract.type, motive: contract.motive ?? "Без мотива" }))];
  const derivativesByType = countLabels(derivativeRecords, (contract) => contract.type);
  const derivativesByMotive = countLabels(derivativeRecords, (contract) => contract.motive);
  const saveRows = [["Реестр", breakdown.ledgerBytes], ["Рынки", breakdown.marketsBytes], ["История", breakdown.historyBytes], ["Деривативы", breakdown.derivativesBytes], ["Компании", breakdown.companiesBytes], ["Население", breakdown.populationBytes], ["Госдолг", breakdown.sovereignBytes], ["Прочее", breakdown.otherBytes]] as const;
  return <>
    <Section title="Контроль" meta={`${invariants.filter((item) => item.ok).length}/${invariants.length} проверок пройдено`} />
    <section className="kpi-grid four">
      <Kpi label="Население" value={diagnostics.populationRepresented.toLocaleString("ru-RU")} note={`${diagnostics.highFidelityPersons} персон подробно`} open={() => undefined} />
      <Kpi label="Фирмы" value={diagnostics.businessesRepresented.toLocaleString("ru-RU")} note={`${diagnostics.explicitFirms} подробно`} open={() => undefined} />
      <Kpi label="Горячий реестр" value={diagnostics.ledgerHotTransactions.toLocaleString("ru-RU")} note={`${diagnostics.ledgerArchivedTransactions.toLocaleString("ru-RU")} в архиве`} open={() => undefined} />
      <Kpi label="Размер сохранения" value={`${number.format(diagnostics.estimatedSaveBytes / 1_000_000)} МБ`} note={`${diagnostics.deterministicWorkUnits} расчётных единиц`} open={() => undefined} />
    </section>
    <div className="diagnostic-tabs" role="tablist">
      {[["performance", "Производительность"], ["save", "Сохранение"], ["ledger", "Реестр"], ["finance", "Автономные финансы"], ["countries", "Данные стран"]].map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}
    </div>
    {tab === "performance" && <section className="diagnostic-grid"><article className="panel diagnostic-card"><header className="panel-title"><h2>Память</h2><span>{diagnostics.memoryPressure === "normal" ? "Норма" : diagnostics.memoryPressure === "elevated" ? "Повышена" : "Высокая"}</span></header><dl><div><dt>Размер мира</dt><dd>{number.format(diagnostics.estimatedSaveBytes / 1_000_000)} МБ</dd></div><div><dt>Расчётные единицы</dt><dd>{diagnostics.deterministicWorkUnits.toLocaleString("ru-RU")}</dd></div><div><dt>Записи истории</dt><dd>{diagnostics.historyRecordCount.toLocaleString("ru-RU")}</dd></div><div><dt>Активные заявки</dt><dd>{diagnostics.activeMarketOrders.toLocaleString("ru-RU")}</dd></div></dl></article><article className="panel diagnostic-card"><header className="panel-title"><h2>Масштаб</h2><span>{world.clock.elapsedMonths} мес.</span></header><dl><div><dt>Население</dt><dd>{diagnostics.populationRepresented.toLocaleString("ru-RU")}</dd></div><div><dt>Фирмы</dt><dd>{diagnostics.businessesRepresented.toLocaleString("ru-RU")}</dd></div><div><dt>Подробные персоны</dt><dd>{diagnostics.highFidelityPersons}</dd></div><div><dt>Подробные компании</dt><dd>{diagnostics.explicitFirms}</dd></div></dl></article></section>}
    {tab === "save" && <article className="panel diagnostic-card"><header className="panel-title"><h2>Состав сохранения</h2><span>{number.format(breakdown.totalBytes / 1_000_000)} МБ</span></header><div className="diagnostic-table">{saveRows.map(([label, bytes]) => <div key={label}><span>{label}</span><strong>{number.format(bytes / 1_000_000)} МБ</strong><i style={{ width: `${Math.max(1, bytes * 100 / Math.max(1, breakdown.totalBytes))}%` }} /></div>)}</div></article>}
    {tab === "ledger" && <section className="diagnostic-grid"><article className="panel diagnostic-card"><header className="panel-title"><h2>Уровни реестра</h2><span>Сбалансировано</span></header><dl><div><dt>Горячий</dt><dd>{world.ledger.transactions.length.toLocaleString("ru-RU")}</dd></div><div><dt>Важные детали</dt><dd>{world.history.importantLedgerTransactions.length.toLocaleString("ru-RU")}</dd></div><div><dt>Сжатые операции</dt><dd>{diagnostics.ledgerCompactedTransactions.toLocaleString("ru-RU")}</dd></div><div><dt>Сжатые группы</dt><dd>{world.history.compactedLedgerRecords.length.toLocaleString("ru-RU")}</dd></div></dl></article><article className="panel diagnostic-card"><header className="panel-title"><h2>Глубина</h2><span>{world.history.policy.hotLedgerMonths}/{world.history.policy.playerDetailMonths} мес.</span></header><dl><div><dt>Горячий период</dt><dd>{world.history.policy.hotLedgerMonths} мес.</dd></div><div><dt>Детали игрока</dt><dd>{world.history.policy.playerDetailMonths} мес.</dd></div><div><dt>Рынки</dt><dd>{world.history.policy.marketDetailMonths} мес.</dd></div><div><dt>Отчёты компаний</dt><dd>{world.history.policy.companyReportMonths} мес.</dd></div></dl></article></section>}
    {tab === "finance" && <section className="diagnostic-grid"><article className="panel diagnostic-card"><header className="panel-title"><h2>Контракты</h2><span>{derivativeRecords.length}</span></header><div className="diagnostic-list">{derivativesByType.map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div></article><article className="panel diagnostic-card"><header className="panel-title"><h2>Мотивы</h2><span>{diagnostics.activeDerivativeContracts} активных</span></header><div className="diagnostic-list">{derivativesByMotive.map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div></article></section>}
    {tab === "countries" && <><article className="panel diagnostic-card"><header className="panel-title"><h2>Сверка реального старта</h2><span>{world.realWorldInitializationReports.filter((report) => report.withinTolerance).length}/{world.realWorldInitializationReports.length || world.countries.length}</span></header>{world.realWorldInitializationReports.length ? <div className="country-data-table"><header><span>Страна</span><span>ВВП</span><span>Долг/ВВП</span><span>Торговля/ВВП</span><span>Покрытие</span></header>{world.realWorldInitializationReports.map((report) => <div key={report.countryId}><strong>{report.countryId.toUpperCase()}</strong><span>{percent(Math.round((report.productionApproachMinor-report.targetMonthlyNominalGdpMinor)*10_000/Math.max(1,report.targetMonthlyNominalGdpMinor)))}</span><span>{percent(report.actualDebtToGdpBps)}</span><span>{percent(report.actualTradeToGdpBps)}</span><span>{Object.values(report.coverage).filter((value) => value !== "MISSING").length}/{Object.keys(report.coverage).length}</span></div>)}</div> : <p className="empty">Синтетический режим: сверка с реальными baseline не применяется.</p>}</article><article className="panel diagnostic-card"><header className="panel-title"><h2>Профили стран</h2><span>{world.countryEconomicProfiles.length}</span></header><div className="country-data-table"><header><span>Страна</span><span>Население</span><span>Инфляция</span><span>Безработица</span><span>Источник</span></header>{world.countryEconomicProfiles.map((profile) => <div key={profile.countryId}><strong>{profile.countryId.toUpperCase()}</strong><span>{number.format(profile.population / 1_000_000)} млн</span><span>{percent(profile.inflationBps)}</span><span>{percent(profile.unemploymentBps)}</span><span>{profile.metadata.sourceType} · {profile.metadata.baseYear}</span></div>)}</div></article></>}
    <section className="invariant-grid">{invariants.map((item) => <article className={`invariant ${item.ok ? "pass" : "fail"}`} key={item.id}><span>{item.ok ? "Норма" : "Ошибка"}</span><div><small>{item.section}</small><h2>{item.title}</h2><p>{item.detail}</p></div></article>)}</section>
    <article className="panel"><header className="panel-title"><h2>Причинные события</h2><span>{world.events.length}</span></header><div className="event-grid">{events.map((event) => <article key={event.id}><i className={event.severity} /><span><b>{event.title}</b><small>{event.detail}</small></span><time>{event.elapsedMonth + 1}м</time></article>)}</div></article>
  </>;
}

*/
const UPDATE_LABELS: Record<UpdateState, string> = {
  unsupported: "Не поддерживается",
  current: "Актуальная версия",
  checking: "Проверка…",
  available: "Доступно обновление",
  applying: "Обновление…",
  offline: "Нет сети",
  error: "Ошибка проверки",
};

function Progression({ world }: { world: WorldState }) {
  const experience = world.player.experience;
  const reputation = world.player.reputation;
  const required = experience.level < 50 ? xpRequiredForLevel(experience.level) : 0;
  const unlocks = nextUnlocks(world);
  const bands = [[1, 5, "Обычная жизнь"], [6, 10, "Частный инвестор"], [11, 15, "Профессиональные рынки"], [16, 20, "Предприниматель"], [21, 25, "Владелец бизнеса"], [26, 30, "Корпоративный игрок"], [31, 35, "Управляющий активами"], [36, 40, "Частный капитал"], [41, 45, "Финансовая элита"], [46, 50, "Системный игрок"]] as const;
  return <><Section title="Профиль" meta={`Уровень ${experience.level} из 50`} /><section className="profile-grid"><article className="panel level-card"><span>УРОВЕНЬ</span><strong>{experience.level}</strong><div className="xp-track"><i style={{ width: `${experience.level === 50 ? 100 : Math.min(100, experience.currentXp * 100 / Math.max(1, required))}%` }} /></div><small>{experience.level === 50 ? "Максимальный уровень" : `${experience.currentXp.toLocaleString("ru-RU")} / ${required.toLocaleString("ru-RU")} опыта`}</small></article><article className="panel reputation-card"><span>РЕПУТАЦИЯ</span><strong>{reputation.score}</strong><small>{reputationTier(reputation.score)}</small></article></section>
    <section className="two-column"><article className="panel"><header className="panel-title"><h2>Следующие открытия</h2><span>{unlocks.length}</span></header><div className="unlock-list">{unlocks.map((item) => <div key={item.featureId}><b>Уровень {item.minimumLevel}</b><span>{item.label}</span></div>)}</div></article><article className="panel"><header className="panel-title"><h2>Последний опыт</h2><span>Опыт</span></header><div className="unlock-list">{experience.xpEvents.slice(-6).reverse().map((event) => <div key={event.id}><b>+{event.xp}</b><span>{event.reason}</span></div>)}{!experience.xpEvents.length && <p className="empty">Опыт появится после значимых действий.</p>}</div></article></section>
    <article className="panel"><header className="panel-title"><h2>Этапы</h2><span>1–50</span></header><div className="level-bands">{bands.map(([from, to, label]) => <div className={experience.level >= from && experience.level <= to ? "active" : experience.level > to ? "complete" : ""} key={from}><b>{from}–{to}</b><span>{label}</span></div>)}</div></article>
    <article className="panel"><header className="panel-title"><h2>История репутации</h2><span>{reputation.history.length}</span></header><div className="unlock-list">{reputation.history.slice(-8).reverse().map((event) => <div key={event.id}><b className={event.delta > 0 ? "positive" : "negative"}>{event.delta > 0 ? "+" : ""}{event.delta}</b><span>{event.event}<small>{event.reason}</small></span></div>)}{!reputation.history.length && <p className="empty">Репутация нейтральная.</p>}</div></article></>;
}

function InformationPanel({ world }: { world: WorldState }) {
  const playerId = world.player.householdId;
  const beliefs = world.information.beliefs.filter((item) => item.agentId === playerId || item.agentId === "PUBLIC").sort((a, b) => b.updatedAtMonth - a.updatedAtMonth).slice(0, 40);
  const ownedAgentIds = new Set([playerId, ...world.companies.filter((item) => item.ownerHouseholdId === playerId).map((item) => item.id), ...world.assetManagers.filter((item) => item.ownerId === playerId).map((item) => item.id)]);
  const traces = world.information.decisionTraces.filter((item) => ownedAgentIds.has(item.agentId)).slice(-12).reverse();
  const metricLabels: Record<string, string> = { "gdp-growth-bps": "Рост ВВП", "financial-stress-bps": "Финансовый стресс", "operating-cash-flow": "Операционный поток", "readiness-bps": "Готовность", "stockpile-minor": "Запасы", "diligence-risk-bps": "Риск проверки" };
  const statusLabels: Record<string, string> = { OBSERVED: "НАБЛЮДЕНИЕ", ESTIMATED: "ОЦЕНКА", STALE: "УСТАРЕЛО", INTERNAL: "ВНУТРЕННЕЕ", PUBLIC: "ПУБЛИЧНОЕ", UNKNOWN: "НЕИЗВЕСТНО", NO_ACCESS: "НЕТ ДОСТУПА" };
  return <><Section title="Данные и оценки" meta={`${beliefs.length} доступных оценок`} /><section className="kpi-grid four"><article className="kpi"><span>Источники</span><strong>{world.information.sources.length}</strong><small>Доступные и институциональные</small></article><article className="kpi"><span>Оценки</span><strong>{world.information.beliefs.length}</strong><small>Разреженное хранилище</small></article><article className="kpi"><span>Сюрпризы</span><strong>{world.information.surprises.length}</strong><small>Ожидание ≠ результат</small></article><article className="kpi"><span>Возраст данных</span><strong>{beliefs.length ? `${Math.round(beliefs.reduce((sum, item) => sum + item.informationAge, 0) / beliefs.length)} мес.` : "—"}</strong><small>Среднее</small></article></section><article className="panel"><header className="panel-title"><h2>Доступная информация</h2><span>Истина скрыта</span></header><div className="information-table"><header><span>Показатель</span><span>Значение</span><span>Диапазон</span><span>Статус</span><span>Обновлено</span></header>{beliefs.map((item) => <div key={item.id}><span><b>{metricLabels[item.metricId] ?? item.metricId}</b><small>{entityLabel(world, item.subjectId)}</small></span><strong>{item.metricId.includes("bps") ? percent(item.observedValue) : number.format(item.observedValue)}</strong><span>{number.format(item.lowerBound)}–{number.format(item.upperBound)}</span><i className={item.confidence.toLowerCase()}>{statusLabels[item.status]} · {item.confidence}</i><span>{item.informationAge} мес.</span></div>)}</div>{!beliefs.length && <p className="empty">Публичные данные появятся после первых статистических релизов.</p>}</article><article className="panel"><header className="panel-title"><h2>Почему: ожидание и результат</h2><span>{traces.length}</span></header><div className="decision-traces">{traces.map((trace) => <div key={trace.id}><span><b>{trace.decisionType}</b><small>{trace.decision}</small></span><span><small>Было известно</small>{Object.entries(trace.beliefValues).map(([key, value]) => `${metricLabels[key] ?? key}: ${number.format(value)}`).join(" · ") || "нет данных"}</span><strong>{trace.realizedResult === null ? "Результат ожидается" : `Факт: ${number.format(trace.realizedResult)}`}</strong></div>)}{!traces.length && <p className="empty">Решения ваших организаций появятся здесь.</p>}</div></article></>;
}

function LockedFeature({ view }: { view: View }) {
  const feature = FEATURE_UNLOCKS.find((item) => item.featureId === view);
  return <><Section title={feature?.label ?? "Раздел"} meta="ОБНАРУЖЕНО" /><article className="panel locked-feature"><span>УРОВЕНЬ {feature?.minimumLevel ?? "—"}</span><h2>Раздел пока закрыт</h2><p>Следующее открытие видно в профиле.</p></article></>;
}

function Settings({ world, commit, repository, updateState, autosaveState, checkUpdate, updateNow, forceUpdate }: { world: WorldState; commit: () => void; repository: SaveRepository; updateState: UpdateState; autosaveState: string; checkUpdate: () => void; updateNow: () => void; forceUpdate: () => void }) {
  const [persistence, setPersistence] = useState<PersistenceDiagnostics | null>(null);
  const [worker, setWorker] = useState<{ controlled: boolean; state: string; scriptUrl: string | null; cacheNames: string[] } | null>(null);
  useEffect(() => { void Promise.all([repository.diagnostics(), serviceWorkerDiagnostics()]).then(([storage, serviceWorker]) => { setPersistence(storage); setWorker(serviceWorker); }); }, [repository, updateState, autosaveState]);
  const preferences = world.player.interfacePreferences;
  const toggle = (key: "progressiveInterface" | "showLockedSections" | "fullInterface" | "developerTrueState" | "skippedTutorials") => { setInterfacePreference(world, key, !preferences[key]); commit(); };
  return <><Section title="Настройки" meta={`Версия ${APP_BUILD.version}`} /><section className="settings-grid"><article className="panel settings-card"><header className="panel-title"><h2>Интерфейс</h2><span>{preferences.fullInterface ? "Полный" : preferences.progressiveInterface ? "Прогрессивный" : "Все разделы"}</span></header><div className="toggle-list"><button className={preferences.progressiveInterface ? "active" : ""} onClick={() => toggle("progressiveInterface")}><span>Прогрессивный интерфейс</span><b>{preferences.progressiveInterface ? "ВКЛ" : "ВЫКЛ"}</b></button><button className={preferences.showLockedSections ? "active" : ""} onClick={() => toggle("showLockedSections")}><span>Показывать закрытые разделы</span><b>{preferences.showLockedSections ? "ВКЛ" : "ВЫКЛ"}</b></button><button className={preferences.fullInterface ? "active" : ""} onClick={() => toggle("fullInterface")}><span>Показать весь интерфейс</span><b>{preferences.fullInterface ? "ВКЛ" : "ВЫКЛ"}</b></button><button className={preferences.developerTrueState ? "danger active" : ""} onClick={() => toggle("developerTrueState")}><span>Диагностика истинного состояния</span><b>{preferences.developerTrueState ? "ВКЛ" : "ВЫКЛ"}</b></button><button className={preferences.skippedTutorials ? "active" : ""} onClick={() => toggle("skippedTutorials")}><span>Пропустить подсказки</span><b>{preferences.skippedTutorials ? "ДА" : "НЕТ"}</b></button></div><small>Полный интерфейс не меняет уровень, деньги, права действий или доступ к закрытым данным.</small></article><article className="panel settings-card"><header className="panel-title"><h2>Приложение</h2><span>{UPDATE_LABELS[updateState]}</span></header><dl><div><dt>Версия</dt><dd>{APP_BUILD.version}</dd></div><div><dt>Сборка</dt><dd>{APP_BUILD.buildId}</dd></div><div><dt>Коммит</dt><dd>{APP_BUILD.commit}</dd></div><div><dt>Дата сборки</dt><dd>{new Date(APP_BUILD.buildDate).toLocaleString("ru-RU")}</dd></div></dl><footer><button onClick={checkUpdate}>Проверить</button><button className="primary" onClick={updateNow}>Обновить сейчас</button><button className="danger" onClick={forceUpdate}>Принудительно обновить</button></footer></article><article className="panel settings-card"><header className="panel-title"><h2>Сохранение</h2><span>{autosaveState}</span></header><dl><div><dt>Активный мир</dt><dd>{persistence?.activeWorldId ?? "—"}</dd></div><div><dt>Последняя запись</dt><dd>{persistence?.lastAutosaveIso ? new Date(persistence.lastAutosaveIso).toLocaleString("ru-RU") : "—"}</dd></div><div><dt>Время записи</dt><dd>{persistence?.lastSaveDurationMs != null ? `${number.format(persistence.lastSaveDurationMs)} мс` : "—"}</dd></div><div><dt>Размер мира</dt><dd>{persistence?.lastSaveBytes ? `${number.format(persistence.lastSaveBytes / 1_000_000)} МБ` : "—"}</dd></div><div><dt>Схема хранилища</dt><dd>{persistence?.databaseVersion ?? "—"}</dd></div><div><dt>Использовано</dt><dd>{persistence?.usageBytes ? `${number.format(persistence.usageBytes / 1_000_000)} МБ` : "—"}</dd></div></dl></article><article className="panel settings-card"><header className="panel-title"><h2>Офлайн</h2><span>{worker?.controlled ? "Активен" : "Подготовка"}</span></header><dl><div><dt>Фоновое обновление</dt><dd>{worker?.state ?? "—"}</dd></div><div><dt>Кэши приложения</dt><dd>{worker?.cacheNames.filter((name) => name.startsWith("economic-world-app-")).length ?? 0}</dd></div><div><dt>Сценарий</dt><dd>{worker?.scriptUrl?.split("/").at(-1) ?? "—"}</dd></div><div><dt>Данные мира</dt><dd>IndexedDB не очищается при обновлении</dd></div></dl></article></section></>;
}

function Onboarding({ world, complete }: { world: WorldState; complete: (name: string) => void }) {
  const [name, setName] = useState(playerPerson(world).displayName === "Игрок" ? "" : playerPerson(world).displayName);
  return <div className="modal-layer onboarding-layer"><section className="onboarding" role="dialog" aria-modal="true"><span>ECONOMIC WORLD</span><h1>Начало студенческой жизни</h1><p>19 лет · Москва · среднее образование · 35 000 ₽. Сначала выберите институт и получите профессию.</p><label>Имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Игрок" /></label><button className="primary" onClick={() => complete(name)}>Начать</button></section></div>;
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
  const lastCheckpointMonth = useRef(0);
  const viewRef = useRef<View>(view);
  const activeRun = useRef<SimulationRun | null>(null);
  const moreDragStart = useRef<number | null>(null);
  const repository = useMemo(() => new SaveRepository(), []);
  const commit = useCallback(() => { setWorld({ ...worldRef.current }); }, []);
  const completeBoot = useCallback(() => { try { sessionStorage.setItem("economic-world-booted-v2", "1"); } catch { /* недоступно */ } setShowBoot(false); }, []);
  const openWhy = useCallback((title: string, text: string) => setWhy({ title, text }), []);

  const saveActiveNow = useCallback(async () => {
    const snapshot = worldRef.current;
    const cityId = snapshot.player.currentCityId;
    const countryId = snapshot.cities.find((city) => city.id === cityId)?.countryId;
    setAutosaveState("Сохранение…");
    autosaveChain.current = autosaveChain.current.then(() => repository.saveActive(snapshot, { route: viewRef.current, cityId, countryId })).then(() => { lastCheckpointMonth.current = snapshot.clock.elapsedMonths; setAutosaveState("Сохранено"); }).catch(() => setAutosaveState("Ошибка сохранения"));
    await autosaveChain.current;
  }, [repository]);

  useEffect(() => { repository.list().then(setSaves).catch(() => setSaves([])); }, [repository]);
  useEffect(() => {
    let active = true;
    void repository.loadActive().then((restored) => {
      if (!active || !restored) return;
      worldRef.current = restored.world;
      lastCheckpointMonth.current = restored.world.clock.elapsedMonths;
      setWorld(restored.world);
      if (restored.uiState && NAV.some((item) => item.id === restored.uiState!.route) && isFeatureVisible(restored.world, restored.uiState.route)) setView(restored.uiState.route as View);
      else setView("life");
      setNotice(restored.recovered ? "Восстановлена резервная контрольная точка" : "Активный мир восстановлен");
    }).catch(() => setNotice("Создан новый мир")).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [repository]);
  useEffect(() => {
    void registerAppServiceWorker(() => setUpdateState("available"));
  }, []);
  useEffect(() => {
    viewRef.current = view;
    if (restoring) return;
    const snapshot = worldRef.current;
    const cityId = snapshot.player.currentCityId;
    const countryId = snapshot.cities.find((city) => city.id === cityId)?.countryId;
    const timer = window.setTimeout(() => { void repository.saveUiState({ route: view, cityId, countryId }); }, 250);
    return () => window.clearTimeout(timer);
  }, [view, restoring, repository]);
  useEffect(() => {
    if (restoring) return;
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    const simulationCheckpointDue = world.clock.elapsedMonths - lastCheckpointMonth.current >= 3;
    autosaveTimer.current = window.setTimeout(() => { void saveActiveNow(); }, simulationCheckpointDue ? 3_000 : 30_000);
    return () => { if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current); };
  }, [world, restoring, saveActiveNow]);
  const advance = useCallback(async (months: number, pause = true) => {
    if (busy) return;
    setBusy(true); if (pause) setPlaying(false); setProgress(0);
    const run = runSimulationOffThread(worldRef.current, months, (completed, total) => setProgress(Math.round(completed * 100 / Math.max(1, total))));
    activeRun.current = run;
    try {
      const result = await run.promise;
      worldRef.current = result;
      commit();
      setProgress(100);
      setNotice(`Выполнено: ${months} мес.`);
    } catch (error) {
      setNotice(error instanceof DOMException && error.name === "AbortError" ? "Расчёт остановлен" : "Ошибка расчёта");
    } finally {
      activeRun.current = null;
      setBusy(false);
    }
  }, [busy, commit]);
  useEffect(() => { if (!playing || busy || restoring) return; const timer = window.setTimeout(() => { void advance(speed, false); }, 1_000); return () => window.clearTimeout(timer); }, [playing, busy, restoring, speed, advance]);
  const save = async () => { setBusy(true); try { await repository.save(worldRef.current, "Ручное сохранение", "manual"); setSaves(await repository.list()); setNotice("Мир сохранён"); } finally { setBusy(false); } };
  const load = async () => { const target = saves[0]; if (!target) return; setBusy(true); try { worldRef.current = await repository.load(target.id); commit(); setNotice("Сохранение загружено"); } finally { setBusy(false); } };
  const reset = () => { if (!window.confirm("Создать новый мир?")) return; const real = window.confirm("Использовать калиброванный реальный мир?\nОК — реальный baseline 2023; Отмена — синтетический мир."); worldRef.current = createWorld("baseline", { mode: real ? "REAL_WORLD" : "SYNTHETIC" }); commit(); setPlaying(false); setShowOnboarding(true); setNotice(real ? "Реальный мир создан · данные являются модельной калибровкой, а не точной копией реальности" : "Синтетический мир создан"); };
  const profile = (name: string) => { setPlayerProfile(worldRef.current, name, "student"); commit(); setView("life"); try { localStorage.setItem("economic-world-onboarded-v2", "1"); } catch { /* недоступно */ } setShowOnboarding(false); };
  const checkUpdate = async () => { setUpdateState("checking"); setUpdateState(await checkForUpdate()); };
  const updateNow = async (force = false) => { setUpdateState("applying"); try { await applyAppUpdate(saveActiveNow, force); } catch { setUpdateState("error"); } };
  // Диагностика не должна уронить весь интерфейс, если старое или частично
  // записанное сохранение не содержит одного из новых диагностических полей.
  const passing = useMemo(() => {
    try { return checkInvariants(world).every((item) => item.ok); }
    catch { return false; }
  }, [world]);
  const visibleNav = useMemo(() => NAV.filter((item) => isFeatureVisible(world, item.id)), [world]);
  const mobilePrimary = useMemo(() => MOBILE_PRIORITY.map((id) => visibleNav.find((item) => item.id === id)).filter((item): item is (typeof NAV)[number] => Boolean(item)).slice(0, 4), [visibleNav]);
  const mobileMore = useMemo(() => visibleNav.filter((item) => !mobilePrimary.some((primary) => primary.id === item.id)), [visibleNav, mobilePrimary]);
  const currentAccess = featureAccess(world, view);
  const lockedView = world.player.interfacePreferences.progressiveInterface && !world.player.interfacePreferences.fullInterface && currentAccess === "DISCOVERED_LOCKED";
  const netWorth = valueInReportingCurrency(world, world.player.householdId, world.player.reportingCurrencyId).totalMinor;

  return <>
    {showBoot && <BootSequence onComplete={completeBoot} />}
    {!showBoot && showOnboarding && <Onboarding world={world} complete={profile} />}
    {restoring && <div className="restore-screen"><span>Восстановление мира…</span></div>}
    <WhyModal value={why} close={() => setWhy(null)} />
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>EW</span><div><b>ECONOMIC WORLD</b><small>Экономическая система</small></div></div>
        <nav>{visibleNav.map((item, index) => { const access = featureAccess(world, item.id); return <button className={`${view === item.id ? "active" : ""} ${access === "DISCOVERED_LOCKED" ? "locked" : ""}`} key={item.id} onClick={() => setView(item.id)}><span>{access === "DISCOVERED_LOCKED" ? "—" : String(index + 1).padStart(2, "0")}</span>{item.label}</button>; })}</nav>
        <footer><i className={passing ? "ok" : "fail"} /><span>{passing ? "Система в норме" : "Есть нарушение"}</span></footer>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="date"><span>Дата мира</span><strong>{formatSimulationDate(world.clock)}</strong></div>
          <div className="simulation-controls"><button onClick={() => { void advance(1); }} disabled={busy || restoring}>+1 месяц</button><button className="primary" onClick={() => setPlaying((value) => !value)} disabled={restoring}>{playing ? "Пауза" : "Запуск"}</button><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Скорость" disabled={restoring}><option value="1">1 мес./с</option><option value="3">3 мес./с</option><option value="12">12 мес./с</option></select></div>
          <button className="player-status" onClick={() => setView("progression")}><span>УР. {world.player.experience.level}</span><b>{reputationTier(world.player.reputation.score)}</b><small>{compactMoney(netWorth, world.player.reportingCurrencyId)}</small></button><div className="world-actions"><button onClick={save} disabled={busy}>Сохранить</button><button onClick={load} disabled={busy || !saves.length}>Загрузить</button><button onClick={reset} disabled={busy}>Новый мир</button></div>
        </header>
        <div className="quick-run"><span>{busy ? `Расчёт · ${progress}%` : notice}</span><div>{busy && <button className="danger" onClick={() => activeRun.current?.cancel()}>Остановить</button>}<button onClick={() => { void advance(12); }} disabled={busy}>+1 год</button><button onClick={() => { void advance(240); }} disabled={busy}>+20 лет</button></div>{busy && <i style={{ width: `${progress}%` }} />}</div>
        <main>{lockedView ? <LockedFeature view={view} /> : <>
          {view === "life" && <MyLife world={world} commit={commit} notify={setNotice} openWhy={openWhy} navigate={setView} />}
          {view === "world" && <World world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "career" && <Career world={world} commit={commit} notify={setNotice} openWhy={openWhy} navigate={setView} />}
          {view === "education" && <Education world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "finances" && <MyFinances world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "progression" && <Progression world={world} />}
          {view === "information" && <InformationPanel world={world} />}
          {view === "economy" && <Economy world={world} openWhy={openWhy} />}
          {view === "global" && <GlobalEconomy world={world} openWhy={openWhy} />}
          {view === "geoeconomics" && <Suspense fallback={<p className="empty">Загрузка…</p>}><GeoeconomicsPanel world={world} /></Suspense>}
          {view === "political-economy" && <Suspense fallback={<p className="empty">Загрузка…</p>}><PoliticalEconomyPanel world={world} /></Suspense>}
          {view === "defense" && <Suspense fallback={<p className="empty">Загрузка…</p>}><DefenseConflictPanel world={world} /></Suspense>}
          {view === "lab" && <Suspense fallback={<p className="empty">Загрузка…</p>}><EconomicLabPanel world={world} /></Suspense>}
          {view === "companies" && <Companies world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "markets" && <Markets world={world} commit={commit} notify={setNotice} openWhy={openWhy} />}
          {view === "portfolio" && <Portfolio world={world} commit={commit} notify={setNotice} />}
          {view === "banks" && <Banks world={world} openWhy={openWhy} />}
          {view === "ledger" && <Ledger world={world} openWhy={openWhy} />}
          {view === "control" && <Suspense fallback={<p className="empty">Загрузка…</p>}><DiagnosticsPanel world={world} /></Suspense>}
          {view === "settings" && <Settings world={world} commit={commit} repository={repository} updateState={updateState} autosaveState={autosaveState} checkUpdate={() => { void checkUpdate(); }} updateNow={() => { void updateNow(false); }} forceUpdate={() => { void updateNow(true); }} />}
        </>}</main>
      </div>
      <nav className="mobile-nav" aria-label="Основные разделы">{mobilePrimary.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => { setView(item.id); setMoreOpen(false); }}>{item.short}</button>)}<button className={mobileMore.some((item) => item.id === view) ? "active" : ""} onClick={() => setMoreOpen(true)}>Ещё</button></nav>
      {moreOpen && <div className="more-layer" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setMoreOpen(false); }}><section className="more-sheet" role="dialog" aria-modal="true" aria-label="Все разделы" onPointerDown={(event) => { moreDragStart.current = event.clientY; }} onPointerUp={(event) => { if (moreDragStart.current !== null && event.clientY - moreDragStart.current > 70) setMoreOpen(false); moreDragStart.current = null; }}><header><h2>Разделы</h2><button aria-label="Закрыть" onClick={() => setMoreOpen(false)}>×</button></header><div>{mobileMore.map((item) => { const access = featureAccess(world, item.id); return <button className={`${view === item.id ? "active" : ""} ${access === "DISCOVERED_LOCKED" ? "locked" : ""}`} key={item.id} onClick={() => { setView(item.id); setMoreOpen(false); }}><span>{item.label}</span><small>{access === "DISCOVERED_LOCKED" ? `Уровень ${FEATURE_UNLOCKS.find((feature) => feature.featureId === item.id)?.minimumLevel}` : "Открыть"}</small></button>; })}</div></section></div>}
    </div>
  </>;
}
