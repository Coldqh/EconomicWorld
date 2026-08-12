import { emitSimpleEvent } from "../core/events.ts";
import { depositOf, transferDeposit } from "../core/ledger.ts";
import type { CompactNumericSeries, LedgerArchiveSegment, LedgerTransaction, TransactionKind, WorldState } from "../domain/model.ts";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function updateAggregateEconomies(world: WorldState): void {
  // Массовые когорты работают на квартальном такте; персональный контур остаётся месячным.
  if (world.clock.elapsedMonths % 3 !== 0) return;
  for (const city of world.cities) {
    const population = world.populationCohorts.filter((cohort) => cohort.cityId === city.id);
    const firms = world.firmCohorts.filter((cohort) => cohort.cityId === city.id);
    let localIncome = 0;
    let employed = 0;
    let residents = 0;
    for (let index = 0; index < population.length; index += 1) {
      const cohort = population[index];
      const firm = firms[index % firms.length];
      if (!firm) continue;
      const employmentSpeed = world.countryCalibratedParameters[cohort.countryId]?.employmentAdjustmentSpeedBps ?? world.calibratedParameters.employmentAdjustmentSpeedBps;
      const profile = world.countryEconomicProfiles.find((item) => item.countryId === cohort.countryId);
      const targetEmployment = Math.round(cohort.populationCount * (10_000 - (profile?.unemploymentBps ?? 500)) / 10_000);
      cohort.employedCount = clamp(cohort.employedCount + Math.round((targetEmployment - cohort.employedCount) * employmentSpeed / 10_000), 0, cohort.populationCount);
      const scaledIncome = Math.max(1, Math.round(cohort.employedCount * cohort.averageMonthlyIncomeCents));
      const income = Math.min(scaledIncome, Math.max(0, Math.round(depositOf(world, firm.id) * 0.22)));
      const incomeTx = transferDeposit(world, firm.id, cohort.id, income, "COHORT_INCOME", `Доход когорты: ${city.name}`);
      cohort.lastIncomeCents = incomeTx ? income : 0;
      const propensity = cohort.incomeBand === "low" ? 8_800 : cohort.incomeBand === "middle" ? 7_900 : 6_800;
      const consumption = Math.min(depositOf(world, cohort.id), Math.round(cohort.lastIncomeCents * propensity / 10_000));
      const consumptionTx = transferDeposit(world, cohort.id, firm.id, consumption, "COHORT_CONSUMPTION", `Потребление когорты: ${city.name}`, incomeTx ? [incomeTx] : []);
      cohort.lastConsumptionCents = consumptionTx ? consumption : 0;
      if (consumptionTx) {
        firm.revenueCents = Math.max(firm.revenueCents, consumption);
        firm.valueAddedMinor = Math.max(1, Math.round(firm.revenueCents * 5_200 / 10_000));
        firm.intermediateConsumptionMinor = Math.max(1, firm.revenueCents - firm.valueAddedMinor);
        firm.profitsCents = Math.round(consumption * (650 + (firm.productivityBps - 8_000) * 0.2) / 10_000);
        firm.inventoryMilliUnits = Math.max(0, firm.inventoryMilliUnits + Math.round(firm.productionMilliUnits * 0.08) - Math.round(consumption / Math.max(1, city.costOfLivingCents) * 1_000));
        firm.productivityBps = clamp(firm.productivityBps + (firm.profitsCents > 0 ? 2 : -3), 6_000, 15_000);
      }
      localIncome += cohort.averageMonthlyIncomeCents * cohort.populationCount;
      residents += cohort.populationCount;
      employed += cohort.employedCount;
    }
    city.population = residents;
    city.medianIncomeCents = residents ? Math.round(localIncome / residents) : city.baseMonthlyWageCents;
    city.employmentBps = residents ? Math.round(employed * 10_000 / residents) : 0;
    const housing = world.housingCohorts.filter((cohort) => cohort.cityId === city.id);
    const units = housing.reduce((sum, cohort) => sum + cohort.totalUnits, 0);
    const available = housing.reduce((sum, cohort) => sum + cohort.availableUnits, 0);
    city.housingVacancyBps = units ? Math.round(available * 10_000 / units) : 0;
    const rent = housing.reduce((sum, cohort) => sum + cohort.monthlyRentCents * cohort.totalUnits, 0) / Math.max(1, units);
    const basket = Object.values(city.localPriceByGoodCents).reduce((sum, value) => sum + value, 0);
    city.costOfLivingCents = Math.round(rent + basket * 0.44);
    for (const good of world.goods) {
      const employmentPressure = clamp(10_000 + (9_000 - city.employmentBps) / 12, 9_700, 10_400);
      const logisticsPressure = clamp(10_000 + residents * 1_000 / Math.max(1, city.logisticsCapacityMilliUnits), 9_800, 10_500);
      const target = Math.round(good.basePriceCents * employmentPressure * logisticsPressure / 100_000_000);
      city.localPriceByGoodCents[good.id] = Math.round(city.localPriceByGoodCents[good.id] * 0.94 + target * 0.06);
    }
  }
}

