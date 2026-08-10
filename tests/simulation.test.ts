import assert from "node:assert/strict";
import test from "node:test";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { deterministicFingerprint } from "../src/economy/metrics.ts";
import { runMonths } from "../src/economy/simulation.ts";

test("Phase 1 создаёт заявленный минимальный мир", () => {
  const world = createWorld();
  assert.equal(world.households.length, 100);
  assert.equal(world.companies.length, 10);
  assert.equal(world.banks.length, 2);
  assert.equal(world.goods.length, 5);
  assert.equal(world.households.filter((household) => household.employerId).length, 82);
  assert.ok(checkInvariants(world).every((item) => item.ok));
});

test("одинаковое состояние воспроизводит одинаковые 5 лет", () => {
  const left = createWorld();
  const right = createWorld();
  runMonths(left, 60);
  runMonths(right, 60);
  assert.equal(deterministicFingerprint(left), deterministicFingerprint(right));
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
