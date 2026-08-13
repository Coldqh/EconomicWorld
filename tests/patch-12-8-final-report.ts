import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { convertMinor } from "../src/finance/currencies.ts";

const IDS = ["us", "jp", "de", "kr", "ru"];
const CHECKPOINTS = new Set([0, 12, 60, 120, 240]);
const world = createWorld("baseline", { mode: "REAL_WORLD" });
const trajectories: Record<string, Array<Record<string, number>>> = Object.fromEntries(IDS.map((id) => [id, []]));
const maxGaps: Record<string, Record<string, number>> = Object.fromEntries(IDS.map((id) => [id, { gdpMinor: 0, householdMinor: 0, firmMinor: 0, fiscalMinor: 0, debtMinor: 0, bopUsdMinor: 0 }]));

const snapshot = (month: number) => {
  for (const countryId of IDS) {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === countryId)!;
    const currencyId = world.countries.find((item) => item.id === countryId)!.currencyReference;
    const period = world.countryEconomicAccounts.closedByCountry[countryId];
    const budget = world.governmentBudgets.find((item) => item.countryId === countryId)!;
    const annualGdpMinor = world.countryScaleReconciliations.find((item) => item.countryId === countryId)?.targetAnnualNominalGdpMinor ?? profile.baselineNominalGdpMinor * 12;
    if (!period) {
      trajectories[countryId].push({ month, gdpMinor: annualGdpMinor, revenueToGdpBps: 0, primarySpendingToGdpBps: profile.governmentSpendingShareBps, interestToGdpBps: 0, primaryBalanceToGdpBps: profile.budgetBalanceToGdpBps, overallBalanceToGdpBps: profile.budgetBalanceToGdpBps, debtToGdpBps: profile.governmentDebtToGdpBps });
      continue;
    }
    const fiscal = period.fiscal;
    const revenueMonthly = fiscal.personalTaxMinor + fiscal.corporateTaxMinor + fiscal.consumptionTaxMinor + fiscal.tariffsMinor + fiscal.propertyOtherTaxMinor + fiscal.otherRevenueMinor + fiscal.soeDividendsMinor;
    const primaryMonthly = fiscal.consumptionMinor + fiscal.investmentMinor + fiscal.transfersMinor + fiscal.subsidiesMinor;
    const annualize = (value: number) => Math.round(value * 12 * 10_000 / Math.max(1, annualGdpMinor));
    trajectories[countryId].push({ month, gdpMinor: annualGdpMinor, revenueToGdpBps: annualize(revenueMonthly), primarySpendingToGdpBps: annualize(primaryMonthly), interestToGdpBps: annualize(fiscal.interestMinor), primaryBalanceToGdpBps: annualize(fiscal.primaryBalanceMinor), overallBalanceToGdpBps: annualize(fiscal.overallBalanceMinor), debtToGdpBps: Math.round(budget.publicDebtMinor * 10_000 / Math.max(1, annualGdpMinor)) });
    void currencyId;
  }
};

snapshot(0);
const started = performance.now();
for (let month = 1; month <= 240; month += 1) {
  runMonths(world, 1);
  for (const countryId of IDS) {
    const period = world.countryEconomicAccounts.closedByCountry[countryId];
    if (!period || month > 12) continue;
    const household = world.countryEconomicAccounts.householdAccounts.filter((item) => item.countryId === countryId).reduce((max, item) => Math.max(max, Math.abs(item.budgetGapMinor)), 0);
    const firm = world.countryEconomicAccounts.firmAccounts.filter((item) => item.countryId === countryId).reduce((max, item) => Math.max(max, Math.abs(item.pnlGapMinor)), 0);
    maxGaps[countryId].gdpMinor = Math.max(maxGaps[countryId].gdpMinor, Math.abs(period.reconciliation.productionExpenditureGapMinor), Math.abs(period.reconciliation.productionIncomeGapMinor));
    maxGaps[countryId].householdMinor = Math.max(maxGaps[countryId].householdMinor, household);
    maxGaps[countryId].firmMinor = Math.max(maxGaps[countryId].firmMinor, firm);
    maxGaps[countryId].fiscalMinor = Math.max(maxGaps[countryId].fiscalMinor, Math.abs(period.fiscal.cashGapMinor));
    maxGaps[countryId].debtMinor = Math.max(maxGaps[countryId].debtMinor, Math.abs(period.financial.debtBridgeGapMinor));
    maxGaps[countryId].bopUsdMinor = Math.max(maxGaps[countryId].bopUsdMinor, Math.abs(period.external.reconciliationGapMinor));
  }
  if (CHECKPOINTS.has(month) && month !== 12) snapshot(month);
}

console.log(JSON.stringify({ wallClockMs: Math.round(performance.now() - started), saveSizeBytes: Buffer.byteLength(JSON.stringify(world)), heapUsedBytes: process.memoryUsage().heapUsed, mainBundleNote: "read from production build", maxMonthlyGaps1Y: maxGaps, trajectories, currencies: Object.fromEntries(IDS.map((id) => [id, world.countries.find((item) => item.id === id)?.currencyReference])), usdCheck: convertMinor(world, 100, "USD", "USD") }, null, 2));
