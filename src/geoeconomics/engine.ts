import { bankAccountBalance, ensureAccount, openBankAccount, postTransaction } from "../core/ledger.ts";
import type { GeoeconomicPolicy, WorldState } from "../domain/model.ts";
import { convertMinor } from "../finance/currencies.ts";
import { currencyBankAccount, settleFinancialPayment, transferFinancialPrincipal } from "../finance/financial-settlement.ts";
import { recordBilateralExternalFlow, recordExternalFlow } from "../accounting/country-periods.ts";
import { createGeoeconomicsState, seedGeoeconomics } from "./state.ts";

const clamp = (value: number, low = 0, high = 10_000): number => Math.max(low, Math.min(high, Math.round(value)));
const currencyOf = (world: WorldState, countryId: string): string => world.countries.find((item) => item.id === countryId)?.currencyReference ?? "USD";

function trace(world: WorldState, actorCountryId: string, decision: string, targetCountryIds: string[], inputs: Record<string, number | string | boolean>, reasons: string[], evidenceIds: string[], outcome: "adopted" | "rejected" | "retaliated" | "expired"): void {
  world.geoeconomics.decisionTraces.push({ id: `geo-trace-${String(world.geoeconomics.nextDecisionTraceId++).padStart(7, "0")}`, actorCountryId, elapsedMonth: world.clock.elapsedMonths, decision, targetCountryIds, inputs, reasons, evidenceIds, outcome });
  if (world.geoeconomics.decisionTraces.length > 120) world.geoeconomics.decisionTraces.splice(0, world.geoeconomics.decisionTraces.length - 120);
}

export function adoptGeoeconomicPolicy(world: WorldState, input: Omit<GeoeconomicPolicy, "id" | "status" | "transactionIds">): GeoeconomicPolicy {
  const policy: GeoeconomicPolicy = { ...input, id: `geo-policy-${String(world.geoeconomics.nextPolicyId++).padStart(6, "0")}`, status: "active", transactionIds: [] };
  world.geoeconomics.policies.push(policy);
  trace(world, policy.actorCountryId, policy.kind, policy.targetCountryIds, { rateBps: policy.rateBps, accessPenaltyBps: policy.accessPenaltyBps }, policy.retaliationOfId ? ["Ответ на действующее ограничение"] : ["Защита стратегического интереса"], policy.retaliationOfId ? [policy.retaliationOfId] : [], policy.retaliationOfId ? "retaliated" : "adopted");
  return policy;
}

export function refreshStrategicInterests(world: WorldState): void {
  const totalImports = new Map<string, number>();
  for (const flow of world.tradeFlows.filter((item) => item.status === "settled")) totalImports.set(flow.importerCountryId, (totalImports.get(flow.importerCountryId) ?? 0) + Math.max(0, flow.invoiceValueMinor));
  world.geoeconomics.strategicInterests = world.countries.map((country) => {
    const energy = world.energyBalances.find((item) => item.countryId === country.id);
    const macro = world.countryMacroStates.find((item) => item.countryId === country.id);
    const budget = world.governmentBudgets.find((item) => item.countryId === country.id);
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id);
    return { countryId: country.id, energySecurityBps: clamp(5_000 + ((energy?.importsMilliUnits ?? 0) - (energy?.exportsMilliUnits ?? 0)) / 10_000), exportAccessBps: clamp(4_000 + (world.tradeSectors.find((item) => item.countryId === country.id)?.lastExportRevenueUsdMinor ?? 0) / 100_000), technologyAccessBps: clamp(5_500 + (profile?.productivityIndexBps ?? 8_000) / 5), financialStabilityBps: clamp(10_000 - (macro?.sovereignRiskBps ?? 0) * 4), fiscalSpaceBps: clamp(10_000 - (budget?.fiscalStressBps ?? 0)), updatedAtMonth: world.clock.elapsedMonths };
  });
  const dependencies = [];
  for (const source of world.countries) for (const target of world.countries) {
    if (source.id === target.id) continue;
    const bilateral = world.tradeFlows.filter((item) => item.status === "settled" && item.importerCountryId === source.id && item.exporterCountryId === target.id).reduce((sum, item) => sum + item.invoiceValueMinor, 0);
    const route = world.tradeRoutes.find((item) => item.originCountryId === target.id && item.destinationCountryId === source.id);
    const structural = route?.capacityMilliUnits ?? 0;
    const denominator = Math.max(1, totalImports.get(source.id) ?? structural * 4);
    const importDependencyBps = clamp(bilateral > 0 ? bilateral * 10_000 / denominator : structural > 0 ? 1_000 : 0);
    const finance = world.crossBorderLoans.filter((item) => item.lenderCountryId === target.id && item.borrowerCountryId === source.id && item.status !== "repaid").reduce((sum, item) => sum + item.reportingValueUsdMinor, 0);
    const financeDependencyBps = clamp(finance / 100_000);
    if (importDependencyBps || financeDependencyBps) dependencies.push({ sourceCountryId: source.id, targetCountryId: target.id, tradeDependencyBps: clamp(importDependencyBps + financeDependencyBps / 4), importDependencyBps, financeDependencyBps, strategicDependencyBps: clamp(importDependencyBps * 0.7 + financeDependencyBps * 0.3), updatedAtMonth: world.clock.elapsedMonths });
  }
  world.geoeconomics.directionalDependencies = dependencies;
}