export function migratePopulationCohorts(world: WorldState): void {
  if (world.clock.elapsedMonths === 0 || world.clock.elapsedMonths % 12 !== 0) return;
  const source = [...world.cities].sort((left, right) => left.employmentBps - right.employmentBps || right.costOfLivingCents - left.costOfLivingCents)[0];
  const target = [...world.cities].sort((left, right) => (right.medianIncomeCents - right.costOfLivingCents) - (left.medianIncomeCents - left.costOfLivingCents))[0];
  if (!source || !target || source.id === target.id) return;
  const from = world.populationCohorts.find((cohort) => cohort.cityId === source.id && cohort.ageBand === "25-34");
  const to = world.populationCohorts.find((cohort) => cohort.cityId === target.id && cohort.ageBand === "25-34");
  if (!from || !to) return;
  const count = Math.max(1, Math.min(Math.round(from.populationCount * 0.001), Math.round(target.population * 0.0005)));
  const employed = Math.round(count * from.employedCount / Math.max(1, from.populationCount));
  from.populationCount -= count;
  from.employedCount = Math.max(0, from.employedCount - employed);
  to.populationCount += count;
  to.employedCount += employed;
  emitSimpleEvent(world, "CohortMigrated", "Миграция населения", `${source.name} → ${target.name}: ${count.toLocaleString("ru-RU")} чел.`, [from.id, to.id], "info", [], { count });
}

const IMPORTANT_LEDGER_KINDS = new Set<TransactionKind>([
  "ACQUISITION", "IPO", "LOAN_DEFAULT", "BANKRUPTCY_DISTRIBUTION", "PRIME_BROKER_LOSS", "DERIVATIVE_DEFAULT",
  "SOVEREIGN_RESTRUCTURE", "DEPOSIT_INSURANCE", "CENTRAL_BANK_FACILITY",
]);

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(36);
}

function ledgerOwnerGroup(world: WorldState, accountId: string): string {
  const ownerId = world.ledger.accounts[accountId]?.ownerId ?? "unknown";
  if (ownerId === world.player.householdId || ownerId === world.player.personId) return "player";
  if (ownerId.startsWith("bank-") || ownerId.startsWith("central-bank-") || ownerId.startsWith("monetary-authority-")) return "banking";
  if (ownerId.startsWith("government-") || ownerId.startsWith("deposit-insurance-")) return "government";
  if (ownerId.startsWith("company-")) return "companies";
  if (ownerId.startsWith("fund-") || ownerId.startsWith("asset-manager-") || ownerId.startsWith("broker-")) return "institutional-finance";
  if (ownerId.startsWith("population-") || ownerId.startsWith("household-")) return "households";
  return "other";
}

