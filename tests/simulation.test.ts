import assert from "node:assert/strict";
import test from "node:test";
import { sumAccounts } from "../src/core/ledger.ts";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { deterministicFingerprint } from "../src/economy/metrics.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { acceptJobOffer, applyForJob, setPlayerProfile } from "../src/player/commands.ts";
import { playerFinancialSummary, playerPerson } from "../src/player/system.ts";
import { applyUniversity, buyDurable, enrollUniversity, sellDurable, startTravel } from "../src/player/world-commands.ts";
import { dematerializePerson, materializePerson } from "../src/world/fidelity.ts";
import { issueBond, raiseEquity, transferShares } from "../src/corporate/finance.ts";
import { openBrokerageAccount, placeOrder } from "../src/markets/exchange.ts";

test("фазы 3 и 4 создают масштабный географический мир", () => {
  const world = createWorld();
  assert.equal(world.schemaVersion, 4);
  assert.equal(world.saveVersion, 4);
  assert.equal(world.households.length, 100);
  assert.equal(world.people.length, 100);
  assert.equal(world.companies.length, 33);
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
  assert.ok(elapsedMs < 60_000, `20 лет рассчитаны за ${elapsedMs} мс`);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});
