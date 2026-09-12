import { bankAccountBalance, depositOf, transferDeposit } from "../core/ledger.ts";
import type { PoliticalEconomyDecisionTrace, WorldState } from "../domain/model.ts";
import { currencyBankAccount, settleFinancialPayment } from "../finance/financial-settlement.ts";
import { issueLoan } from "../finance/credit.ts";
import { createPoliticalEconomyState, seedPoliticalEconomy } from "./state.ts";

const clamp = (value: number, low = 0, high = 10_000): number => Math.max(low, Math.min(high, Math.round(value)));

function addTrace(world: WorldState, input: Omit<PoliticalEconomyDecisionTrace, "id" | "elapsedMonth">): void {
  world.politicalEconomy.decisionTraces.push({ ...input, id: `political-trace-${String(world.politicalEconomy.nextDecisionTraceId++).padStart(7, "0")}`, elapsedMonth: world.clock.elapsedMonths });
  if (world.politicalEconomy.decisionTraces.length > 120) world.politicalEconomy.decisionTraces.splice(0, world.politicalEconomy.decisionTraces.length - 120);
}

export function refreshPoliticalEconomyAccounts(world: WorldState): void {
  for (const country of world.countries) {
    const institutions = world.politicalEconomy.institutions.filter((item) => item.countryId === country.id);
    const compliance = world.politicalEconomy.compliance.find((item) => item.countryId === country.id)!;
    const averageCapacity = institutions.reduce((sum, item) => sum + item.capacityBps, 0) / Math.max(1, institutions.length);
    const integrity = institutions.reduce((sum, item) => sum + item.integrityBps, 0) / Math.max(1, institutions.length);
    const network = world.politicalEconomy.corruptionNetworks.find((item) => item.countryId === country.id);
    const budget = world.governmentBudgets.find((item) => item.countryId === country.id);
    const politicalRiskBps = clamp(10_000 - integrity + (network?.captureBps ?? 0) / 2);
    const capacity = { countryId: country.id, administrativeCapacityBps: clamp(averageCapacity), fiscalCapacityBps: clamp(compliance.taxComplianceBps * 0.65 + averageCapacity * 0.35), enforcementCapacityBps: clamp(compliance.financialComplianceBps * 0.5 + integrity * 0.5), procurementCapacityBps: clamp((institutions.find((item) => item.type === "procurement-authority")?.capacityBps ?? averageCapacity) - (network?.captureBps ?? 0) / 3), policyCredibilityBps: clamp(averageCapacity * 0.55 + integrity * 0.45), politicalRiskBps, updatedAtMonth: world.clock.elapsedMonths };
    const previous = world.politicalEconomy.stateCapacity.findIndex((item) => item.countryId === country.id);
    if (previous >= 0) world.politicalEconomy.stateCapacity[previous] = capacity; else world.politicalEconomy.stateCapacity.push(capacity);
    compliance.taxComplianceBps = clamp(capacity.fiscalCapacityBps * 0.75 + compliance.beneficialOwnershipTransparencyBps * 0.25, 3_000, 9_800);
    compliance.updatedAtMonth = world.clock.elapsedMonths;
    if (budget) budget.effectiveTaxCollectionBps = compliance.taxComplianceBps;
    const period = world.countryEconomicAccounts.closedByCountry[country.id];
    const officialOutputMinor = period?.production.valueAddedMinor ?? 0;
    const estimatedHiddenOutputMinor = Math.round(officialOutputMinor * (10_000 - compliance.taxComplianceBps) / Math.max(1, compliance.taxComplianceBps));
    const payer = world.populationCohorts.find((item) => item.countryId === country.id);
    const worker = world.populationCohorts.find((item) => item.countryId === country.id && item.id !== payer?.id) ?? payer;
    const supplier = world.firmCohorts.find((item) => item.countryId === country.id);
    const resourceCapacity = supplier ? Math.max(1, Math.round(supplier.capitalCents / 120 + supplier.employment * supplier.productivityBps)) : 0;
    const monthlyInformalSales = payer && worker && supplier ? Math.min(estimatedHiddenOutputMinor, Math.round(officialOutputMinor * 800 / 10_000), resourceCapacity) : 0;
    const sale = world.clock.elapsedMonths % 3 === 0 && payer ? Math.min(monthlyInformalSales * 3, depositOf(world, payer.id)) : 0;
    // Aggregate self-employment: one payment is both a household purchase and
    // the informal producer's mixed cash income.
    const saleTx = sale > 0 && payer && worker ? transferDeposit(world, payer.id, worker.id, sale, "COHORT_CONSUMPTION", `Неформальные товары и услуги · ${country.id}`) : null;
    const hiddenOutputMinor = Math.round(monthlyInformalSales * 6_500 / 10_000);
    const intermediateInputsMinor = monthlyInformalSales - hiddenOutputMinor;
    const informalValueAddedMinor = hiddenOutputMinor;
    const informalWagesMinor = Math.round(informalValueAddedMinor * 7_000 / 10_000);
    const undeclaredProfitMinor = informalValueAddedMinor - informalWagesMinor;
    const officialEmployment = (period?.labour.explicitEmployment ?? 0) + (period?.labour.cohortEmployment ?? 0);
    const informalEmployment = Math.round(officialEmployment * (10_000 - compliance.labourComplianceBps) / Math.max(1, compliance.labourComplianceBps));
    const assessedTaxMinor = period ? period.fiscal.personalTaxMinor + period.fiscal.corporateTaxMinor + period.fiscal.consumptionTaxMinor + period.fiscal.propertyOtherTaxMinor : 0;
    const collectedTaxMinor = Math.round(assessedTaxMinor * compliance.taxComplianceBps / 10_000);
    world.politicalEconomy.shadowEconomy.push({ countryId: country.id, elapsedMonth: world.clock.elapsedMonths, trueOutputMinor: officialOutputMinor + informalValueAddedMinor, officialOutputMinor, hiddenOutputMinor: informalValueAddedMinor, trueEmployment: officialEmployment + informalEmployment, officialEmployment, informalEmployment, assessedTaxMinor, collectedTaxMinor, taxGapMinor: Math.max(0, assessedTaxMinor - collectedTaxMinor), intermediateInputsMinor, informalWagesMinor, undeclaredProfitMinor, informalConsumptionMinor: monthlyInformalSales, transactionIds: [saleTx].filter((item): item is string => Boolean(item)) });
  }
  const cutoff = world.clock.elapsedMonths - 12;
  world.politicalEconomy.shadowEconomy = world.politicalEconomy.shadowEconomy.filter((item) => item.elapsedMonth >= cutoff);
}