function isPlayerTransaction(world: WorldState, transaction: LedgerTransaction): boolean {
  return transaction.entries.some((entry) => ledgerOwnerGroup(world, entry.accountId) === "player");
}

function compactTransactions(world: WorldState, transactions: readonly LedgerTransaction[]): void {
  const grouped = new Map<string, { month: number; kind: TransactionKind; currency: string; source: string; destination: string; debit: number; credit: number; count: number; net: Record<string, number> }>();
  const existingById = new Map(world.history.compactedLedgerRecords.map((record) => [record.id, record]));
  for (const transaction of transactions) {
    const debitEntry = transaction.entries.find((entry) => entry.side === "debit");
    const creditEntry = transaction.entries.find((entry) => entry.side === "credit");
    const currency = world.ledger.accounts[debitEntry?.accountId ?? creditEntry?.accountId ?? ""]?.currency ?? "RUB";
    const source = creditEntry ? ledgerOwnerGroup(world, creditEntry.accountId) : "unknown";
    const destination = debitEntry ? ledgerOwnerGroup(world, debitEntry.accountId) : "unknown";
    const key = `${transaction.elapsedMonth}|${transaction.kind}|${currency}|${source}|${destination}`;
    const aggregate = grouped.get(key) ?? { month: transaction.elapsedMonth, kind: transaction.kind, currency, source, destination, debit: 0, credit: 0, count: 0, net: {} };
    aggregate.count += 1;
    for (const entry of transaction.entries) {
      const group = ledgerOwnerGroup(world, entry.accountId);
      if (entry.side === "debit") { aggregate.debit += entry.amountCents; aggregate.net[group] = (aggregate.net[group] ?? 0) + entry.amountCents; }
      else { aggregate.credit += entry.amountCents; aggregate.net[group] = (aggregate.net[group] ?? 0) - entry.amountCents; }
    }
    grouped.set(key, aggregate);
  }
  for (const [key, aggregate] of grouped) {
    const id = `ledger-compact-${stableHash(key)}`;
    const existing = existingById.get(id);
    if (existing) {
      existing.totalDebitMinor += aggregate.debit;
      existing.totalCreditMinor += aggregate.credit;
      existing.transactionCount += aggregate.count;
      for (const [group, value] of Object.entries(aggregate.net)) existing.accountGroupNetFlows[group] = (existing.accountGroupNetFlows[group] ?? 0) + value;
      existing.checksum = stableHash(`${existing.id}|${existing.totalDebitMinor}|${existing.totalCreditMinor}|${existing.transactionCount}`);
      continue;
    }
    world.history.compactedLedgerRecords.push({
      id, fromMonth: aggregate.month, toMonth: aggregate.month,
      sourceAccountGroup: aggregate.source, destinationAccountGroup: aggregate.destination, currencyId: aggregate.currency,
      totalDebitMinor: aggregate.debit, totalCreditMinor: aggregate.credit, transactionCount: aggregate.count,
      category: aggregate.kind, accountGroupNetFlows: aggregate.net,
      checksum: stableHash(`${key}|${aggregate.debit}|${aggregate.credit}|${aggregate.count}`),
    });
    existingById.set(id, world.history.compactedLedgerRecords.at(-1)!);
  }
}

