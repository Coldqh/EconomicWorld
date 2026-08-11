import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { runMonths } from "../src/economy/simulation.ts";

const world = createWorld();

const started = performance.now();
runMonths(world, 240);
const wallClockMs = Math.round(performance.now() - started);
const failedInvariants = checkInvariants(world).filter((item) => !item.ok);
if (failedInvariants.length) throw new Error(JSON.stringify(failedInvariants));

const report = {
  months: world.clock.elapsedMonths,
  countries: world.countries.length,
  banks: world.banks.length,
  funds: world.funds.length,
  derivativeContractsDetailed: world.derivativeContracts.length,
  derivativeContractsCompacted: world.history.compactedDerivativeRecords.length,
  derivativeContractsTotal: world.derivativeContracts.length + world.history.compactedDerivativeRecords.length,
  derivativeContractsByType: Object.fromEntries([...new Set([...world.derivativeContracts.map((contract) => contract.type), ...world.history.compactedDerivativeRecords.map((contract) => contract.type)])].map((type) => [type, world.derivativeContracts.filter((contract) => contract.type === type).length + world.history.compactedDerivativeRecords.filter((contract) => contract.type === type).length])),
  derivativeContractsByMotive: Object.fromEntries([...new Set([...world.derivativeContracts.map((contract) => contract.decision?.motive ?? "NONE"), ...world.history.compactedDerivativeRecords.map((contract) => contract.motive ?? "NONE")])].map((motive) => [motive, world.derivativeContracts.filter((contract) => (contract.decision?.motive ?? "NONE") === motive).length + world.history.compactedDerivativeRecords.filter((contract) => (contract.motive ?? "NONE") === motive).length])),
  sovereignBonds: world.sovereignBonds.length,
  marketTrades: world.marketTrades.length,
  hotLedgerTransactions: world.ledger.transactions.length,
  archivedLedgerTransactions: world.diagnostics.ledgerArchivedTransactions,
  compactedLedgerTransactions: world.diagnostics.ledgerCompactedTransactions,
  importantLedgerTransactions: world.history.importantLedgerTransactions.length,
  saveSizeBytes: Buffer.byteLength(JSON.stringify(world)),
  saveBreakdownBytes: world.diagnostics.saveBreakdown,
  heapUsedBytes: process.memoryUsage().heapUsed,
  wallClockMs,
};

console.log(JSON.stringify(report, null, 2));
