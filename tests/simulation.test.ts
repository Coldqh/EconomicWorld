import assert from "node:assert/strict";
import test from "node:test";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { deterministicFingerprint } from "../src/economy/metrics.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { acceptJobOffer, applyForJob, enrollPlayerCourse, setPlayerProfile } from "../src/player/commands.ts";
import { playerFinancialSummary, playerPerson } from "../src/player/system.ts";

test("фазы 1.5 и 2 создают полный минимальный мир", () => {
  const world = createWorld();
  assert.equal(world.schemaVersion, 2);
  assert.equal(world.saveVersion, 2);
  assert.equal(world.households.length, 100);
  assert.equal(world.people.length, 100);
  assert.equal(world.companies.length, 10);
  assert.equal(world.banks.length, 2);
  assert.equal(world.goods.length, 5);
  assert.equal(world.households.filter((household) => household.employerId).length, 82);
  assert.ok(checkInvariants(world).every((item) => item.ok));
});

test("одинаковое состояние воспроизводит одинаковые 2 года", () => {
  const left = createWorld();
  const right = createWorld();
  runMonths(left, 24);
  runMonths(right, 24);
  assert.equal(deterministicFingerprint(left), deterministicFingerprint(right));
});

test("игрок получает работу и зарплату только через обычные контуры", () => {
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

test("обучение оплачивается проводкой и меняет навыки после срока", () => {
  const world = createWorld();
  setPlayerProfile(world, "Ученик", "student");
  const before = playerPerson(world).skills.accounting;
  const enrollment = enrollPlayerCourse(world, "accounting-basics");
  assert.equal(enrollment.ok, true);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "EDUCATION"));
  runMonths(world, 3);
  assert.ok(world.player.completedCourseIds.includes("accounting-basics"));
  assert.ok(playerPerson(world).skills.accounting > before);
});

test("национальные счета, запасы и капитал сходятся после года", () => {
  const world = createWorld();
  runMonths(world, 12);
  const metric = world.metricsHistory.at(-1)!;
  assert.equal(metric.gdpValueAddedCents, metric.gdpExpenditureCents);
  assert.equal(metric.gdpReconciliationGapCents, 0);
  assert.ok(world.companies.every((company) => company.financialReports.length > 0));
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});

test("автономная экономика проходит 20 лет и сохраняет инварианты", () => {
  const world = createWorld();
  const initialPrices = Object.fromEntries(
    world.companies.map((company) => [company.id, company.priceCents]),
  );
  runMonths(world, 240);

  assert.equal(world.clock.elapsedMonths, 240);
  assert.equal(world.metricsHistory.length, 240);
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "WAGE"));
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "GOODS_CLEARING"));
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "LOAN_ISSUED"));
  assert.ok(world.ledger.transactions.some((transaction) => transaction.kind === "LOAN_PRINCIPAL"));
  assert.ok(world.companies.some((company) => company.priceCents !== initialPrices[company.id]));
  assert.ok(world.events.some((event) => event.type === "CompanyBankrupt"));
  assert.ok(world.events.some((event) => event.type === "CompanyFounded"));

  const failures = checkInvariants(world).filter((item) => !item.ok);
  assert.deepEqual(failures, []);
});

test("сценарий высоких ставок автономно проходит вторые 20 лет", () => {
  const world = createWorld("high-rates");
  runMonths(world, 240);
  assert.equal(world.clock.elapsedMonths, 240);
  assert.equal(world.metricsHistory.length, 240);
  assert.ok(world.centralBank.policyRateHistory.length > 1);
  assert.deepEqual(checkInvariants(world).filter((item) => !item.ok), []);
});
