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

test("фазы 3 и 4 создают масштабный географический мир", () => {
  const world = createWorld();
  assert.equal(world.schemaVersion, 3);
  assert.equal(world.saveVersion, 3);
  assert.equal(world.households.length, 100);
  assert.equal(world.people.length, 100);
  assert.equal(world.companies.length, 10);
  assert.equal(world.countries.length, 10);
  assert.equal(world.cities.length, 30);
  assert.ok(world.universities.length >= 10);
  assert.ok(world.universityPrograms.every((program) => program.durationMonths >= 24));
  assert.ok(world.diagnostics.populationRepresented >= 1_000_000);
  assert.ok(world.diagnostics.businessesRepresented >= 10_000);
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
