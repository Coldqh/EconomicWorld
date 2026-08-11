import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { createFuture, createInterestRateSwap } from "../src/finance/derivatives.ts";

const world = createWorld();
const exchange = world.exchanges.find((item) => item.countryId === "ru")!;
const listing = world.listings.find((item) => item.exchangeId === exchange.id)!;
const banks = world.banks.filter((item) => item.countryId === "ru");
createFuture(world, banks[0].id, banks[1].id, { kind: "equity", securityId: listing.securityId }, exchange.id, 2, 10, 120);
createInterestRateSwap(world, banks[0].id, banks[1].id, "money-area-rub", 10_000_000_00, 700, 120, 3);

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
  derivativeContracts: world.derivativeContracts.length,
  sovereignBonds: world.sovereignBonds.length,
  marketTrades: world.marketTrades.length,
  hotLedgerTransactions: world.ledger.transactions.length,
  archivedLedgerTransactions: world.diagnostics.ledgerArchivedTransactions,
  saveSizeBytes: Buffer.byteLength(JSON.stringify(world)),
  heapUsedBytes: process.memoryUsage().heapUsed,
  wallClockMs,
};

console.log(JSON.stringify(report, null, 2));