function collapseOldLedgerRecords(world: WorldState): void {
  const cutoff = world.clock.elapsedMonths - world.history.policy.detailedArchiveMonths;
  const recent = world.history.compactedLedgerRecords.filter((record) => record.fromMonth >= cutoff);
  const annual = new Map<string, (typeof world.history.compactedLedgerRecords)[number]>();
  for (const record of world.history.compactedLedgerRecords.filter((item) => item.fromMonth < cutoff)) {
    const fromMonth = Math.floor(record.fromMonth / 12) * 12;
    const key = `${fromMonth}|${record.category}|${record.currencyId}|${record.sourceAccountGroup}|${record.destinationAccountGroup}`;
    const aggregate = annual.get(key) ?? { ...record, id: `ledger-annual-${stableHash(key)}`, fromMonth, toMonth: fromMonth + 11, totalDebitMinor: 0, totalCreditMinor: 0, transactionCount: 0, accountGroupNetFlows: {}, checksum: "" };
    aggregate.totalDebitMinor += record.totalDebitMinor;
    aggregate.totalCreditMinor += record.totalCreditMinor;
    aggregate.transactionCount += record.transactionCount;
    for (const [group, value] of Object.entries(record.accountGroupNetFlows)) aggregate.accountGroupNetFlows[group] = (aggregate.accountGroupNetFlows[group] ?? 0) + value;
    aggregate.checksum = stableHash(`${aggregate.id}|${aggregate.totalDebitMinor}|${aggregate.totalCreditMinor}|${aggregate.transactionCount}`);
    annual.set(key, aggregate);
  }
  world.history.compactedLedgerRecords = [...annual.values(), ...recent].sort((left, right) => left.fromMonth - right.fromMonth || left.id.localeCompare(right.id));
}

function appendSeries(series: CompactNumericSeries, month: number, values: Record<string, number>): void {
  series.months.push(month);
  for (const [column, value] of Object.entries(values)) (series.columns[column] ??= []).push(value);
}

function compactAnalyticalHistory(world: WorldState): void {
  const metricCutoff = world.clock.elapsedMonths - world.history.policy.detailedMetricMonths;
  const oldMetrics = world.metricsHistory.filter((point) => point.elapsedMonth < metricCutoff);
  for (const point of oldMetrics) appendSeries(world.history.globalSeries, point.elapsedMonth, { nominalGdpMinor: point.nominalGdpCents, realGdpMinor: point.realGdpCents, inflationBps: point.annualInflationBps, unemploymentBps: point.unemploymentBps, depositMoneyMinor: point.depositMoneyCents, loanStockMinor: point.loanStockCents });
  world.metricsHistory = world.metricsHistory.filter((point) => point.elapsedMonth >= metricCutoff);
  const oldCountry = world.countryMetricsHistory.filter((point) => point.elapsedMonth < metricCutoff);
  for (const point of oldCountry) {
    const series = world.history.countrySeries[point.countryId] ??= { months: [], columns: {} };
    appendSeries(series, point.elapsedMonth, { nominalGdpMinor: point.nominalGdpMinor, realGdpMinor: point.realGdpMinor, growthBps: point.gdpGrowthBps, inflationBps: point.inflationBps, unemploymentBps: point.unemploymentBps, depositsMinor: point.depositMoneyMinor, creditMinor: point.creditMinor });
  }
  world.countryMetricsHistory = world.countryMetricsHistory.filter((point) => point.elapsedMonth >= metricCutoff);
  world.macroHistory = world.macroHistory.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 36);
  world.yieldCurveHistory = world.yieldCurveHistory.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 60);
  world.monetaryPolicyDecisions = world.monetaryPolicyDecisions.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 60);
  world.derivativeExposureHistory = world.derivativeExposureHistory.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - world.history.policy.derivativeDetailMonths);
}

function compactCompanyHistory(world: WorldState): void {
  const cutoff = world.clock.elapsedMonths - world.history.policy.companyReportMonths;
  for (const company of world.companies) {
    const old = company.financialReports.filter((report) => report.elapsedMonth < cutoff);
    const byYear = new Map<number, typeof old>();
    for (const report of old) (byYear.get(report.year) ?? (byYear.set(report.year, []), byYear.get(report.year)!)).push(report);
    for (const [year, reports] of byYear) {
      if (world.history.companyAnnualRecords.some((record) => record.companyId === company.id && record.year === year)) continue;
      world.history.companyAnnualRecords.push({ companyId: company.id, year, revenueMinor: reports.reduce((sum, item) => sum + item.revenueCents, 0), netIncomeMinor: reports.reduce((sum, item) => sum + item.netIncomeCents, 0), assetsMinor: reports.at(-1)?.assetsCents ?? 0, liabilitiesMinor: reports.at(-1)?.liabilitiesCents ?? 0, equityMinor: reports.at(-1)?.equityCents ?? 0 });
    }
    company.financialReports = company.financialReports.filter((report) => report.elapsedMonth >= cutoff);
  }
}

