import { accountIds, bankAccountBalance, bankAccountsForOwner, ensureAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";
import type { InsuranceClaim, InsuranceLossEvent, InsurancePolicy, WorldState } from "../domain/model.ts";
import { openBrokerageAccount, placeOrder } from "../markets/exchange.ts";

interface ClaimableLossIndex {
  source: WorldState["insuranceLossEvents"];
  sourceLength: number;
  losses: WorldState["insuranceLossEvents"];
}

const claimableLossIndexes = new WeakMap<WorldState, ClaimableLossIndex>();

function claimableLosses(world: WorldState): WorldState["insuranceLossEvents"] {
  let index = claimableLossIndexes.get(world);
  if (!index || index.source !== world.insuranceLossEvents || index.sourceLength !== world.insuranceLossEvents.length) {
    index = { source: world.insuranceLossEvents, sourceLength: world.insuranceLossEvents.length, losses: world.insuranceLossEvents.filter((loss) => !loss.claimedByPolicyId) };
    claimableLossIndexes.set(world, index);
  } else if (index.losses.some((loss) => loss.claimedByPolicyId)) {
    index.losses = index.losses.filter((loss) => !loss.claimedByPolicyId);
  }
  return index.losses;
}

function recognizeInsuranceFlow(world: WorldState, payerId: string, recipientId: string, currencyId: string, amountMinor: number, kind: "INSURANCE_PREMIUM" | "INSURANCE_CLAIM", cashTransactionId: string, memo: string): string {
  const baseExpense = accountIds.operatingExpense(payerId);
  const baseIncome = accountIds.operatingIncome(recipientId);
  const expense = world.ledger.accounts[baseExpense]?.currency === currencyId || !world.ledger.accounts[baseExpense] ? baseExpense : `${baseExpense}:${currencyId}`;
  const income = world.ledger.accounts[baseIncome]?.currency === currencyId || !world.ledger.accounts[baseIncome] ? baseIncome : `${baseIncome}:${currencyId}`;
  ensureAccount(world.ledger, expense, payerId, `Страховой расход · ${currencyId}`, "expense", currencyId);
  ensureAccount(world.ledger, income, recipientId, `Страховой доход · ${currencyId}`, "income", currencyId);
  return postTransaction(world, kind, memo, [{ accountId: expense, side: "debit", amountCents: amountMinor }, { accountId: income, side: "credit", amountCents: amountMinor }], [cashTransactionId]);
}

export function quoteAnnualPremium(policy: Pick<InsurancePolicy, "insuredValueMinor" | "expectedFrequencyBps" | "expectedSeverityBps" | "line" | "securityPostureBps">): number {
  const expectedLoss = policy.insuredValueMinor * policy.expectedFrequencyBps / 10_000 * policy.expectedSeverityBps / 10_000;
  const cyberRisk = policy.line === "cyber" ? Math.max(0.7, 1.6 - policy.securityPostureBps / 10_000) : 1;
  return Math.max(1, Math.round(expectedLoss * cyberRisk * 1.35));
}

export function issueInsurancePolicy(world: WorldState, input: Omit<InsurancePolicy, "id" | "annualPremiumMinor" | "status" | "inceptionMonth" | "expiryMonth">): InsurancePolicy | null {
  const insurer = world.insurers.find((item) => item.id === input.insurerId);
  if (!insurer) return null;
  const annualPremiumMinor = quoteAnnualPremium(input);
  const payer = bankAccountsForOwner(world, input.policyholderId, insurer.currencyId)[0];
  if (!payer || bankAccountBalance(world, payer.id) < annualPremiumMinor) return null;
  const tx = transferBankAccountBalance(world, payer.id, insurer.bankAccountId, annualPremiumMinor, "INSURANCE_PREMIUM", `Страховая премия ${input.line}`);
  if (!tx) return null;
  recognizeInsuranceFlow(world, input.policyholderId, insurer.id, insurer.currencyId, annualPremiumMinor, "INSURANCE_PREMIUM", tx, `Признание страховой премии ${input.line}`);
  const policy: InsurancePolicy = { ...input, id: `policy-${world.insurancePolicies.length + 1}`, annualPremiumMinor, status: "active", inceptionMonth: world.clock.elapsedMonths, expiryMonth: world.clock.elapsedMonths + 12 };
  world.insurancePolicies.push(policy);
  insurer.premiumIncomeMinor += annualPremiumMinor;
  insurer.reservesMinor += Math.round(annualPremiumMinor * 0.65);
  return policy;
}

export function recordInsuranceLossEvent(world: WorldState, input: Omit<InsuranceLossEvent, "id" | "occurredAtMonth" | "claimedByPolicyId" | "claimedAmountMinor"> & { occurredAtMonth?: number }): InsuranceLossEvent | null {
  const economicLossMinor = Math.max(0, Math.floor(input.economicLossMinor));
  if (!input.ownerId || economicLossMinor <= 0) return null;
  const event: InsuranceLossEvent = {
    id: `insurance-loss-${world.insuranceLossEvents.length + 1}`,
    ownerId: input.ownerId,
    assetId: input.assetId,
    line: input.line,
    category: input.category,
    sourceSystem: input.sourceSystem,
    economicLossMinor,
    claimedAmountMinor: 0,
    occurredAtMonth: input.occurredAtMonth ?? world.clock.elapsedMonths,
    description: input.description,
    causeIds: [...input.causeIds],
    claimedByPolicyId: null,
  };
  world.insuranceLossEvents.push(event);
  return event;
}

export function reportInsuranceClaim(world: WorldState, policyId: string, lossEventId: string): InsuranceClaim | null {
  const policy = world.insurancePolicies.find((item) => item.id === policyId && item.status === "active");
  const loss = world.insuranceLossEvents.find((item) => item.id === lossEventId && item.ownerId === policy?.policyholderId);
  if (!policy || !loss || loss.claimedByPolicyId || loss.line !== policy.line || loss.occurredAtMonth < policy.inceptionMonth || loss.occurredAtMonth >= policy.expiryMonth) return null;
  const remainingEconomicLoss = Math.max(0, loss.economicLossMinor - loss.claimedAmountMinor);
  if (remainingEconomicLoss <= policy.deductibleMinor) return null;
  const priorPolicyPayments = world.insuranceClaims.filter((item) => item.policyId === policy.id && item.status === "paid").reduce((sum, item) => sum + item.paidMinor, 0);
  const covered = Math.min(Math.max(0, policy.limitMinor - priorPolicyPayments), remainingEconomicLoss - policy.deductibleMinor);
  if (covered <= 0) return null;
  const claim: InsuranceClaim = {
    id: `claim-${world.insuranceClaims.length + 1}`,
    policyId,
    lossEventId: loss.id,
    economicLossMinor: loss.economicLossMinor,
    reservedMinor: covered,
    paidMinor: 0,
    status: "reserved",
    reportedAtMonth: world.clock.elapsedMonths,
    transactionIds: [...loss.causeIds],
  };
  world.insuranceClaims.push(claim);
  loss.claimedByPolicyId = policy.id;
  loss.claimedAmountMinor += covered;
  world.insurers.find((item) => item.id === policy.insurerId)!.reservesMinor += covered;
  return claim;
}

function liquidateInsurerAssets(world: WorldState, insurerId: string): void {
  const insurer = world.insurers.find((item) => item.id === insurerId);
  if (!insurer) return;
  openBrokerageAccount(world, insurer.id);
  const brokerage = world.brokerageAccounts.find((item) => item.ownerId === insurer.id && item.status === "active");
  if (!brokerage) return;
  for (const holding of world.equityHoldings.filter((item) => item.ownerId === insurer.id && item.shares > 0)) {
    const listing = world.listings.find((item) => item.securityId === holding.securityId && item.currencyId === insurer.currencyId);
    if (listing) placeOrder(world, brokerage.id, holding.securityId, "sell", "market", holding.shares, null, listing.exchangeId);
  }
}

export function payInsuranceClaim(world: WorldState, claimId: string): boolean {
  const claim = world.insuranceClaims.find((item) => item.id === claimId && item.status === "reserved");
  const policy = claim && world.insurancePolicies.find((item) => item.id === claim.policyId);
  const insurer = policy && world.insurers.find((item) => item.id === policy.insurerId);
  if (!claim || !policy || !insurer) return false;
  const target = bankAccountsForOwner(world, policy.policyholderId, insurer.currencyId)[0];
  if (!target) return false;
  const gross = claim.reservedMinor;
  const treaty = world.reinsuranceTreaties.find((item) => item.cedentId === insurer.id && item.status === "active");
  if (treaty && gross > treaty.attachmentMinor) {
    const recovery = Math.min(treaty.limitMinor, gross - treaty.attachmentMinor);
    const reinsurer = world.insurers.find((item) => item.id === treaty.reinsurerId);
    if (reinsurer) {
      const tx = transferBankAccountBalance(world, reinsurer.bankAccountId, insurer.bankAccountId, recovery, "INSURANCE_CLAIM", `Возмещение перестраховщика ${claim.id}`);
      if (tx) {
        claim.transactionIds.push(tx, recognizeInsuranceFlow(world, reinsurer.id, insurer.id, insurer.currencyId, recovery, "INSURANCE_CLAIM", tx, `Признание возмещения ${claim.id}`));
        insurer.reinsuranceRecoverableMinor += recovery;
        reinsurer.claimsPaidMinor += recovery;
      }
    }
  }
  if (bankAccountBalance(world, insurer.bankAccountId) < gross) liquidateInsurerAssets(world, insurer.id);
  if (bankAccountBalance(world, insurer.bankAccountId) < gross) return false;
  const tx = transferBankAccountBalance(world, insurer.bankAccountId, target.id, gross, "INSURANCE_CLAIM", `Страховая выплата ${claim.id}`, [claim.lossEventId]);
  if (!tx) return false;
  claim.transactionIds.push(tx, recognizeInsuranceFlow(world, insurer.id, policy.policyholderId, insurer.currencyId, gross, "INSURANCE_CLAIM", tx, `Признание страховой выплаты ${claim.id}`));
  claim.paidMinor = gross;
  claim.status = "paid";
  insurer.claimsPaidMinor += gross;
  insurer.reservesMinor = Math.max(0, insurer.reservesMinor - gross);
  return true;
}

export function quoteInsuranceMarket(world: WorldState, input: Omit<InsurancePolicy, "id" | "insurerId" | "annualPremiumMinor" | "status" | "inceptionMonth" | "expiryMonth">): Array<{ insurerId: string; premiumMinor: number }> {
  const company = world.companies.find((item) => item.id === input.policyholderId);
  const household = world.households.find((item) => item.id === input.policyholderId);
  const countryId = company?.headquartersCountryId ?? world.cities.find((city) => city.id === household?.cityId)?.countryId;
  return world.insurers.filter((item) => item.countryId === countryId).map((insurer) => ({ insurerId: insurer.id, premiumMinor: Math.round(quoteAnnualPremium(input) * (1 + Math.max(0, insurer.reservesMinor - insurer.capitalMinor) / Math.max(1, insurer.capitalMinor))) })).sort((a, b) => a.premiumMinor - b.premiumMinor);
}

export function runAutonomousInsuranceDemand(world: WorldState): void {
  if (world.clock.elapsedMonths % 3 !== 0) return;
  for (const company of world.companies.filter((item) => item.active && !world.insurancePolicies.some((policy) => policy.policyholderId === item.id && policy.status === "active"))) {
    const insuredValueMinor = Math.max(1, company.productiveCapital.bookValueCents + company.inventoryValueCents);
    const input = { policyholderId: company.id, line: "corporate" as const, insuredValueMinor, deductibleMinor: Math.round(insuredValueMinor * 0.02), limitMinor: Math.round(insuredValueMinor * 0.7), expectedFrequencyBps: 180 + company.distressMonths * 20, expectedSeverityBps: 1_500, securityPostureBps: 7_000 };
    const quote = quoteInsuranceMarket(world, input)[0];
    if (quote && quote.premiumMinor < insuredValueMinor * 300 / 10_000) issueInsurancePolicy(world, { ...input, insurerId: quote.insurerId });
  }
}

function runAutonomousInsuranceClaims(world: WorldState): void {
  for (const loss of claimableLosses(world)) {
    const policy = world.insurancePolicies.find((item) => item.policyholderId === loss.ownerId && item.line === loss.line && item.status === "active" && item.inceptionMonth <= loss.occurredAtMonth && item.expiryMonth > loss.occurredAtMonth);
    if (!policy) continue;
    const claim = reportInsuranceClaim(world, policy.id, loss.id);
    if (claim) payInsuranceClaim(world, claim.id);
  }
}

export function runInsuranceMonth(world: WorldState): void {
  for (const policy of world.insurancePolicies) if (policy.status === "active" && policy.expiryMonth <= world.clock.elapsedMonths) policy.status = "expired";
  runAutonomousInsuranceDemand(world);
  runAutonomousInsuranceClaims(world);
  for (const insurer of world.insurers) {
    const sovereign = world.sovereignBondHoldings.filter((holding) => holding.holderId === insurer.id).reduce((sum, holding) => sum + holding.bookValueMinor, 0);
    const corporate = world.bondHoldings.filter((holding) => holding.holderId === insurer.id).reduce((sum, holding) => sum + holding.costBasisCents, 0);
    insurer.investmentAssetsMinor = sovereign + corporate + world.equityHoldings.filter((holding) => holding.ownerId === insurer.id).reduce((sum, holding) => sum + holding.costBasisCents, 0);
  }
}
