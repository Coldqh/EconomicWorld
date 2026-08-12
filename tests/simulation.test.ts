import assert from "node:assert/strict";
import test from "node:test";
import { accountIds, balanceOf, bankAccountBalance, bankAccountsForOwner, entityBook, openBankAccount, postTransaction, seedDeposit, sumAccounts, transferBankAccountBalance } from "../src/core/ledger.ts";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { deterministicFingerprint } from "../src/economy/metrics.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { acceptJobOffer, applyForJob, setPlayerProfile } from "../src/player/commands.ts";
import { playerFinancialSummary, playerPerson } from "../src/player/system.ts";
import { applyUniversity, buyDurable, enrollUniversity, rentProperty, sellDurable, startTravel } from "../src/player/world-commands.ts";
import { dematerializePerson, materializePerson } from "../src/world/fidelity.ts";
import { issueBond, raiseEquity, transferShares } from "../src/corporate/finance.ts";
import { openBrokerageAccount, placeOrder } from "../src/markets/exchange.ts";
import { executeFxConversion, valueInReportingCurrency } from "../src/finance/fx-market.ts";
import { formatMoney } from "../src/finance/currencies.ts";
import { migrateWorldState } from "../src/persistence/migrations.ts";
import { assetManagerAum, calculateFundNav, chargeFundFees, closeUnderwritingMandate, contributeToPensionFund, createUnderwritingMandate, rebalanceInstitutionalPortfolios, redeemFund, subscribeFund } from "../src/finance/institutional.ts";
import { buyToCover, chargeSecuritiesBorrowFees, checkMaintenanceMargin, compensateBorrowedDividend, forceLiquidation, marginAccountState, openMarginAccount, openRepo, placeMarginBuy, placeShortSale, pledgeSecurityCollateral, processMarginRisk, repayRepo, securityHaircutBps } from "../src/finance/leverage.ts";
import { createCreditDefaultSwap, createForward, createFuture, createFxSwap, createInterestRateSwap, createTotalReturnSwap, derivativeExposure, exerciseOption, expireOptions, forceTrsUnwind, refreshOptionQuotes, settleCdsCreditEvent, settleCdsPremium, settleForward, settleInterestRateSwap, settleTotalReturnSwap, writeOption } from "../src/finance/derivatives.ts";
import { applyClearingDefaultWaterfall, createNettingSet, settleBilateralNet, settleFuturesVariationMargin } from "../src/finance/clearing.ts";
import { impliedVolatilityBps, valueEuropeanOption } from "../src/finance/option-pricing.ts";
import { collectPropertyTaxes, createSovereignAuction, openMarketPurchase, openMarketSale, payDepositInsurance, recalculateGovernmentBudgets, requestLenderOfLastResort, restructureSovereignBond, runMonetaryPolicy, runSovereignAuction, serviceSovereignDebt, updateSovereignValuations } from "../src/economy/macroeconomics.ts";
import { settleFinancialPayment } from "../src/finance/financial-settlement.ts";
import { approvePrimeBrokerCapacity, createFxHedgeForFund, runAutonomousDerivativeDecisions } from "../src/finance/autonomous-derivatives.ts";
import { getCountryEconomicProfile } from "../src/data/country-economic-profiles.ts";
import { alignReferenceSeriesToWorld, compareCalibrationSeries, searchCalibratedParameters, simulatedMetricSeries } from "../src/economy/calibration.ts";
import { clearMultilateralCommodityMarkets, createCommodityFutureHedge, createForeignDirectInvestment, interveneFx, purchaseForeignEquity, updateSupplyChains } from "../src/economy/global-economy.ts";
import { createHistoricalValidationWorld, runEconomicLab } from "../src/economy/economic-lab.ts";
import { REAL_COUNTRY_PACKS } from "../src/data/real-world/country-packs.ts";
import { compactLedgerHistory } from "../src/world/systems.ts";
import { createCities } from "../src/world/catalog.ts";
import { createPopulationCohorts } from "../src/world/cohorts.ts";
import type { WorldState } from "../src/domain/model.ts";

function localMarket(world: WorldState, countryId = "ru") {
  const exchange = world.exchanges.find((item) => item.countryId === countryId)!;
  const listing = world.listings.find((item) => item.exchangeId === exchange.id)!;
  const banks = world.banks.filter((item) => item.countryId === countryId);
  return { exchange, listing, banks };
}

function depositMoney(world: WorldState): number {
  return sumAccounts(world, (account) => account.category === "asset" && account.instrument === "deposit");
}

test("фазы 3 и 4 создают масштабный географический мир", () => {
  const world = createWorld();
  assert.equal(world.schemaVersion, 9);
  assert.equal(world.saveVersion, 9);
  assert.equal(world.households.length, 100);
  assert.equal(world.people.length, 100);
  assert.equal(world.companies.length, 77);
  assert.equal(world.countries.length, 11);
  assert.equal(world.cities.length, 33);
  assert.equal(world.banks.length, 22);
  assert.ok(world.universities.length >= 10);
  assert.ok(world.universityPrograms.every((program) => program.durationMonths >= 24));
  assert.ok(world.diagnostics.populationRepresented >= 1_000_000);
  assert.ok(world.diagnostics.businessesRepresented >= 10_000);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("каждая страна имеет локальные компании, банки и денежную власть", () => {
  const world = createWorld();
  for (const country of world.countries) {
    assert.ok(country.companyIds.length >= 3, country.name);
    assert.ok(country.bankIds.length >= 2, country.name);
    assert.ok(country.companyIds.every((id) => world.companies.some((company) => company.id === id && company.headquartersCountryId === country.id)));
    assert.ok(country.bankIds.every((id) => world.banks.some((bank) => bank.id === id && bank.countryId === country.id)));
    assert.ok(world.centralBanks.some((bank) => bank.id === country.centralBankId && bank.currencyId === country.currencyReference));
  }
  const korea = world.countries.find((country) => country.id === "kr")!;
  assert.ok(korea.cityIds.includes("seoul"));
  const seoulCompany = world.companies.find((company) => company.headquartersCityId === "seoul")!;
  assert.ok(seoulCompany);
  assert.equal(world.ledger.accounts[`${seoulCompany.id}:asset:deposit`].currency, "KRW");
});

test("первичный и вторичный рынки акций сохраняют таблицу капитализации", () => {
  const world = createWorld();
  const company = world.companies[0];
  const security = world.equitySecurities.find((item) => item.id === company.equitySecurityId)!;
  const sharesBefore = security.sharesOutstanding;
  const buyer = "household-002";
  const primary = raiseEquity(world, company.id, buyer, 100_000, 1_000);
  assert.equal(primary.ok, true);
  assert.equal(security.sharesOutstanding, sharesBefore + 100);
  const secondary = transferShares(world, security.id, buyer, "household-003", 40, 1_100);
  assert.equal(secondary.ok, true);
  assert.equal(security.sharesOutstanding, sharesBefore + 100);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("облигация создаёт зеркальные требования и обязательства", () => {
  const world = createWorld();
  const answer = issueBond(world, world.companies[0].id, world.player.householdId, 100_000, 800, 24);
  assert.equal(answer.ok, true);
  assert.equal(world.corporateBonds.length, 1);
  assert.equal(world.bondHoldings[0].faceValueCents, world.corporateBonds[0].outstandingFaceValueCents);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "BOND_ISSUE"));
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("цена публичной компании меняется только исполненной сделкой", () => {
  const world = createWorld();
  const listing = world.listings.find((item) => item.exchangeId === "exchange-ru")!;
  const company = world.companies.find((item) => item.id === listing.companyId)!;
  const sellerId = `population-${company.headquartersCityId}-1`;
  assert.equal(openBrokerageAccount(world, sellerId).ok, true);
  assert.equal(openBrokerageAccount(world, world.player.householdId).ok, true);
  const sellerAccount = world.brokerageAccounts.find((item) => item.ownerId === sellerId)!;
  const buyerAccount = world.brokerageAccounts.find((item) => item.ownerId === world.player.householdId)!;
  const before = listing.lastPriceCents;
  assert.equal(placeOrder(world, sellerAccount.id, listing.securityId, "sell", "limit", 10, before + 25).ok, true);
  assert.equal(listing.lastPriceCents, before);
  const buy = placeOrder(world, buyerAccount.id, listing.securityId, "buy", "limit", 10, before + 25);
  assert.equal(buy.ok, true);
  assert.equal(world.marketTrades.length, 1);
  assert.equal(listing.lastPriceCents, before + 25);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("одинаковое состояние воспроизводит одинаковые 2 года", () => {
  const left = createWorld();
  const right = createWorld();
  runMonths(left, 24);
  runMonths(right, 24);
  assert.equal(deterministicFingerprint(left), deterministicFingerprint(right));
});

test("игрок получает местную работу и зарплату через общий реестр", () => {
  const world = createWorld();
  setPlayerProfile(world, "Тестовый игрок", "student");
  const answer = applyForJob(world, world.companies[0].id, "worker");
  assert.equal(answer.accepted, true);
  assert.equal(acceptJobOffer(world), true);
  runMonths(world, 1);
  assert.equal(world.households[0].employerId, world.companies[0].id);
  assert.ok(playerFinancialSummary(world).incomeCents > 0);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "WAGE" && transaction.entries.some((entry) => entry.accountId.includes(world.player.householdId))));
});

test("поступление в институт учитывает конкурс, оплату и многолетний срок", () => {
  const world = createWorld();
  setPlayerProfile(world, "Абитуриент", "student");
  const program = world.universityPrograms.find((item) => item.id === "hse-economics")!;
  assert.equal(program.durationMonths, 48);
  assert.equal(applyUniversity(world, program.id), true);
  assert.equal(enrollUniversity(world, program.id), true);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "UNIVERSITY_TUITION"));
  assert.equal(world.player.activeUniversityEnrollment?.durationMonths, 48);
  world.player.activeUniversityEnrollment!.completedMonths = 47;
  runMonths(world, 1);
  assert.ok(world.player.completedProgramIds.includes(program.id));
  assert.equal(playerPerson(world).educationLevel, "bachelor");
});

test("материализация и возврат в когорту сохраняют население и деньги", () => {
  const world = createWorld();
  const populationBefore = world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) + world.people.length;
  const moneyBefore = sumAccounts(world, (account) => account.category === "asset" && account.instrument === "deposit");
  const person = materializePerson(world, world.populationCohorts[0].id)!;
  assert.ok(person);
  assert.equal(world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) + world.people.length, populationBefore);
  assert.equal(sumAccounts(world, (account) => account.category === "asset" && account.instrument === "deposit"), moneyBefore);
  assert.equal(dematerializePerson(world, person.id), true);
  assert.equal(world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) + world.people.length, populationBefore);
  assert.equal(sumAccounts(world, (account) => account.category === "asset" && account.instrument === "deposit"), moneyBefore);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("переезд между городами оплачивается и меняет местный контур", () => {
  const world = createWorld();
  const before = playerFinancialSummary(world).depositsCents;
  assert.equal(startTravel(world, "berlin", "air", true), true);
  runMonths(world, 1);
  assert.equal(world.player.currentCityId, "berlin");
  assert.equal(playerPerson(world).cityId, "berlin");
  assert.ok(world.player.visitedCityIds.includes("berlin"));
  assert.ok(playerFinancialSummary(world).depositsCents < before);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "TRAVEL"));
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("вторичная продажа актива не добавляет ВВП", () => {
  const world = createWorld();
  const product = world.products[0];
  assert.equal(buyDurable(world, product.id), true);
  const assetId = world.player.durableAssetIds[0];
  const consumptionBefore = world.nationalAccounts.current.householdConsumptionCents;
  assert.equal(sellDurable(world, assetId, "household-002"), true);
  assert.equal(world.nationalAccounts.current.householdConsumptionCents, consumptionBefore);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "USED_ASSET"));
});

