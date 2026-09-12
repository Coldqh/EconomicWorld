import assert from "node:assert/strict";
import test from "node:test";
import { createWorld } from "../src/economy/create-world.ts";
import { decideCompanyMonth } from "../src/company/decision-engine.ts";
import { priceCorporateLoan, runBankAlm } from "../src/banking/alm-engine.ts";
import { clearAuction, createAuction, submitBid } from "../src/markets/auction-engine/index.ts";
import { seedEconomicMarketsCompletion } from "../src/economy/economic-markets-init.ts";
import { issueInsurancePolicy, payInsuranceClaim, recordInsuranceLossEvent, reportInsuranceClaim } from "../src/insurance/engine.ts";
import { seedDeposit as seedGenesisDeposit } from "../src/core/ledger.ts";

function seedDeposit(world: ReturnType<typeof createWorld>, ownerId: string, bankId: string, amountMinor: number): void {
  const initialized = world.initializationComplete;
  world.initializationComplete = false;
  try { seedGenesisDeposit(world, ownerId, bankId, amountMinor); }
  finally { world.initializationComplete = initialized; }
}

test("компания повышает план производства при росте спроса и учитывает избыток запасов в цене", () => {
  const world = createWorld(); const company = world.companies[0]; company.lastSalesMilliUnits = 120_000; company.inventoryMilliUnits = 0; company.capacityMilliUnits = 500_000;
  const growing = decideCompanyMonth(world, company); assert.ok(growing.productionTargetMilliUnits > 0);
  company.inventoryMilliUnits = growing.desiredInventoryMilliUnits * 5; const stocked = decideCompanyMonth(world, company); assert.ok(stocked.productionTargetMilliUnits < growing.productionTargetMilliUnits); assert.ok(stocked.targetPriceMinor <= growing.targetPriceMinor);
});
test("банк формирует ALM и кредитную цену из фондирования, риска и капитала", () => {
  const world = createWorld(); runBankAlm(world); const bank = world.banks[0]; const company = world.companies.find((item) => item.bankId === bank.id)!; const offer = priceCorporateLoan(world, bank.id, company.id, 1_000_000)!;
  assert.ok(world.bankAlmStates.some((item) => item.bankId === bank.id)); assert.ok(offer.annualRateBps >= offer.expectedLossBps + offer.capitalCostBps); assert.ok(offer.riskScoreBps > 0);
});
test("Vickrey: победитель платит вторую цену; reserve запрещает продажу", () => {
  const world = createWorld(); const auction = createAuction(world, { sellerId: "seller", objectType: "privatization", objectId: "stake", mechanism: "vickrey", quantity: 1, reserveMinor: 100 });
  submitBid(world, auction.id, "a", 180); submitBid(world, auction.id, "b", 150); submitBid(world, auction.id, "c", 90); const allocations = clearAuction(world, auction.id); assert.equal(allocations[0].bidderId, "a"); assert.equal(allocations[0].clearingPriceMinor, 150);
  const failed = createAuction(world, { sellerId: "seller", objectType: "company", objectId: "x", mechanism: "first-price", quantity: 1, reserveMinor: 500 }); submitBid(world, failed.id, "a", 400); assert.deepEqual(clearAuction(world, failed.id), []); assert.equal(failed.status, "failed");
});
test("uniform-price и pay-as-bid используют разные цены расчёта", () => {
  const world = createWorld(); for (const mechanism of ["uniform-price", "pay-as-bid"] as const) { const auction = createAuction(world, { sellerId: "seller", objectType: "sovereign-bond", objectId: mechanism, mechanism, quantity: 8, reserveMinor: 80 }); submitBid(world, auction.id, "a", 110, 5); submitBid(world, auction.id, "b", 100, 5); const result = clearAuction(world, auction.id); assert.equal(result.reduce((sum, item) => sum + item.quantity, 0), 8); if (mechanism === "uniform-price") assert.equal(new Set(result.map((item) => item.clearingPriceMinor)).size, 1); else assert.equal(new Set(result.map((item) => item.clearingPriceMinor)).size, 2); }
});
test("страховая премия, резерв и выплата проходят реальным денежным потоком", () => {
  const world = createWorld(); seedEconomicMarketsCompletion(world); const insurer = world.insurers[0]; const holder = world.households.find((item) => world.banks.find((bank) => bank.id === item.bankId)?.countryId === insurer.countryId)!; seedDeposit(world, holder.id, world.banks.find((bank) => bank.id === holder.bankId)!.id, 1_000_000);
  const policy = issueInsurancePolicy(world, { insurerId: insurer.id, policyholderId: holder.id, line: "cyber", insuredValueMinor: 500_000, deductibleMinor: 10_000, limitMinor: 300_000, expectedFrequencyBps: 500, expectedSeverityBps: 2_000, securityPostureBps: 7_000 })!; assert.ok(policy.annualPremiumMinor > 0); const loss = recordInsuranceLossEvent(world, { ownerId: holder.id, assetId: "cyber-exposure", line: "cyber", category: "cyber-incident", sourceSystem: "test", economicLossMinor: 100_000, description: "Тестовый подтверждённый кибер-убыток", causeIds: [] })!; const claim = reportInsuranceClaim(world, policy.id, loss.id)!; assert.equal(claim.reservedMinor, 90_000); assert.equal(payInsuranceClaim(world, claim.id), true); assert.equal(claim.status, "paid"); assert.equal(claim.paidMinor, 90_000);
});
