import assert from "node:assert/strict";
import test from "node:test";
import { bankAccountBalance, bankAccountsForOwner, openBankAccount, sumAccounts, transferBankAccountBalance } from "../src/core/ledger.ts";
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
import type { WorldState } from "../src/domain/model.ts";

test("фазы 3 и 4 создают масштабный географический мир", () => {
  const world = createWorld();
  assert.equal(world.schemaVersion, 5);
  assert.equal(world.saveVersion, 5);
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
  assert.equal(migrated.schemaVersion, 5);
  assert.ok(bankAccountsForOwner(migrated, migrated.player.householdId, "RUB").length > 0);
  assert.ok(migrated.bankAccounts.every((account) => migrated.ledger.accounts[account.ledgerDepositAccountId]));
  assert.equal(migrated.player.personId, "person-player");
  assert.ok(migrated.companies.some((company) => company.id === dynamicCompany.id));
  assert.deepEqual(checkInvariants(migrated).filter((item) => !item.ok), []);
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

test("автономный мир проходит 20 лет с архивированием истории", { timeout: 90_000 }, () => {
  const world = createWorld();
  const started = Date.now();
  runMonths(world, 240);
  const elapsedMs = Date.now() - started;
  assert.equal(world.clock.elapsedMonths, 240);
  assert.equal(world.metricsHistory.length, 240);
  assert.ok(world.ledgerArchives.length > 0);
  assert.ok(world.diagnostics.ledgerArchivedTransactions > world.diagnostics.ledgerHotTransactions);
  assert.ok(world.events.some((event) => event.type === "CompanyBankrupt"));
  assert.ok(world.events.some((event) => event.type === "CompanyFounded"));
  assert.ok(world.companies.length >= 100);
  assert.ok(elapsedMs < 60_000, `20 лет рассчитаны за ${elapsedMs} мс`);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});
