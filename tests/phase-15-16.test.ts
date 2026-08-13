import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/economy/create-world.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { transferDefenseAid } from "../src/defense-economy/engine.ts";
import { activateConflict, mobilizeConflict, proposeConflict, runConflictMonth, settleConflict } from "../src/conflict/engine.ts";
import { depositOf } from "../src/core/ledger.ts";

test("оборонный бюджет переводит реальные деньги поставщикам и персоналу", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const government = world.governments.find((item) => item.countryId === "ru")!;
  const before = depositOf(world, government.id);
  runMonths(world, 1);
  const defense = world.defenseEconomy.countries.find((item) => item.countryId === "ru")!;
  assert.ok(defense.personnelSpendingMinor > 0);
  assert.ok(defense.procurementSpendingMinor > 0);
  assert.ok(depositOf(world, government.id) < before || world.sovereignAuctions.some((item) => item.countryId === "ru" && item.status === "settled"));
  assert.ok(world.ledger.transactions.some((item) => item.kind === "PROCUREMENT" && item.memo.includes("Оборонный")));
});

test("дефицит входов ограничивает оборонный выпуск, недофинансирование снижает readiness", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const defense = world.defenseEconomy.countries.find((item) => item.countryId === "de")!;
  const electronics = world.defenseEconomy.industries.find((item) => item.countryId === "de" && item.category === "electronics")!;
  electronics.importDependencyBps = 9_500;
  const dependencies = world.geoeconomics.directionalDependencies.filter((item) => item.sourceCountryId === "de");
  if (!dependencies.length) world.geoeconomics.directionalDependencies.push({ sourceCountryId: "de", targetCountryId: "us", tradeDependencyBps: 9_500, importDependencyBps: 9_500, financeDependencyBps: 0, strategicDependencyBps: 9_500, updatedAtMonth: world.clock.elapsedMonths });
  dependencies.forEach((item) => { item.strategicDependencyBps = 9_500; });
  world.geoeconomics.policies.push({ id: "test-export-control", actorCountryId: "us", targetCountryIds: ["de"], kind: "export-control", commodityIds: ["electronics"], rateBps: 0, accessPenaltyBps: 9_500, startsAtMonth: 0, endsAtMonth: null, status: "active", retaliationOfId: null, transactionIds: [] });
  const before = defense.readinessBps;
  defense.targetSpendingToGdpBps = 1;
  runMonths(world, 18);
  assert.ok(electronics.inputAvailabilityBps < 6_000);
  assert.ok(defense.readinessBps < before);
});

test("военная помощь сохраняет сумму агрегированных запасов", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const donor = world.defenseEconomy.countries.find((item) => item.countryId === "us")!;
  const recipient = world.defenseEconomy.countries.find((item) => item.countryId === "de")!;
  const equipment = donor.equipmentStockMinor + recipient.equipmentStockMinor;
  const supplies = donor.medicalLogisticsStockMinor + recipient.medicalLogisticsStockMinor;
  assert.equal(transferDefenseAid(world, "us", "de", 1_000_000, 500_000), true);
  assert.equal(donor.equipmentStockMinor + recipient.equipmentStockMinor, equipment);
  assert.equal(donor.medicalLogisticsStockMinor + recipient.medicalLogisticsStockMinor, supplies);
});

test("мобилизация, конверсия, снабжение и ущерб проходят через реальные запасы", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const conflict = proposeConflict(world, "us", "de", "coerce")!;
  assert.ok(conflict);
  assert.equal(activateConflict(world, conflict.id), true);
  const us = world.defenseEconomy.countries.find((item) => item.countryId === "us")!;
  const beforeReserve = us.reservePersonnel;
  const beforeEquipment = us.equipmentStockMinor;
  const beforeLogistics = world.logisticsSectors.find((item) => item.countryId === "us")!.capacityMilliUnits;
  assert.equal(mobilizeConflict(world, conflict.id, "us", 10_000, 1_000), true);
  assert.ok(us.reservePersonnel < beforeReserve);
  runConflictMonth(world);
  assert.ok(us.equipmentStockMinor < beforeEquipment);
  assert.ok(world.logisticsSectors.find((item) => item.countryId === "us")!.capacityMilliUnits < beforeLogistics);
  conflict.continuationPressureBpsByCountry.us = 8_000; conflict.continuationPressureBpsByCountry.de = 8_000;
  assert.equal(settleConflict(world, conflict.id), true);
  assert.equal(conflict.status, "settled");
});