export function executeProcurement(world: WorldState, countryId: string, grossAmountMinor: number, forcedLeakageBps?: number) {
  const government = world.governments.find((item) => item.countryId === countryId);
  const supplier = world.companies.find((item) => item.headquartersCountryId === countryId && item.active);
  const network = world.politicalEconomy.corruptionNetworks.find((item) => item.countryId === countryId);
  const authority = world.politicalEconomy.institutions.find((item) => item.countryId === countryId && item.type === "procurement-authority");
  const account = government && currencyBankAccount(world, government.id, government.currencyId);
  if (!government || !supplier || !network || !authority || !account || grossAmountMinor <= 0) return null;
  const gross = Math.min(Math.floor(grossAmountMinor), bankAccountBalance(world, account.id));
  const leakageBps = clamp(forcedLeakageBps ?? Math.round(network.captureBps * (10_000 - authority.integrityBps) / 10_000), 0, 5_000);
  const leakageMinor = Math.round(gross * leakageBps / 10_000);
  const deliveredValueMinor = gross - leakageMinor;
  const contractId = `procurement-${String(world.politicalEconomy.nextProcurementId++).padStart(7, "0")}`;
  const deliveryTx = deliveredValueMinor > 0 ? settleFinancialPayment(world, government.id, supplier.id, government.currencyId, deliveredValueMinor, "PROCUREMENT", `Госзакупка ${contractId}`, [contractId]) : null;
  const leakageTx = leakageMinor > 0 ? settleFinancialPayment(world, government.id, network.id, government.currencyId, leakageMinor, "CORRUPTION_LEAKAGE", `Скрытая утечка ${contractId}`, [contractId]) : null;
  if (!deliveryTx || (leakageMinor > 0 && !leakageTx)) return null;
  supplier.lastGrossRevenueCents += deliveredValueMinor;
  supplier.lastGovernmentSalesCents += deliveredValueMinor;
  network.hiddenBalanceMinor += leakageMinor;
  network.transactionIds.push(...(leakageTx ? [leakageTx] : []));
  const contract = { id: contractId, countryId, authorityId: authority.id, supplierId: supplier.id, corruptionNetworkId: leakageMinor > 0 ? network.id : null, grossAmountMinor: gross, deliveredValueMinor, leakageMinor, elapsedMonth: world.clock.elapsedMonths, transactionIds: [deliveryTx, ...(leakageTx ? [leakageTx] : [])], status: "paid" as const };
  world.politicalEconomy.procurementContracts.push(contract);
  if (world.politicalEconomy.procurementContracts.length > 110) world.politicalEconomy.procurementContracts.splice(0, world.politicalEconomy.procurementContracts.length - 110);
  addTrace(world, { countryId, decision: "procurement-award", actorIds: [authority.id, supplier.id], inputs: { grossAmountMinor: gross, leakageBps }, reasons: [leakageMinor > 0 ? "Часть оплаты захвачена сетью" : "Контракт оплачен полностью"], transactionIds: contract.transactionIds, outcome: leakageMinor > 0 ? "paid-with-leakage" : "paid" });
  return contract;
}