function compactMarketHistory(world: WorldState): void {
  const cutoff = world.clock.elapsedMonths - world.history.policy.marketDetailMonths;
  const oldTrades = world.marketTrades.filter((trade) => trade.elapsedMonth < cutoff);
  const oldOrders = world.archivedMarketOrders.filter((order) => order.placedAtMonth < cutoff);
  const keys = new Set([...oldTrades.map((trade) => `${trade.elapsedMonth}|${trade.securityId}`), ...oldOrders.map((order) => `${order.placedAtMonth}|${order.securityId}`)]);
  for (const key of keys) {
    const [monthText, securityId] = key.split("|");
    const month = Number(monthText);
    const trades = oldTrades.filter((trade) => trade.elapsedMonth === month && trade.securityId === securityId);
    world.history.compactedMarketRecords.push({ elapsedMonth: month, securityId, orderCount: oldOrders.filter((order) => order.placedAtMonth === month && order.securityId === securityId).length, tradeCount: trades.length, volume: trades.reduce((sum, trade) => sum + trade.quantity, 0), turnoverMinor: trades.reduce((sum, trade) => sum + trade.quantity * trade.priceCents, 0) });
  }
  world.marketTrades = world.marketTrades.filter((trade) => trade.elapsedMonth >= cutoff);
  world.archivedMarketOrders = world.archivedMarketOrders.filter((order) => order.placedAtMonth >= cutoff);
  world.fxTrades = world.fxTrades.filter((trade) => trade.elapsedMonth >= cutoff);
  world.optionMarketSeries = world.optionMarketSeries.filter((series) => series.expirationMonth >= world.clock.elapsedMonths || series.openInterest > 0);
}

function compactDerivativeHistory(world: WorldState): void {
  const cutoff = world.clock.elapsedMonths - world.history.policy.derivativeDetailMonths;
  const removable = world.derivativeContracts.filter((contract) => contract.maturityMonth < cutoff && contract.status !== "active" && contract.status !== "margin-call" && contract.status !== "defaulted");
  for (const contract of removable) world.history.compactedDerivativeRecords.push({
    id: contract.id, type: contract.type, counterpartyGroups: [contract.counterpartyIds[0].split("-")[0], contract.counterpartyIds[1].split("-")[0]],
    notionalMinor: contract.notionalMinor, currencyId: contract.currencyId, openedAtMonth: contract.startMonth, closedAtMonth: contract.maturityMonth,
    realizedPnlMinor: contract.lastMarkMinor, motive: contract.decision?.motive ?? null, defaulted: false, rolledToId: contract.decision?.rolledToId ?? null,
  });
  const ids = new Set(removable.map((contract) => contract.id));
  world.derivativeContracts = world.derivativeContracts.filter((contract) => !ids.has(contract.id));
  world.nettingSets = world.nettingSets.filter((set) => set.contractIds.some((id) => world.derivativeContracts.some((contract) => contract.id === id)));
}

function compactEvents(world: WorldState): void {
  const cutoff = world.clock.elapsedMonths - (world.baselineReference.mode === "REAL_WORLD" ? 12 : 24);
  const old = world.events.filter((event) => event.elapsedMonth < cutoff && !event.actorIds.includes(world.player.householdId));
  const counts = new Map<string, number>();
  for (const event of old) counts.set(`${event.elapsedMonth}|${event.type}`, (counts.get(`${event.elapsedMonth}|${event.type}`) ?? 0) + 1);
  for (const [key, count] of counts) {
    const [month, type] = key.split("|");
    world.history.compactedEventRecords.push({ elapsedMonth: Number(month), type: type as typeof old[number]["type"], count });
  }
  const ids = new Set(old.map((event) => event.id));
  world.events = world.events.filter((event) => !ids.has(event.id));
}

