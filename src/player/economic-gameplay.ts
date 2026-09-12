import { capitalContribution, depositOf, openBankAccount } from "../core/ledger.ts";
import type { Company, Fund, WorldState } from "../domain/model.ts";
import { compareCorporateLoanOffers } from "../banking/alm-engine.ts";
import { issueLoan } from "../finance/credit.ts";
import { createIPOProcess, proposeMAndA } from "../corporate-finance/transactions.ts";
import { companyValuation } from "../corporate/finance.ts";
import { callCapital, evaluatePeExit, executeLbo, initializePrivateEquityFund, sourcePrivateEquityTarget } from "../private-equity/engine.ts";
import { submitBid } from "../markets/auction-engine/index.ts";
import { issueInsurancePolicy, payInsuranceClaim, quoteInsuranceMarket, reportInsuranceClaim } from "../insurance/engine.ts";

export function incorporatePlayerCompany(world: WorldState, cityId: string, goodId: string, name: string, initialCapitalMinor: number): Company | null {
  const founder = world.households.find((item) => item.id === world.player.householdId);
  const city = world.cities.find((item) => item.id === cityId);
  const good = world.goods.find((item) => item.id === goodId);
  const template = world.companies.find((item) => item.goodId === goodId) ?? world.companies[0];
  if (!founder || !city || !good || !template || initialCapitalMinor < 100_000) return null;
  const currencyId = world.countries.find((country) => country.id === city.countryId)?.currencyReference;
  const bank = world.banks.find((item) => item.countryId === city.countryId && item.baseCurrency === currencyId);
  if (!bank) return null;

  const id = `company-${String(world.nextCompanyId++).padStart(3, "0")}`;
  const securityId = `security-${id}`;
  const boardId = `board-${id}`;
  const capacity = Math.max(10_000, Math.round(initialCapitalMinor / Math.max(1, good.basePriceCents) * 1_000));
  const emptyInputs = Object.fromEntries(world.goods.map((item) => [item.id, 0]));
  // Only structural/industry parameters are inherited from the template. No live
  // inventory, financial history, accumulated goodwill or other operating state
  // is cloned into a newly incorporated company.
  const company: Company = {
    id, name: name.trim() || `Компания игрока ${world.nextCompanyId}`, goodId, ownerHouseholdId: founder.id, bankId: bank.id, active: true,
    employees: [], wageCents: template.wageCents, priceCents: good.basePriceCents, capacityMilliUnits: capacity, productivityBps: template.productivityBps,
    inventoryMilliUnits: 0, inventoryValueCents: 0, inputInventoryMilliUnits: { ...emptyInputs }, inputInventoryValueCents: { ...emptyInputs },
    productiveCapital: { acquisitionCostCents: initialCapitalMinor, bookValueCents: initialCapitalMinor, accumulatedDepreciationCents: 0, usefulLifeMonths: 180, capacityMilliUnits: capacity },
    retainedEarningsCents: 0, financialReports: [], lastProductionMilliUnits: 0, lastSalesMilliUnits: 0, lastGrossRevenueCents: 0, lastOperatingExpenseCents: 0, lastCogsCents: 0,
    lastIntermediateConsumptionCents: 0, lastIntermediateConsumptionBaseCents: 0, lastWagesCents: 0, lastDepreciationCents: 0, lastInterestCents: 0, lastTaxCents: 0, lastCapitalInvestmentCents: 0, lastHouseholdSalesCents: 0, lastGovernmentSalesCents: 0,
    distressMonths: 0, missedPayrollMonths: 0, foundedAtMonth: world.clock.elapsedMonths, closedAtMonth: null, closureReason: null, cityId, productId: template.productId,
    technologyBps: template.technologyBps, managementBps: template.managementBps, learningByDoingBps: 0, qualityBps: template.qualityBps, brandReputationBps: Math.min(template.brandReputationBps, 2_500),
    marketShareBps: 0, marginalCostCents: Math.max(1, Math.round(good.basePriceCents * 0.65)), capacityUtilizationBps: 0, occupationFamilyNeeds: structuredClone(template.occupationFamilyNeeds),
    headquartersCountryId: city.countryId, headquartersCityId: cityId, industry: good.name, representationTier: "C", sizeClass: "small", corporateStatus: "private",
    equitySecurityId: securityId, boardId, parentCompanyId: null, subsidiaryIds: [], goodwillCents: 0, globalInputConstraintBps: 10_000, baselineFinancials: null,
  };
  world.companies.push(company);
  openBankAccount(world, company.id, bank.id, true);
  const tx = capitalContribution(world, founder.id, company.id, initialCapitalMinor);
  if (!tx) { world.companies.pop(); return null; }
  world.equitySecurities.push({ id: securityId, companyId: company.id, className: "Обыкновенные акции", currencyId: bank.baseCurrency, sharesOutstanding: 100_000, votesPerShare: 1, status: "private" });
  world.equityHoldings.push({ id: `holding-${world.nextHoldingId++}`, securityId, ownerId: founder.id, shares: 100_000, costBasisCents: initialCapitalMinor, dividendsReceivedCents: 0 });
  world.corporateBoards.push({ id: boardId, companyId: company.id, directorOwnerIds: [founder.id], approvalThresholdBps: 5_001 });
  founder.foundedCompanyIds.push(company.id);
  world.countries.find((country) => country.id === city.countryId)?.companyIds.push(company.id);
  return company;
}

