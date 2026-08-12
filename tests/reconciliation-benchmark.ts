import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { convertMinor } from "../src/finance/currencies.ts";

interface BenchmarkPoint {
  years: number;
  wallClockMs: number;
  saveSizeBytes: number;
  heapUsedBytes: number;
  hotTransactions: number;
  archivedTransactions: number;
  detailedTradeFlows: number;
  compactedTradeFlows: number;
  fdiPositions: number;
  portfolioPositions: number;
  crossBorderLoans: number;
  explicitCompanies: number;
  firmCohorts: number;
  populationCohorts: number;
  bankingSectorCohorts: number;
  sovereignHolderCohorts: number;
  derivativeContracts: number;
  bopWarnings: number;
  reserveInterventionMonths: number;
  countrySnapshots: Record<string, { unemploymentBps: number; debtToGdpBps: number; tradeToGdpBps: number }>;
}

const world = createWorld("baseline", { mode: "REAL_WORLD" });
const points: BenchmarkPoint[] = [];
let completedMonths = 0;
const benchmarkStarted = performance.now();

for (const years of [1, 5, 20]) {
  const targetMonths = years * 12;
  runMonths(world, targetMonths - completedMonths);
  const wallClockMs = Math.round(performance.now() - benchmarkStarted);
  completedMonths = targetMonths;
  const failures = checkInvariants(world).filter((item) => !item.ok);
  if (failures.length) throw new Error(JSON.stringify({ years, failures }));
  points.push({
    years,
    wallClockMs,
    saveSizeBytes: Buffer.byteLength(JSON.stringify(world)),
    heapUsedBytes: process.memoryUsage().heapUsed,
    hotTransactions: world.ledger.transactions.length,
    archivedTransactions: world.diagnostics.ledgerArchivedTransactions,
    detailedTradeFlows: world.tradeFlows.length,
    compactedTradeFlows: world.history.compactedTradeRecords.length,
    fdiPositions: world.foreignDirectInvestments.length,
    portfolioPositions: world.internationalPortfolioPositions.length,
    crossBorderLoans: world.crossBorderLoans.length,
    explicitCompanies: world.companies.length,
    firmCohorts: world.firmCohorts.length,
    populationCohorts: world.populationCohorts.length,
    bankingSectorCohorts: world.bankingSectorCohorts.length,
    sovereignHolderCohorts: world.sovereignHolderCohorts.length,
    derivativeContracts: world.derivativeContracts.length + world.history.compactedDerivativeRecords.length,
    bopWarnings: world.balanceOfPayments.filter((point) => point.reconciliationWarning).length,
    reserveInterventionMonths: world.balanceOfPayments.filter((point) => point.reserveChangeUsdMinor !== 0).length,
    countrySnapshots: Object.fromEntries(["us", "jp", "kr", "ru"].map((countryId) => {
      const metric = [...world.countryMetricsHistory].reverse().find((item) => item.countryId === countryId);
      const bop = [...world.balanceOfPayments].reverse().find((item) => item.countryId === countryId);
      const budget = world.governmentBudgets.find((item) => item.countryId === countryId);
      const currencyId = world.countries.find((item) => item.id === countryId)?.currencyReference ?? "USD";
      const tradeLocalMinor = bop ? convertMinor(world, bop.goodsExportsUsdMinor + bop.goodsImportsUsdMinor, "USD", currencyId) ?? 0 : 0;
      const structuralAnnualGdp = world.countryScaleReconciliations.find((item) => item.countryId === countryId)?.targetAnnualNominalGdpMinor ?? (metric?.nominalGdpMinor ?? 0) * 12;
      return [countryId, {
        unemploymentBps: metric?.unemploymentBps ?? 0,
        debtToGdpBps: Math.round((budget?.publicDebtMinor ?? 0) * 10_000 / Math.max(1, structuralAnnualGdp)),
        tradeToGdpBps: Math.round(tradeLocalMinor * 12 * 10_000 / Math.max(1, structuralAnnualGdp)),
      }];
    })),
  });
}

console.log(JSON.stringify({ mode: world.baselineReference.mode, countries: world.countries.length, points }, null, 2));