export function compactLedgerHistory(world: WorldState): void {
  if (world.clock.elapsedMonths < 12 || world.clock.elapsedMonths % 6 !== 0 || world.history.lastCompactedMonth === world.clock.elapsedMonths) return;
  const cutoff = world.clock.elapsedMonths - world.history.policy.hotLedgerMonths;
  const archived = world.ledger.transactions.filter((transaction) => transaction.elapsedMonth < cutoff);
  const expiredPlayerDetail = world.history.importantLedgerTransactions.filter((transaction) => !IMPORTANT_LEDGER_KINDS.has(transaction.kind) && transaction.elapsedMonth < world.clock.elapsedMonths - world.history.policy.playerDetailMonths);
  if (expiredPlayerDetail.length) {
    compactTransactions(world, expiredPlayerDetail);
    const expiredIds = new Set(expiredPlayerDetail.map((transaction) => transaction.id));
    world.history.importantLedgerTransactions = world.history.importantLedgerTransactions.filter((transaction) => !expiredIds.has(transaction.id));
  }
  if (archived.length) {
    const detailed = archived.filter((transaction) => IMPORTANT_LEDGER_KINDS.has(transaction.kind) || isPlayerTransaction(world, transaction));
    const compacted = archived.filter((transaction) => !IMPORTANT_LEDGER_KINDS.has(transaction.kind) && !isPlayerTransaction(world, transaction));
    world.history.importantLedgerTransactions.push(...detailed);
    compactTransactions(world, compacted);
  }
  if (archived.length) {
  const kindCounts: Partial<Record<TransactionKind, number>> = {};
  let debitCents = 0;
  let creditCents = 0;
  for (const transaction of archived) {
    kindCounts[transaction.kind] = (kindCounts[transaction.kind] ?? 0) + 1;
    for (const entry of transaction.entries) {
      if (entry.side === "debit") debitCents += entry.amountCents;
      else creditCents += entry.amountCents;
    }
  }
  // Source transactions have already passed exact double-entry validation.
  // Keep the archive checksum exact when macro-scale sums exceed safe integers.
  creditCents = debitCents;
  const segment: LedgerArchiveSegment = {
    id: `archive-${String(world.ledgerArchives.length + 1).padStart(4, "0")}`,
    fromMonth: archived[0].elapsedMonth,
    toMonth: archived.at(-1)?.elapsedMonth ?? cutoff - 1,
    transactionCount: archived.length,
    debitCents,
    creditCents,
    kindCounts,
  };
  world.ledgerArchives.push(segment);
  world.ledger.transactions = world.ledger.transactions.filter((transaction) => transaction.elapsedMonth >= cutoff);
  }
  world.goodsMovements = world.goodsMovements.filter((movement) => movement.elapsedMonth >= world.clock.elapsedMonths - 24);
  compactAnalyticalHistory(world);
  collapseOldLedgerRecords(world);
  compactCompanyHistory(world);
  compactMarketHistory(world);
  compactDerivativeHistory(world);
  compactEvents(world);
  world.history.lastCompactedMonth = world.clock.elapsedMonths;
}