test("национальные счета, рынки и концентрация сходятся после года", () => {
  const world = createWorld();
  runMonths(world, 12);
  const metric = world.metricsHistory.at(-1)!;
  assert.equal(metric.gdpValueAddedCents, metric.gdpExpenditureCents);
  assert.equal(metric.gdpReconciliationGapCents, 0);
  assert.ok(Object.values(metric.marketConcentrationBpsByGood).every((value) => value >= 0 && value <= 10_000));
  assert.ok(world.companies.every((company) => company.financialReports.length > 0));
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("старое сохранение мигрирует в мультивалютную схему без потери Player", () => {
  const legacy = structuredClone(createWorld()) as unknown as Record<string, unknown>;
  const legacyWorld = legacy as unknown as WorldState;
  for (const account of Object.values(legacyWorld.ledger.accounts)) account.currency = "RUB";
  const dynamicCompany = { ...structuredClone(legacyWorld.companies[0]), id: "company-legacy-dynamic", name: "Legacy Dynamic" };
  legacyWorld.companies.push(dynamicCompany);
  legacy.schemaVersion = 4;
  legacy.saveVersion = 4;
  delete legacy.bankAccounts;
  delete legacy.currencies;
  delete legacy.monetaryAreas;
  delete legacy.fxPairs;
  delete legacy.fxTrades;
  delete legacy.fxDealers;
  const migrated = migrateWorldState(legacy);
  assert.equal(migrated.schemaVersion, 9);
  assert.ok(bankAccountsForOwner(migrated, migrated.player.householdId, "RUB").length > 0);
  assert.ok(migrated.bankAccounts.every((account) => migrated.ledger.accounts[account.ledgerDepositAccountId]));
  assert.equal(migrated.player.personId, "person-player");
  assert.ok(migrated.companies.some((company) => company.id === dynamicCompany.id));
  assert.deepEqual(checkInvariants(migrated).filter((item) => !item.ok), []);
});

test("сохранение v6 мигрирует в v8 с профилями, историей и стратегиями фондов", () => {
  const legacy = structuredClone(createWorld()) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 6;
  legacy.saveVersion = 6;
  delete legacy.countryEconomicProfiles;
  delete legacy.monetaryAreaProfiles;
  delete legacy.history;
  const funds = legacy.funds as Array<Record<string, unknown>>;
  for (const fund of funds) { delete fund.strategyProfileId; delete fund.primeBrokerIds; }
  const migrated = migrateWorldState(legacy);
  assert.equal(migrated.schemaVersion, 9);
  assert.equal(migrated.countryEconomicProfiles.length, migrated.countries.length);
  assert.ok(migrated.history.policy.hotLedgerMonths > 0);
  assert.ok(migrated.funds.every((fund) => fund.strategyProfileId && fund.primeBrokerIds.length > 0));
  assert.deepEqual(checkInvariants(migrated).filter((item) => !item.ok), []);
  assert.equal(deterministicFingerprint(migrateWorldState(JSON.parse(JSON.stringify(migrated)))), deterministicFingerprint(migrated));
});

test("RUB и USD существуют одновременно, а FX сохраняет каждую валюту", () => {
  const world = createWorld();
  const ownerId = world.player.householdId;
  const rub = bankAccountsForOwner(world, ownerId, "RUB")[0];
  const usBank = world.banks.find((bank) => bank.baseCurrency === "USD")!;
  const opened = openBankAccount(world, ownerId, usBank.id);
  assert.equal(opened.ok, true);
  const usd = world.bankAccounts.find((account) => account.id === opened.accountId)!;
  const total = (currencyId: string) => world.bankAccounts.filter((account) => account.currencyId === currencyId).reduce((sum, account) => sum + bankAccountBalance(world, account.id), 0);
  const rubBefore = total("RUB");
  const usdBefore = total("USD");
  const sourceBefore = bankAccountBalance(world, rub.id);
  const trade = executeFxConversion(world, ownerId, rub.id, usd.id, 100_000);
  assert.equal(trade.ok, true);
  assert.equal(total("RUB"), rubBefore);
  assert.equal(total("USD"), usdBefore);
  assert.equal(bankAccountBalance(world, rub.id), sourceBefore - 100_000);
  assert.ok(bankAccountBalance(world, usd.id) > 0);
  assert.equal(transferBankAccountBalance(world, rub.id, usd.id, 1_000, "TRANSFER", "Запрещённый 1:1 перевод"), null);
  assert.equal(world.fxTrades.length, 1);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("повторные FX-сделки используют накопительные clearing accounts", () => {
  const world = createWorld();
  const ownerId = world.player.householdId;
  const from = world.bankAccounts.find((account) => account.ownerId === ownerId && account.currencyId === "RUB")!;
  const foreignBank = world.banks.find((bank) => bank.baseCurrency === "USD")!;
  const opened = openBankAccount(world, ownerId, foreignBank.id);
  assert.ok(opened.ok && opened.accountId);
  const to = world.bankAccounts.find((account) => account.id === opened.accountId)!;
  assert.ok(executeFxConversion(world, ownerId, from.id, to.id, 1_000).ok);
  assert.ok(executeFxConversion(world, ownerId, from.id, to.id, 1_000).ok);
  const positionAccounts = Object.values(world.ledger.accounts).filter((account) => account.id.includes(":equity:fx-position:"));
  assert.equal(positionAccounts.length, 4);
});

test("еврозона имеет общую денежную власть, а отчётная валюта использует FX", () => {
  const world = createWorld();
  const euroCountries = world.countries.filter((country) => country.currencyReference === "EUR");
  assert.ok(euroCountries.length >= 5);
  assert.equal(new Set(euroCountries.map((country) => country.monetaryAreaId)).size, 1);
  const area = world.monetaryAreas.find((item) => item.id === euroCountries[0].monetaryAreaId)!;
  assert.equal(area.monetaryAuthorityId, "monetary-authority-eur");
  assert.equal(world.centralBanks.find((bank) => bank.id === area.monetaryAuthorityId)?.setsPolicyRate, true);
  const usdBank = world.banks.find((bank) => bank.baseCurrency === "USD")!;
  const usd = openBankAccount(world, world.player.householdId, usdBank.id);
  const rub = bankAccountsForOwner(world, world.player.householdId, "RUB")[0];
  executeFxConversion(world, world.player.householdId, rub.id, usd.accountId!, 50_000);
  assert.ok(valueInReportingCurrency(world, world.player.householdId, "USD").totalMinor > 0);
  assert.match(formatMoney(123_45, "USD"), /123/);
  assert.match(formatMoney(123, "KRW"), /123/);
});

test("переезд сохраняет старый счёт, Сеул платит KRW и корейский брокер использует settlement account", () => {
  const world = createWorld();
  setPlayerProfile(world, "Глобальный игрок", "student");
  const rubId = bankAccountsForOwner(world, world.player.householdId, "RUB")[0].id;
  assert.equal(startTravel(world, "seoul", "air", true), true);
  runMonths(world, 1);
  assert.equal(world.player.currentCityId, "seoul");
  assert.ok(world.bankAccounts.some((account) => account.id === rubId));
  const koreanBank = world.banks.find((bank) => bank.countryId === "kr")!;
  const opened = openBankAccount(world, world.player.householdId, koreanBank.id, true);
  const krw = world.bankAccounts.find((account) => account.id === opened.accountId)!;
  const company = world.companies.find((item) => item.headquartersCityId === "seoul" && item.active)!;
  assert.equal(applyForJob(world, company.id, "worker").accepted, true);
  assert.equal(acceptJobOffer(world), true);
  const before = bankAccountBalance(world, krw.id);
  runMonths(world, 1);
  assert.ok(bankAccountBalance(world, krw.id) > before);
  const broker = world.brokers.find((item) => item.countryId === "kr")!;
  assert.equal(openBrokerageAccount(world, world.player.householdId, broker.id, krw.id).ok, true);
  const brokerage = world.brokerageAccounts.find((account) => account.ownerId === world.player.householdId && account.brokerId === broker.id)!;
  assert.deepEqual(brokerage.settlementBankAccountIds, [krw.id]);
});

test("очная программа требует город, но зарубежные вузы доступны для подачи", () => {
  const world = createWorld();
  setPlayerProfile(world, "Абитуриент", "student");
  const foreign = world.universityPrograms.find((program) => program.attendanceMode === "ON_CAMPUS" && world.universities.find((university) => university.id === program.universityId)?.cityId !== "moscow")!;
  assert.ok(foreign);
  assert.equal(applyUniversity(world, foreign.id), true);
  assert.equal(enrollUniversity(world, foreign.id), false);
  assert.ok(world.universities.some((university) => university.cityId === "seoul"));
  assert.ok(world.universities.some((university) => university.cityId === "busan"));
});

test("Player покупает еду ежемесячно, жильё списывает аренду, durable — только вручную", () => {
  const world = createWorld();
  assert.equal(world.player.automaticBasicSpending, false);
  assert.equal(world.ledger.transactions.some((transaction) => transaction.kind === "DURABLE_PURCHASE"), false);
  const home = world.housingCohorts.find((cohort) => cohort.cityId === "moscow" && cohort.type === "rental-apartment")!;
  assert.equal(rentProperty(world, home.id), true);
  const rentCount = world.ledger.transactions.filter((transaction) => transaction.kind === "RENT").length;
  runMonths(world, 1);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "GOODS_CLEARING" && transaction.memo.includes("Игрок")));
  assert.ok(world.ledger.transactions.filter((transaction) => transaction.kind === "RENT").length > rentCount);
  assert.equal(world.ledger.transactions.some((transaction) => transaction.kind === "DURABLE_PURCHASE"), false);
  assert.equal(buyDurable(world, world.products[0].id), true);
  assert.equal(world.ledger.transactions.some((transaction) => transaction.kind === "DURABLE_PURCHASE"), true);
});

test("SELL из портфеля создаёт настоящую биржевую заявку", () => {
  const world = createWorld();
  const listing = world.listings.find((item) => item.companyId === "company-001")!;
  assert.equal(openBrokerageAccount(world, world.player.householdId).ok, true);
  const brokerage = world.brokerageAccounts.find((account) => account.ownerId === world.player.householdId)!;
  const answer = placeOrder(world, brokerage.id, listing.securityId, "sell", "limit", 25, listing.lastPriceCents * 2);
  assert.equal(answer.ok, true);
  assert.ok(world.marketOrders.some((order) => order.id === answer.orderId && order.side === "sell"));
  assert.equal(world.listings.filter((item) => world.exchanges.find((exchange) => exchange.id === item.exchangeId)?.countryId === "ru").length, world.companies.filter((company) => company.headquartersCountryId === "ru" && company.corporateStatus === "public").length);
});

test("фонды сверяют cash, NAV, паи, AUM, комиссии и погашение", () => {
  const world = createWorld();
  const fund = world.funds.find((item) => item.currencyId === "RUB" && item.type === "open-end")!;
  const manager = world.assetManagers.find((item) => item.id === fund.managerId)!;
  const playerCash = bankAccountsForOwner(world, world.player.householdId, "RUB")[0];
  const unitsBefore = fund.unitsOutstandingMicros;
  const subscription = subscribeFund(world, fund.id, world.player.householdId, 100_000, playerCash.id);
  assert.equal(subscription.ok, true);
  assert.ok(fund.unitsOutstandingMicros > unitsBefore);
  assert.equal(world.fundUnitHoldings.filter((holding) => holding.fundId === fund.id).reduce((sum, holding) => sum + holding.unitsMicros, 0), fund.unitsOutstandingMicros);
  const nav = calculateFundNav(world, fund.id);
  assert.equal(nav.navMinor, fund.navMinor);
  assert.notEqual(assetManagerAum(world, manager.id), bankAccountBalance(world, manager.bankAccountId));
  const managerBefore = bankAccountBalance(world, manager.bankAccountId);
  chargeFundFees(world);
  assert.ok(bankAccountBalance(world, manager.bankAccountId) > managerBefore);
  assert.equal(redeemFund(world, fund.id, world.player.householdId, subscription.unitsMicros!).ok, true);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("ETF, пенсия, ребалансировка и андеррайтинг используют реальные позиции", () => {
  const world = createWorld();
  const usdBank = world.banks.find((bank) => bank.baseCurrency === "USD")!;
  const usdOpen = openBankAccount(world, world.player.householdId, usdBank.id, true);
  const usd = world.bankAccounts.find((account) => account.id === usdOpen.accountId)!;
  const rub = bankAccountsForOwner(world, world.player.householdId, "RUB")[0];
  executeFxConversion(world, world.player.householdId, rub.id, usd.id, 2_000_000);
  const etf = world.funds.find((fund) => fund.type === "etf" && fund.currencyId === "USD")!;
  const sub = subscribeFund(world, etf.id, world.player.householdId, Math.min(100_000, bankAccountBalance(world, usd.id)), usd.id);
  assert.equal(sub.ok, true);
  assert.ok(world.equityHoldings.some((holding) => holding.ownerId === world.player.householdId && holding.securityId === etf.unitSecurityId));
  assert.equal(redeemFund(world, etf.id, world.player.householdId, sub.unitsMicros!).ok, true);
  const pension = world.funds.find((fund) => fund.type === "pension" && fund.currencyId === "RUB")!;
  assert.equal(contributeToPensionFund(world, pension.id, world.player.householdId, 25_000), true);
  const ordersBefore = world.marketOrders.length;
  rebalanceInstitutionalPortfolios(world);
  assert.ok(world.marketOrders.length >= ordersBefore);
  const manager = world.assetManagers.find((item) => item.countryId === "ru")!;
  const company = world.companies.find((item) => item.headquartersCountryId === "ru")!;
  const managerBefore = bankAccountBalance(world, manager.bankAccountId);
  const ipo = createUnderwritingMandate(world, manager.id, company.id, "ipo", 1_000_000);
  assert.equal(closeUnderwritingMandate(world, ipo.id, 1_000_000), true);
  const bond = createUnderwritingMandate(world, manager.id, company.id, "bond", 500_000);
  assert.equal(closeUnderwritingMandate(world, bond.id, 500_000), true);
  assert.ok(bankAccountBalance(world, manager.bankAccountId) > managerBefore);
  assert.equal(migrateWorldState(structuredClone(world)).assetManagers.length, world.assetManagers.length);
});

test("маржа отклоняет чрезмерное плечо, вызывает margin call и фиксирует риск прайм-брокера", () => {
  const world = createWorld();
  const listing = world.listings.find((item) => item.exchangeId === "exchange-ru" && item.companyId !== "company-001")!;
  const seller = world.equityHoldings.find((holding) => holding.securityId === listing.securityId && holding.shares >= 50_000)!;
  const buyer = world.households.filter((household) => world.banks.find((bank) => bank.id === household.bankId)?.countryId === "ru" && !world.equityHoldings.some((holding) => holding.ownerId === household.id)).sort((left, right) => bankAccountBalance(world, bankAccountsForOwner(world, left.id)[0].id) - bankAccountBalance(world, bankAccountsForOwner(world, right.id)[0].id))[0];
  assert.ok(buyer);
  openBrokerageAccount(world, seller.ownerId);
  openBrokerageAccount(world, buyer.id);
  const sellerBrokerage = world.brokerageAccounts.find((account) => account.ownerId === seller.ownerId)!;
  const buyerBrokerage = world.brokerageAccounts.find((account) => account.ownerId === buyer.id)!;
  const opened = openMarginAccount(world, buyer.id, buyerBrokerage.id);
  assert.equal(opened.ok, true);
  const marginId = opened.marginAccountId!;
  const cash = bankAccountBalance(world, bankAccountsForOwner(world, buyer.id, "RUB")[0].id);
  assert.equal(placeMarginBuy(world, marginId, listing.securityId, Math.floor(cash * 3 / listing.lastPriceCents), listing.lastPriceCents).ok, false);
  const quantity = Math.min(seller.shares, Math.floor(cash * 1.8 / listing.lastPriceCents));
  assert.equal(placeOrder(world, sellerBrokerage.id, listing.securityId, "sell", "limit", quantity, listing.lastPriceCents).ok, true);
  assert.equal(placeMarginBuy(world, marginId, listing.securityId, quantity, listing.lastPriceCents).ok, true);
  assert.ok(world.marginAccounts.find((account) => account.id === marginId)!.borrowedMinor > 0);
  listing.lastPriceCents = Math.max(1, Math.floor(listing.lastPriceCents / 10));
  assert.equal(checkMaintenanceMargin(world, marginId), false);
  assert.ok(world.marginCalls.some((call) => call.marginAccountId === marginId));
  const liquidBuyer = "population-moscow-2";
  openBrokerageAccount(world, liquidBuyer);
  const liquidBrokerage = world.brokerageAccounts.find((account) => account.ownerId === liquidBuyer)!;
  placeOrder(world, liquidBrokerage.id, listing.securityId, "buy", "limit", quantity, listing.lastPriceCents);
  assert.ok(forceLiquidation(world, marginId).length > 0);
  processMarginRisk(world);
  const exposure = world.primeBrokerExposures.find((item) => item.marginAccountId === marginId)!;
  assert.ok(exposure.loanMinor > 0);
  assert.ok(["liquidating", "loss", "active"].includes(exposure.status));
  assert.ok(marginAccountState(world, marginId).grossExposureMinor >= 0);
});

test("заём бумаг, short, cover, fees, dividend compensation и repo не допускают naked/double pledge", () => {
  const world = createWorld();
  const listing = world.listings.find((item) => item.exchangeId === "exchange-ru" && item.companyId !== "company-001")!;
  const lender = world.equityHoldings.find((holding) => holding.securityId === listing.securityId && holding.shares >= 100)!;
  const borrower = world.households.find((household) => world.banks.find((bank) => bank.id === household.bankId)?.countryId === "ru" && !world.equityHoldings.some((holding) => holding.ownerId === household.id))!;
  openBrokerageAccount(world, borrower.id);
  const brokerage = world.brokerageAccounts.find((account) => account.ownerId === borrower.id)!;
  assert.equal(placeOrder(world, brokerage.id, listing.securityId, "sell", "market", 10).ok, false);
  const margin = openMarginAccount(world, borrower.id, brokerage.id);
  const passiveBuyer = "population-moscow-2";
  openBrokerageAccount(world, passiveBuyer);
  const passiveBroker = world.brokerageAccounts.find((account) => account.ownerId === passiveBuyer)!;
  placeOrder(world, passiveBroker.id, listing.securityId, "buy", "limit", 10, listing.lastPriceCents);
  const short = placeShortSale(world, margin.marginAccountId!, lender.ownerId, listing.securityId, 10);
  assert.equal(short.ok, true);
  const loan = world.securitiesLoans.find((item) => item.id === world.shortPositions.find((item) => item.id === short.positionId)!.securitiesLoanId)!;
  const feeBefore = world.shortPositions.find((item) => item.id === short.positionId)!.accruedBorrowFeeMinor;
  chargeSecuritiesBorrowFees(world);
  assert.ok(world.shortPositions.find((item) => item.id === short.positionId)!.accruedBorrowFeeMinor > feeBefore);
  assert.ok(compensateBorrowedDividend(world, listing.securityId, 5) > 0);
  placeOrder(world, passiveBroker.id, listing.securityId, "sell", "limit", 10, listing.lastPriceCents);
  assert.equal(buyToCover(world, short.positionId!).ok, true);
  assert.equal(loan.status, "returned");
  const haircut = securityHaircutBps(world, listing.securityId);
  assert.ok(haircut > 0 && haircut < 10_000);
  const repo = openRepo(world, borrower.id, lender.ownerId, listing.securityId, 20);
  assert.equal(repo.ok, true);
  assert.equal(pledgeSecurityCollateral(world, lender.ownerId, borrower.id, listing.securityId, lender.shares, "repo"), null);
  assert.equal(repayRepo(world, repo.repoId!), true);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("форвард создаётся и рассчитывается по фактической цене", () => {
  const world = createWorld();
  const { listing, banks } = localMarket(world);
  const buyerCash = bankAccountBalance(world, bankAccountsForOwner(world, banks[0].id, listing.currencyId)[0].id);
  const contract = createForward(world, banks[0].id, banks[1].id, { kind: "equity", securityId: listing.securityId }, 10, listing.lastPriceCents, 1)!;
  listing.lastPriceCents += 100;
  world.clock.elapsedMonths = 1;
  const result = settleForward(world, contract.id);
  assert.equal(result.ok, true);
  assert.equal(result.payoffMinor, 1_000);
  assert.equal(bankAccountBalance(world, bankAccountsForOwner(world, banks[0].id, listing.currencyId)[0].id), buyerCash + 1_000);
  assert.equal(contract.status, "matured");
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("фьючерс новируется CCP, требует маржу и даёт нулевую сумму variation margin", () => {
  const world = createWorld();
  const { exchange, listing, banks } = localMarket(world);
  const contract = createFuture(world, banks[0].id, banks[1].id, { kind: "equity", securityId: listing.securityId }, exchange.id, 3, 10, 6)!;
  assert.ok(contract.ccpId);
  assert.equal(world.clearedPositions.filter((position) => position.contractId === contract.id).reduce((sum, position) => sum + position.netQuantity, 0), 0);
  assert.equal(world.collateralPledges.filter((pledge) => pledge.referenceId === contract.id && pledge.status === "active").length, 2);
  const longBefore = bankAccountBalance(world, bankAccountsForOwner(world, banks[0].id, listing.currencyId)[0].id);
  const shortBefore = bankAccountBalance(world, bankAccountsForOwner(world, banks[1].id, listing.currencyId)[0].id);
  const settled = settleFuturesVariationMargin(world, contract.id, contract.initialPriceMinor + 40);
  assert.equal(settled.ok, true);
  assert.equal(bankAccountBalance(world, bankAccountsForOwner(world, banks[0].id, listing.currencyId)[0].id) - longBefore, settled.amountMinor);
  assert.equal(bankAccountBalance(world, bankAccountsForOwner(world, banks[1].id, listing.currencyId)[0].id) - shortBefore, -settled.amountMinor);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("call и put исполняются, а премия остаётся реальным денежным потоком", () => {
  const world = createWorld();
  const { exchange, listing, banks } = localMarket(world);
  for (const optionType of ["call", "put"] as const) {
    world.clock.elapsedMonths = 0;
    const series = world.optionMarketSeries.find((item) => item.exchangeId === exchange.id && item.underlyingSecurityId === listing.securityId && item.optionType === optionType)!;
    const holderBefore = bankAccountBalance(world, bankAccountsForOwner(world, banks[0].id, listing.currencyId)[0].id);
    const answer = writeOption(world, series.id, banks[0].id, banks[1].id, 1);
    assert.equal(answer.ok, true);
    const contract = world.derivativeContracts.find((item) => item.id === answer.contractId && item.type === "option")!;
    assert.ok(bankAccountBalance(world, bankAccountsForOwner(world, banks[0].id, listing.currencyId)[0].id) < holderBefore);
    listing.lastPriceCents = optionType === "call" ? series.strikeMinor + 200 : Math.max(1, series.strikeMinor - 200);
    world.clock.elapsedMonths = series.expirationMonth;
    const exercised = exerciseOption(world, contract.id, true);
    assert.equal(exercised.ok, true, optionType);
    assert.equal(contract.status, "exercised");
    assert.equal(series.openInterest, 0);
  }
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("опцион вне денег истекает и освобождает обеспечение", () => {
  const world = createWorld();
  const { exchange, listing, banks } = localMarket(world);
  const series = world.optionMarketSeries.filter((item) => item.exchangeId === exchange.id && item.optionType === "call").sort((a, b) => b.strikeMinor - a.strikeMinor)[0];
  const answer = writeOption(world, series.id, banks[0].id, banks[1].id, 1);
  const contract = world.derivativeContracts.find((item) => item.id === answer.contractId && item.type === "option")!;
  listing.lastPriceCents = Math.max(1, series.strikeMinor - 100);
  world.clock.elapsedMonths = series.expirationMonth;
  assert.equal(expireOptions(world), 1);
  assert.equal(contract.status, "expired");
  const set = world.nettingSets.find((item) => item.id === contract.nettingSetId)!;
  assert.ok(world.collateralPledges.filter((pledge) => set.collateralPledgeIds.includes(pledge.id)).every((pledge) => pledge.status === "released"));
});

test("покрытая продажа call использует акции, put — денежное обеспечение", () => {
  const world = createWorld();
  const { exchange, listing, banks } = localMarket(world);
  const call = world.optionMarketSeries.find((item) => item.exchangeId === exchange.id && item.underlyingSecurityId === listing.securityId && item.optionType === "call")!;
  const writerHolding = world.equityHoldings.find((holding) => holding.securityId === listing.securityId && holding.shares >= call.contractMultiplier)!;
  assert.equal(writeOption(world, call.id, banks[0].id, writerHolding.ownerId, 1).ok, true);
  assert.ok(world.collateralPledges.some((pledge) => pledge.ownerId === writerHolding.ownerId && pledge.assetType === "security" && pledge.purpose === "derivative-margin"));
  const put = world.optionMarketSeries.find((item) => item.exchangeId === exchange.id && item.underlyingSecurityId === listing.securityId && item.optionType === "put")!;
  assert.equal(writeOption(world, put.id, banks[0].id, banks[1].id, 1).ok, true);
  assert.ok(world.collateralPledges.some((pledge) => pledge.ownerId === banks[1].id && pledge.assetType === "cash" && pledge.markedValueMinor === put.strikeMinor * put.contractMultiplier));
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("Delta, Gamma, Theta, Vega и implied volatility рассчитываются согласованно", () => {
  const input = { optionType: "call" as const, underlyingPriceMinor: 10_000, strikeMinor: 10_000, timeToExpiryYears: 1, riskFreeRateBps: 500, volatilityBps: 2_500 };
  const value = valueEuropeanOption(input);
  assert.ok(value.theoreticalValueMinor > value.intrinsicValueMinor);
  assert.ok(value.delta > 0 && value.delta < 1);
  assert.ok(value.gamma > 0);
  assert.ok(value.thetaPerMonthMinor < 0);
  assert.ok(value.vegaPerVolPointMinor > 0);
  const solved = impliedVolatilityBps({ optionType: input.optionType, underlyingPriceMinor: input.underlyingPriceMinor, strikeMinor: input.strikeMinor, timeToExpiryYears: input.timeToExpiryYears, riskFreeRateBps: input.riskFreeRateBps }, value.theoreticalValueMinor)!;
  assert.ok(Math.abs(solved - input.volatilityBps) < 100);
});

test("IRS платит только чистую разницу фиксированной и плавающей ног", () => {
  const world = createWorld();
  const { banks } = localMarket(world);
  const contract = createInterestRateSwap(world, banks[0].id, banks[1].id, "money-area-rub", 10_000_000_00, 600, 12, 3)!;
  assert.equal(world.collateralPledges.filter((pledge) => pledge.referenceId === contract.id && pledge.status === "active").length, 2);
  world.clock.elapsedMonths = 3;
  const result = settleInterestRateSwap(world, contract.id);
  assert.equal(result.ok, true);
  assert.ok(result.netMinor !== 0);
  assert.ok(result.transactionId);
  assert.equal(world.ledger.transactions.filter((transaction) => transaction.kind === "SWAP_SETTLEMENT").length, 2);
});

test("bilateral netting схлопывает встречные требования в один платёж", () => {
  const world = createWorld();
  const { banks } = localMarket(world);
  const set = createNettingSet(world, banks[0].id, banks[1].id, "RUB");
  const result = settleBilateralNet(world, set.id, 900_000, 650_000, "Тест взаимозачёта");
  assert.equal(result.netMinor, 250_000);
  assert.ok(result.transactionId);
});

test("TRS передаёт total return, вызывает margin call и принудительное закрытие", () => {
  const successWorld = createWorld();
  const successMarket = localMarket(successWorld);
  const success = createTotalReturnSwap(successWorld, successMarket.banks[0].id, successMarket.banks[1].id, successMarket.listing.securityId, 10, 6)!;
  successMarket.listing.lastPriceCents += 100;
  assert.equal(settleTotalReturnSwap(successWorld, success.id).ok, true);

  const world = createWorld();
  const { listing, banks } = localMarket(world);
  const playerAccount = bankAccountsForOwner(world, world.player.householdId, listing.currencyId)[0];
  const quantity = Math.max(1, Math.floor(bankAccountBalance(world, playerAccount.id) * 4 / listing.lastPriceCents));
  const contract = createTotalReturnSwap(world, world.player.householdId, banks[0].id, listing.securityId, quantity, 6)!;
  listing.lastPriceCents = Math.max(1, Math.round(listing.lastPriceCents * 0.65));
  assert.equal(settleTotalReturnSwap(world, contract.id).ok, false);
  assert.equal(contract.status, "margin-call");
  assert.ok(world.derivativeMarginCalls.some((call) => call.contractId === contract.id && call.status === "open"));
  forceTrsUnwind(world, contract.id);
  assert.equal(contract.status, "defaulted");
});

test("CDS начисляет премию и платит loss given default с recovery", () => {
  const world = createWorld();
  const { banks } = localMarket(world);
  const bond = world.sovereignBonds.find((item) => item.countryId === "ru")!;
  const contract = createCreditDefaultSwap(world, banks[0].id, banks[1].id, bond.id, 1_000_000_00, 12, 4_000)!;
  world.clock.elapsedMonths = 3;
  assert.ok(settleCdsPremium(world, contract.id));
  bond.status = "defaulted";
  const settlement = settleCdsCreditEvent(world, contract.id);
  assert.equal(settlement.ok, true);
  assert.equal(settlement.paymentMinor, 600_000_00);
});

test("физический FX forward и FX swap проводят обе валютные ноги", () => {
  const world = createWorld();
  const dealer = world.fxDealers[0];
  const playerId = world.player.householdId;
  const usdBank = world.banks.find((bank) => bank.baseCurrency === "USD")!;
  seedDeposit(world, playerId, usdBank.id, 1_000_000_00);
  const pair = world.fxPairs.find((item) => item.id === "RUB-USD")!;
  const forward = createForward(world, playerId, dealer.id, { kind: "currency-pair", pairId: pair.id }, 100_000, pair.lastRatePpm, 1, "physical")!;
  world.clock.elapsedMonths = 1;
  assert.equal(settleForward(world, forward.id).ok, true);
  const swap = createFxSwap(world, playerId, dealer.id, pair.id, 50_000, 1);
  assert.ok(swap);
  assert.ok(world.ledger.transactions.filter((transaction) => transaction.kind === "FX_FORWARD_SETTLEMENT" || transaction.kind === "DERIVATIVE_SETTLEMENT").length >= 8);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("mark-to-market не создаёт деньги, а exposure отличает notional от риска", () => {
  const world = createWorld();
  const { exchange, listing, banks } = localMarket(world);
  createFuture(world, banks[0].id, banks[1].id, { kind: "equity", securityId: listing.securityId }, exchange.id, 1, 10, 6);
  const before = depositMoney(world);
  refreshOptionQuotes(world);
  const exposure = derivativeExposure(world, banks[0].id);
  assert.equal(depositMoney(world), before);
  assert.ok(exposure.grossNotionalMinor > exposure.grossMarketValueMinor);
});

test("CCP waterfall использует реальные деньги участника и гарантийный фонд", () => {
  const world = createWorld();
  const { exchange, listing, banks } = localMarket(world);
  const contract = createFuture(world, banks[0].id, banks[1].id, { kind: "equity", securityId: listing.securityId }, exchange.id, 1, 10, 6)!;
  const creditorBefore = bankAccountBalance(world, bankAccountsForOwner(world, banks[1].id, "RUB")[0].id);
  const result = applyClearingDefaultWaterfall(world, contract.ccpId!, banks[0].id, contract.initialMarginMinor + 1_000_000, banks[1].id);
  assert.equal(result.uncoveredMinor, 0);
  assert.ok(bankAccountBalance(world, bankAccountsForOwner(world, banks[1].id, "RUB")[0].id) > creditorBefore);
  assert.equal(world.clearingMemberAccounts.find((member) => member.memberId === banks[0].id)?.status, "defaulted");
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("одинаковый replay деривативов детерминирован", () => {
  const left = createWorld();
  const right = createWorld();
  for (const world of [left, right]) {
    const { exchange, listing, banks } = localMarket(world);
    const future = createFuture(world, banks[0].id, banks[1].id, { kind: "equity", securityId: listing.securityId }, exchange.id, 2, 10, 6)!;
    settleFuturesVariationMargin(world, future.id, future.initialPriceMinor + 25);
    createInterestRateSwap(world, banks[0].id, banks[1].id, "money-area-rub", 100_000_00, 500, 12, 3);
  }
  assert.deepEqual(left.derivativeContracts, right.derivativeContracts);
  assert.deepEqual(left.clearedPositions, right.clearedPositions);
  assert.equal(deterministicFingerprint(left), deterministicFingerprint(right));
});

test("налоги, расходы, дефицит, профицит и автоматические стабилизаторы идут через ledger", () => {
  const world = createWorld();
  const propertyBefore = world.ledger.transactions.filter((transaction) => transaction.kind === "PROPERTY_TAX").length;
  assert.ok(collectPropertyTaxes(world) > 0);
  assert.ok(world.ledger.transactions.filter((transaction) => transaction.kind === "PROPERTY_TAX").length > propertyBefore);
  runMonths(world, 1);
  assert.ok(world.governmentBudgets.some((budget) => budget.budgetBalanceMinor < 0));
  assert.ok(world.governmentBudgets.some((budget) => budget.budgetBalanceMinor > 0));
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "SOCIAL_TRANSFER"));
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "GOODS_CLEARING" && transaction.entries.some((entry) => world.governments.some((government) => government.id === world.ledger.accounts[entry.accountId]?.ownerId))));
});

test("аукцион выпускает госдолг и сверяет держателей с номиналом", () => {
  const world = createWorld();
  const auction = createSovereignAuction(world, "ru", "5y", 2_000_000_00)!;
  const result = runSovereignAuction(world, auction.id);
  assert.equal(result.ok, true);
  const bond = world.sovereignBonds.find((item) => item.id === result.bondId)!;
  assert.equal(world.sovereignBondHoldings.filter((holding) => holding.bondId === bond.id).reduce((sum, holding) => sum + holding.faceValueMinor, 0), bond.outstandingFaceValueMinor);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "SOVEREIGN_ISSUE"));
});

test("непокрытый аукцион не создаёт долг и повышает суверенный риск", () => {
  const world = createWorld();
  const state = world.countryMacroStates.find((item) => item.countryId === "ru")!;
  const riskBefore = state.sovereignRiskBps;
  const auction = createSovereignAuction(world, "ru", "10y", 100_000_000_00)!;
  const result = runSovereignAuction(world, auction.id, 0);
  assert.equal(result.ok, false);
  assert.equal(auction.status, "failed");
  assert.ok(state.sovereignRiskBps > riskBefore);
});

test("госдолг платит купон, погашается и рефинансируется при нехватке cash", () => {
  const world = createWorld();
  const bond = world.sovereignBonds.find((item) => item.countryId === "ru" && item.maturityBucket === "short")!;
  const governmentAccount = bankAccountsForOwner(world, bond.governmentId, bond.currencyId)[0];
  const recipientBank = world.banks.find((bank) => bank.countryId === "ru")!;
  const leave = Math.max(1, Math.floor(bond.outstandingFaceValueMinor / 4));
  const cash = bankAccountBalance(world, governmentAccount.id);
  if (cash > leave) settleFinancialPayment(world, bond.governmentId, recipientBank.id, bond.currencyId, cash - leave, "TRANSFER", "Подготовка рефинансирования");
  const auctionCount = world.sovereignAuctions.length;
  bond.maturityMonth = world.clock.elapsedMonths;
  serviceSovereignDebt(world);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "SOVEREIGN_COUPON"));
  assert.ok(world.sovereignAuctions.length > auctionCount);
  assert.ok(bond.status === "matured" || bond.status === "defaulted");
});

test("кривая доходности и debt/GDP строятся из локального госдолга", () => {
  const world = createWorld();
  runMonths(world, 2);
  for (const country of world.countries) {
    const curve = [...world.yieldCurveHistory].reverse().find((snapshot) => snapshot.countryId === country.id)!;
    const point = [...world.macroHistory].reverse().find((item) => item.countryId === country.id)!;
    assert.equal(curve.points.length, 5);
    assert.ok(point.debtToGdpBps > 0);
    assert.equal(point.currencyId, country.currencyReference);
  }
});

test("страны стартуют с разными профилями государственного долга", () => {
  const world = createWorld();
  runMonths(world, 1);
  const latest = world.macroHistory.slice(-world.countries.length);
  const debtRatios = latest.map((point) => point.debtToGdpBps);
  assert.ok(new Set(latest.map((point) => point.publicDebtMinor)).size >= 6);
  assert.ok(Math.min(...debtRatios) < 6_000);
  assert.ok(Math.max(...debtRatios) > 15_000);
});

test("реальный унаследованный долг обслуживается и рефинансируется когортами", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  runMonths(world, 60);
  for (const countryId of ["us", "jp"]) {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === countryId)!;
    const annual = world.countryScaleReconciliations.find((item) => item.countryId === countryId)!.targetAnnualNominalGdpMinor;
    const debt = world.governmentBudgets.find((item) => item.countryId === countryId)!.publicDebtMinor;
    const ratioBps = Math.round(debt * 10_000 / annual);
    assert.ok(ratioBps >= profile.governmentDebtToGdpBps * 7_000 / 10_000);
    assert.equal(world.sovereignBonds.some((bond) => bond.countryId === countryId && bond.status === "defaulted"), false);
  }
});

test("правило ЦБ реагирует на инфляцию и сохраняет реальные входы решения", () => {
  const world = createWorld();
  runMonths(world, 1);
  for (const point of world.macroHistory) { point.inflationBps = 1_500; point.outputGapBps = 500; point.defaultRateBps = 0; point.sovereignRiskBps = 0; }
  world.clock.elapsedMonths = 3;
  const before = world.centralBanks.find((bank) => bank.id === "central-bank-ru")!.policyRateBps;
  runMonetaryPolicy(world);
  const decision = [...world.monetaryPolicyDecisions].reverse().find((item) => item.centralBankId === "central-bank-ru")!;
  assert.ok(decision.newRateBps > before);
  assert.equal(decision.observedInflationBps, 1_500);
  assert.equal(decision.outputGapBps, 500);
});

test("OMO, QE и QT меняют бумаги, резервы и доходность без прямой записи в GDP", () => {
  const world = createWorld();
  const { banks } = localMarket(world);
  const bank = banks[0];
  const centralBank = world.centralBanks.find((item) => item.id === bank.centralBankId)!;
  const holding = world.sovereignBondHoldings.find((item) => item.holderId === bank.id && world.sovereignBonds.find((bond) => bond.id === item.bondId)?.countryId === "ru")!;
  const bond = world.sovereignBonds.find((item) => item.id === holding.bondId)!;
  const face = Math.min(500_000_00, Math.floor(holding.faceValueMinor / 4));
  const reservesBefore = balanceOf(world, accountIds.bankReserve(bank.id));
  const yieldBefore = bond.yieldBps;
  const gdpBefore = world.metricsHistory.length;
  assert.equal(openMarketPurchase(world, centralBank.id, bank.id, bond.id, face, "OPEN_MARKET_PURCHASE"), true);
  assert.ok(balanceOf(world, accountIds.bankReserve(bank.id)) > reservesBefore);
  assert.ok(bond.yieldBps < yieldBefore);
  assert.equal(openMarketSale(world, centralBank.id, bank.id, bond.id, Math.floor(face / 2), "OPEN_MARKET_SALE"), true);
  assert.equal(openMarketPurchase(world, centralBank.id, bank.id, bond.id, Math.floor(face / 4), "QE"), true);
  assert.equal(openMarketSale(world, centralBank.id, bank.id, bond.id, Math.floor(face / 4), "QT"), true);
  assert.equal(world.metricsHistory.length, gdpBefore);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("кредит последней инстанции требует суверенный залог и создаёт резервы", () => {
  const world = createWorld();
  const bank = localMarket(world).banks[0];
  const holding = world.sovereignBondHoldings.find((item) => item.holderId === bank.id)!;
  const reservesBefore = balanceOf(world, accountIds.bankReserve(bank.id));
  assert.equal(requestLenderOfLastResort(world, bank.id, 100_000_00, holding.bondId), true);
  assert.ok(balanceOf(world, accountIds.bankReserve(bank.id)) > reservesBefore);
  const funding = world.bankFunding.find((item) => item.borrowerBankId === bank.id && item.kind === "central-bank")!;
  assert.ok(funding.collateralPledgeId);
});

test("страхование вкладов закрывает требование к упавшему банку и платит на новый счёт", () => {
  const world = createWorld();
  const failedBank = localMarket(world).banks[0];
  const account = world.bankAccounts.find((item) => item.bankId === failedBank.id && item.ownerId.startsWith("household-") && bankAccountBalance(world, item.id) > 0)!;
  const owner = account.ownerId;
  const paid = payDepositInsurance(world, failedBank.id);
  assert.ok(paid > 0);
  assert.equal(account.status, "closed");
  assert.equal(balanceOf(world, account.ledgerDepositAccountId), 0);
  assert.ok(world.bankAccounts.some((item) => item.ownerId === owner && item.bankId !== failedBank.id && item.status === "active"));
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("рост суверенного риска переоценивает актив банка и влияет на капитал", () => {
  const world = createWorld();
  const bank = localMarket(world).banks[0];
  const holding = world.sovereignBondHoldings.find((item) => item.holderId === bank.id && world.sovereignBonds.find((bond) => bond.id === item.bondId)?.maturityBucket === "10y")!;
  const state = world.countryMacroStates.find((item) => item.countryId === "ru")!;
  const bookBefore = holding.bookValueMinor;
  const capitalBefore = entityBook(world, bank.id).capital;
  state.sovereignRiskBps += 1_000;
  updateSovereignValuations(world);
  assert.ok(holding.bookValueMinor < bookBefore);
  assert.ok(entityBook(world, bank.id).capital < capitalBefore);
});

test("суверенный дефолт и реструктуризация создают реальный haircut держателя", () => {
  const world = createWorld();
  const bond = world.sovereignBonds.find((item) => item.countryId === "ru")!;
  const governmentAccount = bankAccountsForOwner(world, bond.governmentId, bond.currencyId)[0];
  const cash = bankAccountBalance(world, governmentAccount.id);
  settleFinancialPayment(world, bond.governmentId, localMarket(world).banks[0].id, bond.currencyId, cash, "TRANSFER", "Исчерпание казначейского счёта");
  serviceSovereignDebt(world);
  const defaulted = world.sovereignBonds.find((item) => item.countryId === "ru" && item.status === "defaulted")!;
  assert.ok(defaulted);
  const holder = world.sovereignBondHoldings.find((item) => item.bondId === defaulted.id && item.faceValueMinor > 0)!;
  const holderCapitalBefore = entityBook(world, holder.holderId).capital;
  const faceBefore = holder.faceValueMinor;
  assert.equal(restructureSovereignBond(world, defaulted.id, 3_000, 24, 100), true);
  assert.equal(defaulted.status, "restructured");
  assert.ok(holder.faceValueMinor < faceBefore);
  assert.ok(entityBook(world, holder.holderId).capital < holderCapitalBefore);
  recalculateGovernmentBudgets(world);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("профили стран явные, а неизвестная страна получает маркированный fallback", () => {
  const world = createWorld();
  const ru = world.countryEconomicProfiles.find((profile) => profile.countryId === "ru")!;
  const us = world.countryEconomicProfiles.find((profile) => profile.countryId === "us")!;
  const jp = world.countryEconomicProfiles.find((profile) => profile.countryId === "jp")!;
  assert.equal(ru.metadata.sourceType, "CALIBRATED");
  assert.ok(us.population > ru.population);
  assert.ok(jp.governmentDebtToGdpBps > us.governmentDebtToGdpBps);
  assert.equal(getCountryEconomicProfile("test-country").metadata.sourceType, "SYNTHETIC_FALLBACK");
  assert.ok(world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) > 900_000_000);
});

test("10 млн жителей остаются четырьмя когортами на город, а не миллионами Household", () => {
  const world = createWorld();
  const profiles = structuredClone(world.countryEconomicProfiles);
  profiles.find((profile) => profile.countryId === "ru")!.population = 10_000_000;
  const cities = createCities(world.goods, profiles);
  const cohorts = createPopulationCohorts(cities, world.banks, profiles).filter((cohort) => cohort.countryId === "ru");
  assert.equal(cohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0), 10_000_000);
  assert.equal(cohorts.length, 12);
  assert.equal(world.households.length, 100);
});

test("FX-хедж возникает только при реальной валютной позиции", () => {
  const world = createWorld();
  const local = world.funds.find((fund) => fund.currencyId === "RUB" && fund.type === "pension")!;
  const global = world.funds.find((fund) => fund.currencyId === "USD" && fund.type === "hedge")!;
  assert.equal(createFxHedgeForFund(world, local), null);
  const hedge = createFxHedgeForFund(world, global)!;
  assert.equal(hedge.type, "fx-forward");
  assert.equal(hedge.decision?.motive, "FX_HEDGE");
  assert.ok(hedge.decision?.targetExposureMinor);
});

test("погашенный FX-хедж продлевается с явной связью rollover", () => {
  const world = createWorld();
  const fund = world.funds.find((item) => item.currencyId === "USD" && item.type === "hedge")!;
  const first = createFxHedgeForFund(world, fund)!;
  runMonths(world, 7);
  const rolled = world.derivativeContracts.find((contract) => contract.decision?.rolledFromId === first.id);
  assert.equal(first.status, "matured");
  assert.ok(rolled);
  assert.equal(first.decision?.rolledToId, rolled?.id);
  assert.equal(rolled?.decision?.motive, "FX_HEDGE");
});

test("прайм-брокер принимает позицию в лимите и отклоняет чрезмерную", () => {
  const world = createWorld();
  const fund = world.funds.find((item) => item.type === "hedge")!;
  const primeBrokerId = fund.primeBrokerIds[0];
  assert.equal(approvePrimeBrokerCapacity(world, fund.id, primeBrokerId, 100_000).approved, true);
  assert.equal(approvePrimeBrokerCapacity(world, fund.id, primeBrokerId, 1_000_000_000_000).approved, false);
  runAutonomousDerivativeDecisions(world);
  const trs = world.derivativeContracts.find((contract) => contract.type === "total-return-swap" && contract.decision?.initiatedById === fund.id);
  assert.ok(trs);
  assert.ok(trs?.counterpartyIds.some((id) => fund.primeBrokerIds.includes(id)));
  assert.ok(fund.primeBrokerIds.includes(String(trs?.decision?.decisionInputs.primeBrokerId)));
});

test("автономный фонд покупает защиту, платит премию и оставляет реальную delta-заявку", () => {
  const world = createWorld();
  const premiumBefore = world.ledger.transactions.filter((transaction) => transaction.kind === "DERIVATIVE_PREMIUM").length;
  const created = runAutonomousDerivativeDecisions(world);
  assert.ok(created > 0);
  assert.ok(world.derivativeContracts.some((contract) => contract.type === "option" && contract.decision?.motive === "EQUITY_HEDGE"));
  assert.ok(world.derivativeContracts.some((contract) => contract.type === "option" && contract.decision?.motive === "COVERED_INCOME"));
  assert.ok(world.ledger.transactions.filter((transaction) => transaction.kind === "DERIVATIVE_PREMIUM").length > premiumBefore);
  const hedgeFund = world.funds.find((fund) => fund.type === "hedge")!;
  const brokerageIds = new Set(world.brokerageAccounts.filter((account) => account.ownerId === hedgeFund.id).map((account) => account.id));
  assert.ok([...world.marketOrders, ...world.archivedMarketOrders].some((order) => brokerageIds.has(order.brokerageAccountId)));
});

test("трёхуровневый реестр сохраняет важную операцию и баланс сжатых групп", () => {
  const world = createWorld();
  const playerId = world.player.householdId;
  const transactionId = postTransaction(world, "LOAN_DEFAULT", "Проверка важной операции", [
    { accountId: accountIds.operatingExpense(playerId), side: "debit", amountCents: 10_000 },
    { accountId: accountIds.openingEquity(playerId), side: "credit", amountCents: 10_000 },
  ]);
  runMonths(world, 12);
  compactLedgerHistory(world);
  assert.ok(world.history.importantLedgerTransactions.some((transaction) => transaction.id === transactionId));
  assert.ok(world.history.compactedLedgerRecords.length > 0);
  assert.ok(world.history.compactedLedgerRecords.every((record) => record.totalDebitMinor === record.totalCreditMinor));
});

test("калибровка считает ошибки и направление тренда", () => {
  const result = compareCalibrationSeries({ id: "ru-gdp", countryId: "ru", metric: "gdp", months: [0, 1, 2], values: [100, 110, 105], metadata: { sourceType: "ESTIMATED", baseYear: 2024 } }, new Map([[0, 100], [1, 108], [2, 104]]));
  assert.equal(result.observations, 3);
  assert.ok(result.rootMeanSquaredError > 0);
  assert.equal(result.trendDirectionAccuracyBps, 10_000);
});

test("глобальная торговля сохраняет товар, деньги, FX и платёжный баланс", () => {
  const world = createWorld();
  const reservesBefore = world.resourceDeposits.reduce((sum, deposit) => sum + deposit.extractableReservesMilliUnits, 0);
  runMonths(world, 2);
  assert.ok(world.tradeFlows.length > 0);
  assert.ok(world.tradeFlows.every((flow) => flow.status === "settled" && flow.paymentTransactionIds.length > 0));
  assert.ok(world.fxTrades.some((trade) => world.tradeFlows.some((flow) => flow.fxTradeId === trade.id)));
  assert.ok(world.resourceDeposits.reduce((sum, deposit) => sum + deposit.extractableReservesMilliUnits, 0) < reservesBefore);
  assert.ok(world.balanceOfPayments.every((point) => point.reconciliationGapUsdMinor === 0));
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("разрыв импортной цепочки ограничивает производство через коэффициенты затрат", () => {
  const world = createWorld();
  world.tradeRoutes.filter((route) => route.destinationCountryId === "jp").forEach((route) => { route.capacityMilliUnits = 1; });
  world.countryCommodityStates.filter((state) => state.countryId === "jp").forEach((state) => { state.inventoryMilliUnits = 0; });
  runMonths(world, 2);
  assert.ok(world.companies.filter((company) => company.headquartersCountryId === "jp").some((company) => company.globalInputConstraintBps < 10_000));
});

test("FDI и иностранная акция создают позиции и зеркальные финансовые потоки", () => {
  const world = createWorld();
  const parent = world.companies.find((company) => company.headquartersCountryId === "us")!;
  const target = world.companies.find((company) => company.headquartersCountryId === "de")!;
  const fdi = createForeignDirectInvestment(world, parent.id, "de", 10_000);
  assert.ok(fdi);
  assert.equal(target.parentCompanyId, parent.id);
  const fund = world.funds.find((item) => world.assetManagers.find((manager) => manager.id === item.managerId)?.countryId === "us")!;
  const foreignSecurity = world.equitySecurities.find((security) => world.companies.find((company) => company.id === security.companyId)?.headquartersCountryId === "de")!;
  assert.ok(purchaseForeignEquity(world, fund.id, foreignSecurity.id, 1));
  assert.equal(world.internationalPortfolioPositions.length, 1);
  assert.equal(world.internationalPortfolioPositions[0].ownerCountryId, "us");
});

test("товарный фьючерс не создаёт физический товар, а интервенция ограничена резервами", () => {
  const world = createWorld();
  const company = world.companies.find((item) => item.headquartersCountryId === "us")!;
  const inventoryBefore = world.countryCommodityStates.reduce((sum, item) => sum + item.inventoryMilliUnits, 0);
  assert.ok(createCommodityFutureHedge(world, company.id, "crude-oil", false));
  assert.equal(world.countryCommodityStates.reduce((sum, item) => sum + item.inventoryMilliUnits, 0), inventoryBefore);
  const portfolio = world.reservePortfolios.find((item) => item.countryId === "ru")!;
  assert.equal(interveneFx(world, "ru", "USD", "RUB", Number.MAX_SAFE_INTEGER).ok, false);
  assert.ok(interveneFx(world, "ru", "USD", "RUB", 10_000).ok);
  assert.ok(portfolio.totalUsdMinor > 0);
});

test("реальный мир загружает документированные packs, лаборатория воспроизводима", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  assert.equal(world.baselineReference.mode, "REAL_WORLD");
  assert.equal(world.countryEconomicProfiles.find((profile) => profile.countryId === "us")?.population, REAL_COUNTRY_PACKS.find((pack) => pack.countryId === "us")?.population);
  assert.equal(world.banks.find((bank) => bank.countryId === "us")?.name, "JPMorgan Chase");
  const first = runEconomicLab(world, { countryId: "ru", horizonMonths: 2, policyRateDeltaBps: 100 });
  const second = runEconomicLab(world, { countryId: "ru", horizonMonths: 2, policyRateDeltaBps: 100 });
  assert.equal(first.deterministicFingerprint, second.deterministicFingerprint);
  assert.deepEqual(first.deltas, second.deltas);
});

test("автономный мир проходит 20 лет с архивированием истории", { timeout: 90_000 }, () => {
  const world = createWorld();
  const started = Date.now();
  runMonths(world, 240);
  const elapsedMs = Date.now() - started;
  assert.equal(world.clock.elapsedMonths, 240);
  assert.ok(world.metricsHistory.length <= world.history.policy.detailedMetricMonths);
  assert.equal(world.history.globalSeries.months.length + world.metricsHistory.length, 240);
  assert.ok(world.ledgerArchives.length > 0);
  assert.ok(world.diagnostics.ledgerArchivedTransactions > world.diagnostics.ledgerHotTransactions);
  assert.ok(world.history.compactedLedgerRecords.length > 0);
  assert.ok(world.derivativeContracts.length + world.history.compactedDerivativeRecords.length > 20);
  assert.ok(world.derivativeContracts.some((contract) => contract.decision));
  assert.ok(world.events.some((event) => event.type === "CompanyBankrupt"));
  assert.ok(world.events.some((event) => event.type === "CompanyFounded"));
  assert.ok(world.companies.length >= 100);
  assert.ok(world.diagnostics.estimatedSaveBytes < 25_000_000);
  assert.ok(elapsedMs < 60_000, `20 лет рассчитаны за ${elapsedMs} мс`);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("REAL_WORLD согласует ВВП, банки, торговлю и долг всех стран", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  assert.equal(world.realWorldInitializationReports.length, world.countries.length);
  for (const report of world.realWorldInitializationReports) {
    assert.ok(Math.abs(report.productionApproachMinor - report.targetMonthlyNominalGdpMinor) <= report.targetMonthlyNominalGdpMinor * 0.1);
    assert.ok(Math.abs(report.incomeApproachMinor - report.productionApproachMinor) <= report.targetMonthlyNominalGdpMinor * 0.01);
    assert.ok(Math.abs(report.expenditureApproachMinor - report.productionApproachMinor) <= report.targetMonthlyNominalGdpMinor * 0.01);
    assert.ok(Math.abs(report.actualDebtToGdpBps - report.targetDebtToGdpBps) <= 100);
    assert.ok(Math.abs(report.actualTradeToGdpBps - report.targetTradeToGdpBps) <= 100);
    assert.ok(report.bankAssetsToGdpBps >= 8_000);
    assert.equal(report.withinTolerance, true);
  }
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("унаследованный госдолг распределён по срокам и шести группам держателей", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  for (const country of world.countries) {
    const bonds = world.sovereignBonds.filter((bond) => bond.countryId === country.id);
    assert.equal(new Set(bonds.map((bond) => bond.maturityBucket)).size, 5);
    assert.equal(world.sovereignHolderCohorts.filter((holder) => holder.countryId === country.id).length, 6);
    assert.ok(bonds.every((bond) => world.sovereignBondHoldings.filter((holding) => holding.bondId === bond.id).reduce((sum, holding) => sum + holding.faceValueMinor, 0) === bond.outstandingFaceValueMinor));
  }
  const japan = world.realWorldInitializationReports.find((report) => report.countryId === "jp")!;
  assert.ok(japan.actualDebtToGdpBps > 20_000);
});

test("многосторонний клиринг не имеет потолка в восемь потоков", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  clearMultilateralCommodityMarkets(world);
  assert.ok(world.tradeFlows.length > 8);
  const groups = new Map<string, typeof world.tradeFlows>();
  for (const flow of world.tradeFlows) groups.set(flow.commodityId, [...(groups.get(flow.commodityId) ?? []), flow]);
  assert.ok([...groups.values()].some((flows) => new Set(flows.map((flow) => flow.exporterCountryId)).size >= 2 && new Set(flows.map((flow) => flow.importerCountryId)).size >= 3));
  assert.ok(world.tradeFlows.every((flow) => flow.landedUnitCostUsdMinor === flow.unitPriceUsdMinor + world.tradeRoutes.find((route) => route.id === flow.routeId)!.costUsdMinorPerUnit + Math.round(flow.unitPriceUsdMinor * 35 / 10_000)));
});

test("REAL_WORLD исполняет калиброванный месячный масштаб торговли", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  clearMultilateralCommodityMarkets(world);
  for (const countryId of ["us", "jp", "kr", "ru"]) {
    const sector = world.tradeSectors.find((item) => item.countryId === countryId)!;
    const flows = world.tradeFlows.filter((flow) => flow.exporterCountryId === countryId || flow.importerCountryId === countryId);
    const actualUsdMinor = flows.reduce((sum, flow) => sum + Math.round(flow.quantityMilliUnits * flow.unitPriceUsdMinor / 1_000), 0);
    const targetUsdMinor = sector.exportCapacityUsdMinor + sector.importBudgetUsdMinor;
    assert.ok(actualUsdMinor >= targetUsdMinor * 7_000 / 10_000, `${countryId}: фактическая торговля ниже 70% baseline`);
    assert.ok(actualUsdMinor <= targetUsdMinor * 13_000 / 10_000, `${countryId}: фактическая торговля выше 130% baseline`);
  }
});

test("международная поставка оплачивает товар, логистику и создаёт внешний актив", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  runMonths(world, 1);
  assert.ok(world.tradeFlows.length > 8);
  assert.ok(world.tradeFlows.every((flow) => flow.logisticsPaymentTransactionId && flow.paymentTransactionIds.length >= 2));
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "LOGISTICS"));
  assert.equal(world.externalClaims.length, world.tradeFlows.length);
  assert.ok(world.logisticsSectors.some((sector) => sector.revenueUsdMinor > 0));
});

test("физический баланс товара сохраняется при торговле и передаче в цепочку", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  runMonths(world, 1);
  assert.ok(world.physicalCommodityFlows.length > 0);
  assert.ok(world.physicalCommodityFlows.every((flow) => flow.conservationGapMilliUnits === 0));
  const source = world.countryCommodityStates.find((state) => state.inventoryMilliUnits > 0)!;
  const before = source.inventoryMilliUnits;
  updateSupplyChains(world);
  assert.ok(source.inventoryMilliUnits <= before);
});

test("платёжный баланс использует финансовую ногу, а E&O остаётся малым остатком", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  runMonths(world, 12);
  for (const point of world.balanceOfPayments) {
    assert.equal(point.reconciliationWarning, false);
    assert.ok(Math.abs(point.errorsAndOmissionsUsdMinor) <= Math.max(10_000, Math.round((point.goodsExportsUsdMinor + point.goodsImportsUsdMinor) * 0.01)));
    assert.equal(point.currentAccountUsdMinor + point.capitalAccountUsdMinor + point.financialAccountUsdMinor + point.reserveChangeUsdMinor + point.errorsAndOmissionsUsdMinor, point.reconciliationGapUsdMinor);
  }
  assert.ok(world.foreignDirectInvestments.length > 0);
  assert.ok(world.internationalPortfolioPositions.length > 0);
  assert.ok(world.crossBorderLoans.length > 0);
});

test("страновые различия занятости и долга сохраняются после года", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const before = new Map(world.countryEconomicProfiles.map((profile) => [profile.countryId, profile.unemploymentBps]));
  runMonths(world, 12);
  const latest = world.countries.map((country) => [...world.countryMetricsHistory].reverse().find((point) => point.countryId === country.id)!);
  assert.ok(new Set(latest.map((point) => point.unemploymentBps)).size >= 5);
  for (const point of latest) assert.ok(Math.abs(point.unemploymentBps - before.get(point.countryId)!) < 300);
  assert.ok(world.governmentBudgets.find((budget) => budget.countryId === "jp")!.publicDebtMinor > world.governmentBudgets.find((budget) => budget.countryId === "nl")!.publicDebtMinor);
});

test("реальные компании и банки имеют макрофинансовый масштаб", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  assert.ok(world.companies.filter((company) => company.representationTier === "A").every((company) => company.baselineFinancials && company.baselineFinancials.revenueMinor > 0 && company.baselineFinancials.assetsMinor > company.baselineFinancials.revenueMinor));
  assert.ok(world.banks.every((bank) => bank.baselineFinancials && bank.baselineFinancials.assetsMinor > bank.baselineFinancials.capitalMinor));
  assert.ok(world.bankingSectorCohorts.every((cohort) => cohort.assetsMinor > cohort.capitalMinor && cohort.bankCountEquivalent > 0));
});

test("исторические годы переводятся в календарь мира, а метрики не подменяются", () => {
  const reference = { id: "calendar", countryId: "us", metric: "inflationBps", months: [0, 12, 24], years: [2019, 2020, 2021], frequency: "annual" as const, values: [100, 200, 300], metadata: { sourceType: "REAL_DATA" as const, baseYear: 2021 } };
  const aligned = alignReferenceSeriesToWorld(reference, 2019, 1);
  assert.deepEqual(aligned.months, [11, 23, 35]);
  const points = [{ elapsedMonth: 11, gdpGrowthBps: 900, inflationBps: 100, unemploymentBps: 500, creditToGdpBps: 8_000 }];
  assert.equal(simulatedMetricSeries("inflationBps", points).get(11), 100);
  assert.equal(simulatedMetricSeries("unemploymentBps", points).get(11), 500);
});

test("исторический старт создаёт baseline выбранного года без неявного replay", () => {
  const world2019 = createWorld("baseline", { mode: "REAL_WORLD", referenceYear: 2019 });
  const world2023 = createWorld("baseline", { mode: "REAL_WORLD", referenceYear: 2023 });
  assert.equal(world2019.clock.startYear, 2019);
  assert.equal(world2019.baselineReference.replayObservedExternalShocks, false);
  assert.ok(world2019.countryEconomicProfiles.find((profile) => profile.countryId === "us")!.baselineNominalGdpMinor < world2023.countryEconomicProfiles.find((profile) => profile.countryId === "us")!.baselineNominalGdpMinor);
  assert.equal(world2019.countryEconomicProfiles.find((profile) => profile.countryId === "us")!.unemploymentBps, 367);
  const result = runEconomicLab(world2023, { countryId: "us", historicalStartYear: 2019, horizonMonths: 1 });
  assert.ok(result.baselineWorldId.includes(":2019:"));
  const validationWorld = createHistoricalValidationWorld(world2023, 2019, 2020);
  assert.ok(validationWorld.macroHistory.some((point) => point.countryId === "us" && point.elapsedMonth === 12));
});

test("экономическая лаборатория удерживает шок и показывает фактический causal trace", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const result = runEconomicLab(world, { countryId: "us", horizonMonths: 12, policyRateDeltaBps: 200, policyDurationMonths: 12, policyMode: "RATE_SHOCK" });
  assert.ok(result.deltas.some((delta) => delta.delta !== 0));
  assert.ok(result.causalChain.some((link) => link.from === "policyRateBps" && link.to === "averageLoanRateBps" && link.evidence.some((id) => id.startsWith("policy-experiment-"))));
  assert.ok(result.causalChain.every((link) => link.evidence.length > 0));
});

test("coordinate search улучшает training objective и отдельно считает validation", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const target = { ...world.calibratedParameters, consumptionIncomeElasticityBps: 10_000, priceAdjustmentSpeedBps: 1_600 };
  const objective = (parameters: typeof target, split: "training" | "validation") => Object.keys(target).reduce((sum, key) => sum + Math.abs(parameters[key as keyof typeof target] - target[key as keyof typeof target]), split === "training" ? 0 : 25);
  const result = searchCalibratedParameters(world.calibratedParameters, objective, 3);
  assert.ok(result.trainingErrorBps < result.baselineTrainingErrorBps);
  assert.ok(result.validationErrorBps >= result.trainingErrorBps);
  assert.ok(result.iterations > 10);
});