export function financePlayerCompany(world: WorldState, companyId: string, amountMinor: number) { const company = world.companies.find((item) => item.id === companyId && item.ownerHouseholdId === world.player.householdId); if (!company) return null; const offer = compareCorporateLoanOffers(world, company.id, amountMinor); return offer ? issueLoan(world, offer.bankId, company.id, offer.amountMinor, offer.termMonths, offer.expectedLossBps) : null; }
export function initiatePlayerIPO(world: WorldState, companyId: string) { const company = world.companies.find((item) => item.id === companyId && item.ownerHouseholdId === world.player.householdId); const security = company && world.equitySecurities.find((item) => item.id === company.equitySecurityId); return company && security ? createIPOProcess(world, company.id, Math.round(security.sharesOutstanding * 0.2), Math.round(security.sharesOutstanding * 0.05)) : null; }
export function initiatePlayerAcquisition(world: WorldState, buyerCompanyId: string, targetCompanyId: string) { const buyer = world.companies.find((item) => item.id === buyerCompanyId && item.ownerHouseholdId === world.player.householdId); return buyer ? proposeMAndA(world, buyer.id, targetCompanyId, "friendly", "cash") : null; }
export function createPlayerPeFund(world: WorldState, targetSizeMinor: number): Fund | null { const household = world.households.find((item) => item.id === world.player.householdId); if (!household || targetSizeMinor < 1_000_000) return null; const bank = world.banks.find((item) => item.id === household.bankId)!; const suffix = `${world.clock.elapsedMonths}-${world.privateEquityFunds.length + 1}`; const managerId = `player-gp-${suffix}`; const fundId = `player-pe-${suffix}`; openBankAccount(world, managerId, bank.id, true); openBankAccount(world, fundId, bank.id, true); const managerAccount = world.bankAccounts.find((item) => item.ownerId === managerId)!; const fundAccount = world.bankAccounts.find((item) => item.ownerId === fundId)!; world.assetManagers.push({ id: managerId, name: "Управляющая компания игрока", countryId: bank.countryId, ownerId: household.id, bankAccountId: managerAccount.id, fundIds: [fundId], employeeCount: 1, revenueMinor: 0, expensesMinor: 0 }); const fund: Fund = { id: fundId, name: "Фонд прямых инвестиций игрока", type: "private-capital", managerId, currencyId: bank.baseCurrency, bankAccountId: fundAccount.id, unitSecurityId: null, unitsOutstandingMicros: 0, navMinor: 0, highWaterMarkMinorPerUnit: 100_000, managementFeeBps: 200, performanceFeeBps: 2_000, mandate: { assetClasses: ["private-equity", "cash"], countryIds: [bank.countryId], benchmarkIndexId: null, cashBufferBps: 500, maxPositionBps: 5_000, riskTargetBps: 7_000 }, strategyProfileId: "ACTIVE_LONG_ONLY", primeBrokerIds: [bank.id], status: "active" }; world.funds.push(fund); initializePrivateEquityFund(world, fund.id, managerId, [{ lpId: household.id, committedMinor: targetSizeMinor }]); return fund; }

function playerPeFund(world: WorldState, fundId: string): Fund | null {
  const fund = world.funds.find((item) => item.id === fundId && item.type === "private-capital");
  const manager = fund && world.assetManagers.find((item) => item.id === fund.managerId && item.ownerId === world.player.householdId);
  return fund && manager ? fund : null;
}

export function callPlayerPeCapital(world: WorldState, fundId: string, amountMinor: number): number {
  return playerPeFund(world, fundId) ? callCapital(world, fundId, amountMinor) : 0;
}

export function sourceAndStartPlayerPeDeal(world: WorldState, fundId: string) {
  if (!playerPeFund(world, fundId)) return null;
  const targetCompanyId = sourcePrivateEquityTarget(world, fundId);
  const value = targetCompanyId ? companyValuation(world, targetCompanyId).equityValueCents : 0;
  return targetCompanyId && value > 0 ? executeLbo(world, fundId, targetCompanyId, value) : null;
}

export function startPlayerPeExit(world: WorldState, dealId: string) {
  const deal = world.privateEquityDeals.find((item) => item.id === dealId);
  return deal && playerPeFund(world, deal.fundId) ? evaluatePeExit(world, deal.id) : null;
}

export function buyPlayerInsurance(world: WorldState) {
  const policyholderId = world.player.householdId;
  if (world.insurancePolicies.some((item) => item.policyholderId === policyholderId && item.status === "active")) return null;
  const insuredValueMinor = Math.max(100_000, Math.floor(depositOf(world, policyholderId) / 2));
  const input = { policyholderId, line: "property" as const, insuredValueMinor, deductibleMinor: Math.round(insuredValueMinor * 0.02), limitMinor: Math.round(insuredValueMinor * 0.7), expectedFrequencyBps: 120, expectedSeverityBps: 2_000, securityPostureBps: 7_000 };
  const quote = quoteInsuranceMarket(world, input)[0];
  return quote ? issueInsurancePolicy(world, { ...input, insurerId: quote.insurerId }) : null;
}

export function filePlayerInsuranceClaim(world: WorldState, policyId: string) {
  const policy = world.insurancePolicies.find((item) => item.id === policyId && item.policyholderId === world.player.householdId && item.status === "active");
  if (!policy) return null;
  const loss = world.insuranceLossEvents.find((item) => item.ownerId === policy.policyholderId && item.line === policy.line && !item.claimedByPolicyId && item.occurredAtMonth >= policy.inceptionMonth && item.occurredAtMonth < policy.expiryMonth);
  if (!loss) return null;
  const claim = reportInsuranceClaim(world, policy.id, loss.id);
  if (claim) payInsuranceClaim(world, claim.id);
  return claim;
}
export function bidPlayerAuction(world: WorldState, auctionId: string, priceMinor: number, quantity: number) { return submitBid(world, auctionId, world.player.householdId, priceMinor, quantity); }