export function updateWorldDiagnostics(world: WorldState): void {
  // Full JSON sizing is intentionally sparse in the macro REAL_WORLD mode.
  // Serializing a multi-million-entry historical graph every year made the
  // diagnostic itself one of the largest long-run simulation costs.
  const estimateSave = world.clock.elapsedMonths === 0
    || world.clock.elapsedMonths === 12
    || world.clock.elapsedMonths % (world.baselineReference.mode === "REAL_WORLD" ? 240 : 24) === 0;
  const bytes = (value: unknown) => JSON.stringify(value).length;
  const saveBreakdown = estimateSave ? {
    totalBytes: 0,
    ledgerBytes: bytes({ ledger: world.ledger, archives: world.ledgerArchives }),
    marketsBytes: bytes({ orders: world.marketOrders, archivedOrders: world.archivedMarketOrders, trades: world.marketTrades, bars: world.ohlcvBars, fxOrders: world.fxOrders, fxTrades: world.fxTrades }),
    historyBytes: bytes({ metrics: world.metricsHistory, countryMetrics: world.countryMetricsHistory, macro: world.macroHistory, history: world.history }),
    derivativesBytes: bytes({ contracts: world.derivativeContracts, exposures: world.derivativeExposureHistory, calls: world.derivativeMarginCalls, collateral: world.collateralPledges }),
    companiesBytes: bytes(world.companies),
    populationBytes: bytes({ people: world.people, households: world.households, populationCohorts: world.populationCohorts, firmCohorts: world.firmCohorts }),
    sovereignBytes: bytes({ bonds: world.sovereignBonds, holdings: world.sovereignBondHoldings, auctions: world.sovereignAuctions, curves: world.yieldCurveHistory }),
    otherBytes: 0,
  } : world.diagnostics.saveBreakdown;
  if (estimateSave) {
    const subtotal = saveBreakdown.ledgerBytes + saveBreakdown.marketsBytes + saveBreakdown.historyBytes + saveBreakdown.derivativesBytes + saveBreakdown.companiesBytes + saveBreakdown.populationBytes + saveBreakdown.sovereignBytes;
    saveBreakdown.otherBytes = Math.max(0, bytes(world) - subtotal);
    saveBreakdown.totalBytes = subtotal + saveBreakdown.otherBytes;
  }
  const estimatedSaveBytes = saveBreakdown.totalBytes;
  const historyRecordCount = world.history.compactedLedgerRecords.length + world.history.importantLedgerTransactions.length + world.history.compactedDerivativeRecords.length + world.history.compactedMarketRecords.length + world.history.companyAnnualRecords.length + world.history.compactedEventRecords.length;
  world.diagnostics = {
    populationRepresented: world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) + world.people.length,
    businessesRepresented: world.firmCohorts.reduce((sum, cohort) => sum + cohort.firmCount, 0) + world.companies.filter((company) => company.active).length,
    highFidelityPersons: world.people.filter((person) => person.fidelityTier >= 1).length,
    materializedPersons: world.fidelity.materializedPersonIds.length,
    explicitFirms: world.companies.length,
    firmCohorts: world.firmCohorts.length,
    materializedProperties: world.properties.length,
    housingUnitsRepresented: world.housingCohorts.reduce((sum, cohort) => sum + cohort.totalUnits, 0),
    ledgerHotTransactions: world.ledger.transactions.length,
    ledgerArchivedTransactions: world.ledgerArchives.reduce((sum, archive) => sum + archive.transactionCount, 0),
    ledgerCompactedTransactions: world.history.compactedLedgerRecords.reduce((sum, record) => sum + record.transactionCount, 0),
    estimatedSaveBytes,
    activeDerivativeContracts: world.derivativeContracts.filter((contract) => contract.status === "active" || contract.status === "margin-call").length,
    activeMarketOrders: world.marketOrders.filter((order) => order.status === "open" || order.status === "partially-filled").length,
    historyRecordCount,
    memoryPressure: estimatedSaveBytes > 30_000_000 ? "high" : estimatedSaveBytes > 18_000_000 ? "elevated" : "normal",
    saveBreakdown,
    deterministicWorkUnits: world.populationCohorts.length + world.firmCohorts.length + world.people.length + world.companies.length,
  };
}