function ensureCurrencyAccount(world: WorldState, ownerId: string, currencyId: string) {
  const existing = currencyBankAccount(world, ownerId, currencyId);
  if (existing) return existing;
  const bank = world.banks.find((item) => item.baseCurrency === currencyId);
  return bank ? openBankAccount(world, ownerId, bank.id) : null;
}

export function provideForeignAid(world: WorldState, donorCountryId: string, recipientCountryId: string, amountMinor: number): string | null {
  const donor = world.governments.find((item) => item.countryId === donorCountryId);
  const recipient = world.governments.find((item) => item.countryId === recipientCountryId);
  if (!donor || !recipient || donorCountryId === recipientCountryId || amountMinor <= 0) return null;
  const currencyId = donor.currencyId;
  if (!ensureCurrencyAccount(world, recipient.id, currencyId)) return null;
  const available = currencyBankAccount(world, donor.id, currencyId);
  const paid = available ? Math.min(Math.floor(amountMinor), bankAccountBalance(world, available.id)) : 0;
  const transactionId = paid > 0 ? settleFinancialPayment(world, donor.id, recipient.id, currencyId, paid, "FOREIGN_AID", `Внешняя помощь: ${donorCountryId} → ${recipientCountryId}`) : null;
  if (!transactionId) return null;
  const usd = convertMinor(world, paid, currencyId, "USD") ?? 0;
  recordBilateralExternalFlow(world, donorCountryId, recipientCountryId, "transfersPaidMinor", "transfersReceivedMinor", usd);
  recordExternalFlow(world, donorCountryId, "bankFlowsMinor", usd);
  recordExternalFlow(world, recipientCountryId, "bankFlowsMinor", -usd);
  return transactionId;
}

export function drawSovereignLendingFacility(world: WorldState, facilityId: string, amountMinor: number): string | null {
  const facility = world.geoeconomics.sovereignLendingFacilities.find((item) => item.id === facilityId && item.status === "open");
  if (!facility) return null;
  const lender = world.governments.find((item) => item.countryId === facility.lenderCountryId);
  const borrower = world.governments.find((item) => item.countryId === facility.borrowerCountryId);
  const draw = Math.min(Math.floor(amountMinor), facility.limitMinor - facility.drawnMinor);
  if (!lender || !borrower || draw <= 0 || !ensureCurrencyAccount(world, borrower.id, facility.currencyId)) return null;
  const transactionId = transferFinancialPrincipal(world, lender.id, borrower.id, facility.currencyId, draw, "SOVEREIGN_LOAN", `Суверенная кредитная линия ${facility.id}`);
  if (!transactionId) return null;
  const assetId = `sovereign-lending-asset:${lender.id}:${facility.id}`;
  const liabilityId = `sovereign-lending-liability:${borrower.id}:${facility.id}`;
  ensureAccount(world.ledger, assetId, lender.id, `Суверенное требование · ${facility.borrowerCountryId}`, "asset", facility.currencyId);
  ensureAccount(world.ledger, liabilityId, borrower.id, `Суверенное обязательство · ${facility.lenderCountryId}`, "liability", facility.currencyId);
  const recognitionId = postTransaction(world, "SOVEREIGN_LOAN", `Признание суверенной кредитной линии ${facility.id}`, [{ accountId: assetId, side: "debit", amountCents: draw }, { accountId: liabilityId, side: "credit", amountCents: draw }], [transactionId]);
  facility.drawnMinor += draw; facility.transactionIds.push(transactionId, recognitionId);
  const usd = convertMinor(world, draw, facility.currencyId, "USD") ?? 0;
  recordBilateralExternalFlow(world, facility.lenderCountryId, facility.borrowerCountryId, "crossBorderLoanAssetsMinor", "crossBorderLoanLiabilitiesMinor", usd);
  recordExternalFlow(world, facility.lenderCountryId, "bankFlowsMinor", usd);
  recordExternalFlow(world, facility.borrowerCountryId, "bankFlowsMinor", -usd);
  return transactionId;
}