function formPolicyCoalitions(world: WorldState): void {
  if (world.clock.elapsedMonths === 0 || world.clock.elapsedMonths % 12 !== 0) return;
  for (const country of world.countries) {
    const institutions = world.politicalEconomy.institutions.filter((item) => item.countryId === country.id);
    const groups = world.politicalEconomy.interestGroups.filter((item) => item.countryId === country.id);
    const topic = (world.clock.elapsedMonths / 12) % 2 === 0 ? "tax-compliance" as const : "procurement" as const;
    const proposalId = `proposal-${String(world.politicalEconomy.nextProposalId++).padStart(7, "0")}`;
    const supporters = groups.filter((item) => item.preferredPolicy === topic || item.type === "labour");
    const opponents = groups.filter((item) => !supporters.includes(item));
    const integrity = institutions.reduce((sum, item) => sum + item.integrityBps, 0) / Math.max(1, institutions.length);
    const lobbyingTransactions: string[] = [];
    const network = world.politicalEconomy.corruptionNetworks.find((item) => item.countryId === country.id)!;
    const regulator = institutions.find((item) => item.type === "regulator")!;
    for (const group of [...groups].sort((a, b) => b.influenceBps - a.influenceBps).slice(0, 1)) {
      const account = currencyBankAccount(world, group.id, world.countries.find((item) => item.id === country.id)!.currencyReference);
      const policyValue = world.countryScaleReconciliations.find((item) => item.countryId === country.id)?.targetMonthlyNominalGdpMinor ?? group.resourcesMinor;
      const desired = Math.min(Math.round(group.resourcesMinor * 8 / 10_000), Math.round(policyValue * group.influenceBps / 10_000 / 2_000));
      const payment = account ? Math.min(desired, bankAccountBalance(world, account.id)) : 0;
      const transparent = regulator.integrityBps >= 6_000;
      const recipientId = transparent ? regulator.id : network.id;
      const tx = payment > 0 ? settleFinancialPayment(world, group.id, recipientId, account!.currencyId, payment, "LOBBYING", `Лоббирование ${proposalId}`, [proposalId]) : null;
      if (tx) { lobbyingTransactions.push(tx); group.lobbyingTransactionIds.push(tx); if (!transparent) { network.transactionIds.push(tx); network.hiddenBalanceMinor += payment; regulator.integrityBps = clamp(regulator.integrityBps - Math.round(group.influenceBps / 100)); } }
    }
    const supportBps = clamp(4_500 + supporters.reduce((sum, item) => sum + item.influenceBps, 0) / Math.max(1, groups.length) - opponents.reduce((sum, item) => sum + item.influenceBps, 0) / Math.max(1, groups.length * 2) + integrity / 8);
    const coalitionId = `coalition-${String(world.politicalEconomy.nextCoalitionId++).padStart(7, "0")}`;
    world.politicalEconomy.coalitions.push({ id: coalitionId, countryId: country.id, proposalId, supporterIds: supporters.map((item) => item.id), opponentIds: opponents.map((item) => item.id), supportBps, formedAtMonth: world.clock.elapsedMonths });
    const adopted = supportBps >= 5_000;
    world.politicalEconomy.policyProposals.push({ id: proposalId, countryId: country.id, sponsorInstitutionId: institutions.find((item) => item.type === "executive")!.id, topic, proposedAtMonth: world.clock.elapsedMonths, supportBps, captureRiskBps: network.captureBps, status: adopted ? "adopted" : "rejected", coalitionId });
    if (adopted) {
      const compliance = world.politicalEconomy.compliance.find((item) => item.countryId === country.id)!;
      if (topic === "tax-compliance") compliance.taxComplianceBps = clamp(compliance.taxComplianceBps + 100);
      else { const authority = institutions.find((item) => item.type === "procurement-authority")!; authority.integrityBps = clamp(authority.integrityBps + 100); }
    }
    addTrace(world, { countryId: country.id, decision: `proposal:${topic}`, actorIds: [coalitionId, ...groups.map((item) => item.id)], inputs: { supportBps, captureRiskBps: network.captureBps }, reasons: [adopted ? "Коалиция набрала большинство" : "Поддержки недостаточно"], transactionIds: lobbyingTransactions, outcome: adopted ? "adopted" : "rejected" });
  }
  if (world.politicalEconomy.coalitions.length > 110) world.politicalEconomy.coalitions.splice(0, world.politicalEconomy.coalitions.length - 110);
  if (world.politicalEconomy.policyProposals.length > 110) world.politicalEconomy.policyProposals.splice(0, world.politicalEconomy.policyProposals.length - 110);
}

function updateZombieFirmsAndSupport(world: WorldState): void {
  for (const company of world.companies.filter((item) => item.active && item.distressMonths >= 2)) {
    let record = world.politicalEconomy.zombieFirms.find((item) => item.companyId === company.id);
    if (!record) { record = { companyId: company.id, countryId: company.headquartersCountryId, lossMonths: company.distressMonths, debtServiceCoverageBps: 0, supportDependencyBps: 0, recognizedAtMonth: world.clock.elapsedMonths, status: company.distressMonths >= 6 ? "zombie" : "watch" }; world.politicalEconomy.zombieFirms.push(record); }
    record.lossMonths = company.distressMonths; record.debtServiceCoverageBps = clamp(company.lastGrossRevenueCents * 10_000 / Math.max(1, company.lastOperatingExpenseCents + company.lastInterestCents)); record.status = company.distressMonths >= 6 ? "zombie" : "watch";
    const governance = world.politicalEconomy.soeGovernance.find((item) => item.companyId === company.id);
    const government = governance && world.governments.find((item) => item.countryId === governance.countryId);
    const account = government && currencyBankAccount(world, government.id, government.currencyId);
    if (governance && government && account && bankAccountBalance(world, account.id) > 0 && world.clock.elapsedMonths % 3 === 0) {
      const financingGap = Math.max(0, company.lastOperatingExpenseCents + company.lastInterestCents - company.lastGrossRevenueCents);
      const fiscalLimit = Math.round(bankAccountBalance(world, account.id) * 25 / 10_000);
      const amount = Math.min(Math.max(1, financingGap), fiscalLimit, bankAccountBalance(world, account.id));
      const tx = settleFinancialPayment(world, government.id, company.id, government.currencyId, amount, "SUBSIDY", `Поддержка SOE: ${company.name}`, [company.id]);
      if (tx) { governance.subsidyTransactionIds.push(tx); record.supportDependencyBps = clamp(record.supportDependencyBps + 500); }
    }
  }
}

function runConnectedLending(world: WorldState): void {
  if (world.clock.elapsedMonths === 0 || world.clock.elapsedMonths % 12 !== 0) return;
  for (const relation of world.politicalEconomy.connectedLending.filter((item) => item.status === "active" && item.connectionBps >= 2_500)) {
    const company = world.companies.find((item) => item.id === relation.borrowerCompanyId && item.active);
    if (!company || company.distressMonths < 2) continue;
    const bank = world.banks.find((item) => item.id === relation.bankId);
    const financingNeed = Math.max(company.lastOperatingExpenseCents * 3, company.lastGrossRevenueCents, 1);
    const prudentialLimit = Math.round((bank?.baselineFinancials?.capitalMinor ?? financingNeed) * 250 / 10_000);
    const amount = Math.max(1, Math.min(financingNeed, prudentialLimit));
    const loan = issueLoan(world, relation.bankId, company.id, amount, 24, Math.max(0, 400 - relation.preferentialSpreadBps), [relation.id]);
    if (loan) relation.loanIds.push(loan.id);
    addTrace(world, { countryId: relation.countryId, decision: "connected-lending", actorIds: [relation.bankId, relation.borrowerCompanyId], inputs: { connectionBps: relation.connectionBps, preferentialSpreadBps: relation.preferentialSpreadBps }, reasons: [loan ? "Кредит выдан связанному заёмщику" : "Балансовые ограничения банка не позволили выдать кредит"], transactionIds: loan ? [loan.id] : [], outcome: loan ? "issued" : "rejected-by-ledger-constraints" });
  }
}

export function runPoliticalEconomyMonth(world: WorldState): void {
  world.politicalEconomy ??= createPoliticalEconomyState();
  seedPoliticalEconomy(world);
  refreshPoliticalEconomyAccounts(world);
  formPolicyCoalitions(world);
  if (world.clock.elapsedMonths % 12 === 0) {
    for (const country of world.countries) {
      const government = world.governments.find((item) => item.countryId === country.id)!;
      const account = currencyBankAccount(world, government.id, government.currencyId);
      const monthlyGdp = world.countryScaleReconciliations.find((item) => item.countryId === country.id)?.targetMonthlyNominalGdpMinor ?? 0;
      const budget = account ? Math.min(Math.round(monthlyGdp * 8 / 10_000), Math.floor(bankAccountBalance(world, account.id) * 20 / 10_000)) : 0;
      if (budget > 0) executeProcurement(world, country.id, budget);
    }
  }
  if (world.clock.elapsedMonths % 3 === 0) updateZombieFirmsAndSupport(world);
  runConnectedLending(world);
}