function runIndustrialPolicy(world: WorldState): void {
  if (world.clock.elapsedMonths % 12 !== 0) return;
  for (const program of world.geoeconomics.industrialPolicyPrograms.filter((item) => item.status === "active" && item.startsAtMonth <= world.clock.elapsedMonths && (item.endsAtMonth === null || item.endsAtMonth >= world.clock.elapsedMonths))) {
    const government = world.governments.find((item) => item.countryId === program.countryId);
    const company = world.companies.find((item) => item.id === program.beneficiaryCompanyId && item.active);
    if (!government || !company || government.currencyId !== currencyOf(world, company.headquartersCountryId)) continue;
    const account = currencyBankAccount(world, government.id, government.currencyId);
    const amount = account ? Math.min(program.monthlyBudgetMinor * 12, bankAccountBalance(world, account.id)) : 0;
    const tx = amount > 0 ? settleFinancialPayment(world, government.id, company.id, government.currencyId, amount, "SUBSIDY", `Промышленная политика: ${program.commodityId}`, [program.id]) : null;
    if (tx) program.transactionIds.push(tx);
  }
}

function autonomousDecisions(world: WorldState): void {
  if (world.clock.elapsedMonths === 0 || world.clock.elapsedMonths % 12 !== 0) return;
  for (const country of world.countries) {
    const incoming = world.geoeconomics.policies.find((policy) => policy.status === "active" && policy.targetCountryIds.includes(country.id) && (policy.kind === "tariff" || policy.kind === "sanction" || policy.kind === "financial-restriction"));
    if (incoming && !world.geoeconomics.policies.some((policy) => policy.retaliationOfId === incoming.id)) {
      adoptGeoeconomicPolicy(world, { actorCountryId: country.id, targetCountryIds: [incoming.actorCountryId], kind: incoming.kind === "financial-restriction" ? "financial-restriction" : "tariff", commodityIds: [...incoming.commodityIds], rateBps: Math.max(100, Math.round(incoming.rateBps * 0.75)), accessPenaltyBps: Math.max(500, Math.round(incoming.accessPenaltyBps * 0.6)), startsAtMonth: world.clock.elapsedMonths, endsAtMonth: world.clock.elapsedMonths + 24, retaliationOfId: incoming.id });
      continue;
    }
    const dependency = world.geoeconomics.directionalDependencies.filter((item) => item.sourceCountryId === country.id).sort((a, b) => b.strategicDependencyBps - a.strategicDependencyBps)[0];
    if (!dependency || dependency.strategicDependencyBps < 1_500) {
      trace(world, country.id, "strategic-review", dependency ? [dependency.targetCountryId] : [], { dependencyBps: dependency?.strategicDependencyBps ?? 0 }, ["Ограничение не улучшит устойчивость"], dependency ? [`dependency:${country.id}:${dependency.targetCountryId}`] : [], "rejected");
      continue;
    }
    const company = world.companies.find((item) => item.headquartersCountryId === country.id && item.active);
    if (company && !world.geoeconomics.industrialPolicyPrograms.some((item) => item.countryId === country.id && item.status === "active")) {
      const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id);
      const program = { id: `industrial-policy-${String(world.geoeconomics.nextProgramId++).padStart(6, "0")}`, countryId: country.id, beneficiaryCompanyId: company.id, commodityId: company.goodId, monthlyBudgetMinor: Math.max(1_000, Math.round((profile?.baselineNominalGdpMinor ?? 1_000_000) / 120_000)), startsAtMonth: world.clock.elapsedMonths, endsAtMonth: world.clock.elapsedMonths + 36, status: "active" as const, transactionIds: [] };
      world.geoeconomics.industrialPolicyPrograms.push(program);
      trace(world, country.id, "industrial-policy", [dependency.targetCountryId], { dependencyBps: dependency.strategicDependencyBps, monthlyBudgetMinor: program.monthlyBudgetMinor }, ["Снижение направленной зависимости"], [`dependency:${country.id}:${dependency.targetCountryId}`], "adopted");
    }
  }
}

export function runGeoeconomicMonth(world: WorldState): void {
  world.geoeconomics ??= createGeoeconomicsState();
  seedGeoeconomics(world);
  for (const policy of world.geoeconomics.policies) if (policy.status === "active" && policy.endsAtMonth !== null && policy.endsAtMonth < world.clock.elapsedMonths) {
    policy.status = "expired";
    trace(world, policy.actorCountryId, policy.kind, policy.targetCountryIds, {}, ["Срок действия завершён"], [policy.id], "expired");
  }
  if (world.clock.elapsedMonths % 3 === 0) refreshStrategicInterests(world);
  autonomousDecisions(world);
  runIndustrialPolicy(world);
}
