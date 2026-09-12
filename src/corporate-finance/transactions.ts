import { accountIds, bankAccountBalance, bankAccountsForOwner, ensureAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";
import { companyValuation, raiseEquity, transferShares } from "../corporate/finance.ts";
import type { IPOProcess, MAndADeal, WorldState } from "../domain/model.ts";
import { corporateCreditScore } from "../banking/alm-engine.ts";
import { conductDueDiligence, getBelief, recordDecisionTrace } from "../information/system.ts";

export function proposeMAndA(world: WorldState, buyerId: string, targetCompanyId: string, type: MAndADeal["type"], consideration: MAndADeal["consideration"], offerValueMinor?: number): MAndADeal | null {
  const target = world.companies.find((item) => item.id === targetCompanyId && item.active); if (!target || buyerId === targetCompanyId) return null; const valuation = companyValuation(world, targetCompanyId); const offer = offerValueMinor ?? Math.round(valuation.equityValueCents * 1.15);
  const deal: MAndADeal = { id: `ma-deal-${world.mAndADeals.length + 1}`, buyerId, targetCompanyId, type, consideration, offerPriceMinor: offer, premiumBps: Math.round((offer - valuation.equityValueCents) * 10_000 / Math.max(1, valuation.equityValueCents)), financingMinor: consideration === "stock" ? 0 : offer, status: "proposed", boardSupport: null, shareholderApprovalBps: 0, antitrustResult: "pending", dueDiligenceRiskBps: Math.max(0, 10_000 - corporateCreditScore(world, target)), competingBidIds: [], conditions: [], integrationProgressBps: 0, announcedAtMonth: world.clock.elapsedMonths, closedAtMonth: null, tenderElections: [] }; world.mAndADeals.push(deal); return deal;
}
export function solicitTenderElections(world: WorldState, dealId: string): number {
  const deal = world.mAndADeals.find((item) => item.id === dealId); const target = deal && world.companies.find((item) => item.id === deal.targetCompanyId); const security = target && world.equitySecurities.find((item) => item.id === target.equitySecurityId); if (!deal || !security) return 0; const perShare = deal.offerPriceMinor / Math.max(1, security.sharesOutstanding); const market = world.listings.find((item) => item.securityId === security.id)?.lastPriceCents ?? perShare;
  deal.tenderElections = world.equityHoldings.filter((item) => item.securityId === security.id && item.shares > 0).map((holding) => ({ holderId: holding.ownerId, shares: holding.shares, accepted: perShare >= market * 1.05 || Boolean(target?.distressMonths) })); return deal.tenderElections.filter((item) => item.accepted).reduce((sum, item) => sum + item.shares, 0);
}
export function submitCompetingBid(world: WorldState, existingDealId: string, buyerId: string, offerMinor: number): MAndADeal | null { const existing = world.mAndADeals.find((item) => item.id === existingDealId); if (!existing || offerMinor <= existing.offerPriceMinor || offerMinor > companyValuation(world, existing.targetCompanyId).equityValueCents * 1.5) return null; const bid = proposeMAndA(world, buyerId, existing.targetCompanyId, "friendly", existing.consideration, offerMinor); if (bid) { existing.competingBidIds.push(bid.id); bid.competingBidIds.push(existing.id); } return bid; }

function addHolding(world: WorldState, securityId: string, ownerId: string, shares: number, basis: number): void { let holding = world.equityHoldings.find((item) => item.securityId === securityId && item.ownerId === ownerId); if (!holding) { holding = { id: `holding-${world.nextHoldingId++}`, securityId, ownerId, shares: 0, costBasisCents: 0, dividendsReceivedCents: 0 }; world.equityHoldings.push(holding); } holding.shares += shares; holding.costBasisCents += basis; }
function settleStockExchange(world: WorldState, deal: MAndADeal, stockValue: number): boolean {
  const target = world.companies.find((item) => item.id === deal.targetCompanyId)!; const buyer = world.companies.find((item) => item.id === deal.buyerId); const targetSecurity = world.equitySecurities.find((item) => item.id === target.equitySecurityId); const buyerSecurity = buyer && world.equitySecurities.find((item) => item.id === buyer.equitySecurityId); if (!buyer || !targetSecurity || !buyerSecurity) return false;
  const accepted = deal.tenderElections.filter((item) => item.accepted); const buyerPrice = world.listings.find((item) => item.securityId === buyerSecurity.id)?.lastPriceCents ?? Math.max(1, Math.round(companyValuation(world, buyer.id).equityValueCents / Math.max(1, buyerSecurity.sharesOutstanding))); let transferred = 0;
  for (const election of accepted) { const source = world.equityHoldings.find((item) => item.securityId === targetSecurity.id && item.ownerId === election.holderId); if (!source || source.shares < election.shares) continue; const value = Math.round(stockValue * election.shares / Math.max(1, targetSecurity.sharesOutstanding)); const issued = Math.max(1, Math.floor(value / buyerPrice)); source.shares -= election.shares; source.costBasisCents = Math.max(0, source.costBasisCents - value); addHolding(world, targetSecurity.id, buyer.id, election.shares, value); addHolding(world, buyerSecurity.id, election.holderId, issued, value); buyerSecurity.sharesOutstanding += issued;
    const holderBuyer = accountIds.security(election.holderId, buyerSecurity.id); const holderTarget = accountIds.security(election.holderId, targetSecurity.id); const buyerTarget = accountIds.acquisitionInvestment(buyer.id, target.id); const buyerEquity = accountIds.contributedEquity(buyer.id); for (const [id, owner, name, category] of [[holderBuyer, election.holderId, "Акции покупателя", "asset"], [holderTarget, election.holderId, "Акции цели", "asset"], [buyerTarget, buyer.id, "Инвестиция в цель", "asset"], [buyerEquity, buyer.id, "Выпущенный капитал", "equity"]] as const) ensureAccount(world.ledger, id, owner, name, category, buyerSecurity.currencyId); postTransaction(world, "ACQUISITION", `Обмен акций по ${deal.id}`, [{ accountId: holderBuyer, side: "debit", amountCents: value }, { accountId: holderTarget, side: "credit", amountCents: value }, { accountId: buyerTarget, side: "debit", amountCents: value }, { accountId: buyerEquity, side: "credit", amountCents: value }], [deal.id]); transferred += election.shares; }
  return transferred * 10_000 / Math.max(1, targetSecurity.sharesOutstanding) >= 5_001;
}
function settleCashTender(world: WorldState, deal: MAndADeal, cashValue: number): boolean { const target = world.companies.find((item) => item.id === deal.targetCompanyId)!; const security = world.equitySecurities.find((item) => item.id === target.equitySecurityId)!; let transferred = 0; for (const election of deal.tenderElections.filter((item) => item.accepted)) { const price = Math.max(1, Math.round(cashValue / Math.max(1, security.sharesOutstanding))); const result = transferShares(world, security.id, election.holderId, deal.buyerId, election.shares, price); if (result.ok) transferred += election.shares; } return transferred * 10_000 / Math.max(1, security.sharesOutstanding) >= 5_001; }

function settleMixedConsideration(world: WorldState, deal: MAndADeal, cashValue: number, stockValue: number): boolean {
  const target = world.companies.find((item) => item.id === deal.targetCompanyId);
  const buyer = world.companies.find((item) => item.id === deal.buyerId);
  const targetSecurity = target && world.equitySecurities.find((item) => item.id === target.equitySecurityId);
  const buyerSecurity = buyer && world.equitySecurities.find((item) => item.id === buyer.equitySecurityId);
  if (!target || !buyer || !targetSecurity || !buyerSecurity || targetSecurity.currencyId !== buyerSecurity.currencyId) return false;
  const buyerCash = bankAccountsForOwner(world, buyer.id, targetSecurity.currencyId)[0];
  const buyerPrice = world.listings.find((item) => item.securityId === buyerSecurity.id)?.lastPriceCents ?? Math.max(1, Math.round(companyValuation(world, buyer.id).equityValueCents / Math.max(1, buyerSecurity.sharesOutstanding)));
  if (!buyerCash || bankAccountBalance(world, buyerCash.id) < cashValue) return false;
  let transferred = 0;
  for (const election of deal.tenderElections.filter((item) => item.accepted)) {
    const source = world.equityHoldings.find((item) => item.securityId === targetSecurity.id && item.ownerId === election.holderId);
    const sellerCash = bankAccountsForOwner(world, election.holderId, targetSecurity.currencyId)[0];
    if (!source || source.shares < election.shares || !sellerCash) continue;
    const cashAmount = Math.floor(cashValue * election.shares / Math.max(1, targetSecurity.sharesOutstanding));
    const stockAmount = Math.floor(stockValue * election.shares / Math.max(1, targetSecurity.sharesOutstanding));
    const cashTransactionId = cashAmount > 0 ? transferBankAccountBalance(world, buyerCash.id, sellerCash.id, cashAmount, "ACQUISITION", `Денежная часть ${deal.id}`) : null;
    if (cashAmount > 0 && !cashTransactionId) continue;
    const issued = Math.max(1, Math.floor(stockAmount / buyerPrice));
    const basisTransferred = Math.round(source.costBasisCents * election.shares / Math.max(1, source.shares));
    source.shares -= election.shares;
    source.costBasisCents = Math.max(0, source.costBasisCents - basisTransferred);
    addHolding(world, targetSecurity.id, buyer.id, election.shares, basisTransferred);
    addHolding(world, buyerSecurity.id, election.holderId, issued, stockAmount);
    buyerSecurity.sharesOutstanding += issued;
    const holderBuyer = accountIds.security(election.holderId, buyerSecurity.id);
    const holderTarget = accountIds.security(election.holderId, targetSecurity.id);
    const buyerTarget = accountIds.acquisitionInvestment(buyer.id, target.id);
    const buyerEquity = accountIds.contributedEquity(buyer.id);
    for (const [id, owner, name, category] of [[holderBuyer, election.holderId, "Акции покупателя", "asset"], [holderTarget, election.holderId, "Акции цели", "asset"], [buyerTarget, buyer.id, "Инвестиция в цель", "asset"], [buyerEquity, buyer.id, "Выпущенный капитал", "equity"]] as const) ensureAccount(world.ledger, id, owner, name, category, buyerSecurity.currencyId);
    postTransaction(world, "ACQUISITION", `Акционная часть ${deal.id}`, [{ accountId: holderBuyer, side: "debit", amountCents: stockAmount }, { accountId: holderTarget, side: "credit", amountCents: stockAmount }, { accountId: buyerTarget, side: "debit", amountCents: stockAmount }, { accountId: buyerEquity, side: "credit", amountCents: stockAmount }], cashTransactionId ? [cashTransactionId] : [deal.id]);
    transferred += election.shares;
  }
  return transferred * 10_000 / Math.max(1, targetSecurity.sharesOutstanding) >= 5_001;
}

function executeRequiredDivestiture(world: WorldState, deal: MAndADeal): boolean {
  if (deal.conditions.some((condition) => condition.startsWith("divestiture-sale:"))) return true;
  const target = world.companies.find((item) => item.id === deal.targetCompanyId);
  const buyer = world.companies.find((item) => item.id === deal.buyerId);
  if (!target || !buyer) return false;
  const currency = world.countries.find((item) => item.id === target.headquartersCountryId)?.currencyReference;
  if (!currency) return false;
  const targetAccount = bankAccountsForOwner(world, target.id, currency)[0];
  const candidates = world.companies
    .filter((item) => item.active && item.id !== target.id && item.id !== buyer.id && item.parentCompanyId !== buyer.id)
    .map((company) => ({ company, account: bankAccountsForOwner(world, company.id, currency)[0] }))
    .filter((item) => item.account && bankAccountBalance(world, item.account.id) > 0)
    .sort((left, right) => bankAccountBalance(world, right.account!.id) - bankAccountBalance(world, left.account!.id));
  const acquirer = candidates[0];
  if (!targetAccount || !acquirer?.account) return false;
  const desiredBookValue = Math.max(1, Math.round(target.productiveCapital.bookValueCents * 0.15));
  const salePrice = Math.min(desiredBookValue, Math.floor(bankAccountBalance(world, acquirer.account.id) * 0.2));
  if (salePrice <= 0) return false;
  const cashTransactionId = transferBankAccountBalance(world, acquirer.account.id, targetAccount.id, salePrice, "ACQUISITION", `Антимонопольная продажа активов ${deal.id}`);
  if (!cashTransactionId) return false;
  ensureAccount(world.ledger, accountIds.productiveCapital(target.id), target.id, `Производственный капитал ${target.name}`, "asset", currency);
  ensureAccount(world.ledger, accountIds.productiveCapital(acquirer.company.id), acquirer.company.id, `Производственный капитал ${acquirer.company.name}`, "asset", currency);
  const assetTransactionId = postTransaction(world, "ACQUISITION", `Передача активов по условию ${deal.id}`, [
    { accountId: accountIds.productiveCapital(acquirer.company.id), side: "debit", amountCents: salePrice },
    { accountId: accountIds.productiveCapital(target.id), side: "credit", amountCents: salePrice },
  ], [cashTransactionId]);
  const capacityTransferred = Math.max(1, Math.round(target.capacityMilliUnits * salePrice / Math.max(1, target.productiveCapital.bookValueCents)));
  const shareTransferred = Math.max(1, Math.round(target.marketShareBps * salePrice / Math.max(1, target.productiveCapital.bookValueCents)));
  target.productiveCapital.bookValueCents = Math.max(0, target.productiveCapital.bookValueCents - salePrice);
  target.capacityMilliUnits = Math.max(0, target.capacityMilliUnits - capacityTransferred);
  target.marketShareBps = Math.max(0, target.marketShareBps - shareTransferred);
  acquirer.company.productiveCapital.bookValueCents += salePrice;
  acquirer.company.capacityMilliUnits += capacityTransferred;
  acquirer.company.marketShareBps += shareTransferred;
  deal.conditions.push(`divestiture-sale:${acquirer.company.id}:${cashTransactionId}:${assetTransactionId}`);
  return true;
}

export function advanceMAndA(world: WorldState, dealId: string): MAndADeal | null {
  const deal = world.mAndADeals.find((item) => item.id === dealId); const target = deal && world.companies.find((item) => item.id === deal.targetCompanyId); if (!deal || !target || ["closed", "failed"].includes(deal.status)) return deal ?? null;
  if (deal.status === "proposed") { deal.boardSupport = deal.type !== "hostile" && deal.premiumBps >= 500; deal.status = deal.boardSupport ? "diligence" : "tender"; }
  else if (deal.status === "tender") { const security = world.equitySecurities.find((item) => item.companyId === target.id); const tendered = solicitTenderElections(world, deal.id); deal.shareholderApprovalBps = Math.round(tendered * 10_000 / Math.max(1, security?.sharesOutstanding ?? 1)); deal.status = deal.shareholderApprovalBps >= 5_001 ? "diligence" : "failed"; }
  else if (deal.status === "diligence") {
    const result = conductDueDiligence(world, deal.buyerId, deal.targetCompanyId);
    deal.dueDiligenceRiskBps = result.riskBps;
    deal.conditions.push(`diligence:${result.finding}:${result.confidenceBps}`);
    const belief = getBelief(world, deal.buyerId, "diligence-risk-bps", deal.targetCompanyId);
    recordDecisionTrace(world, deal.buyerId, "M&A_DILIGENCE", deal.targetCompanyId, belief ? [belief] : [], result.finding);
    if (deal.dueDiligenceRiskBps > 6_500 && deal.premiumBps < 2_000) deal.status = "failed"; else { deal.conditions.push(`due-diligence-risk:${deal.dueDiligenceRiskBps}`); deal.status = "shareholder-vote"; }
  }
  else if (deal.status === "shareholder-vote") { if (!deal.tenderElections.length) solicitTenderElections(world, deal.id); const security = world.equitySecurities.find((item) => item.companyId === target.id); const accepted = deal.tenderElections.filter((item) => item.accepted).reduce((sum, item) => sum + item.shares, 0); deal.shareholderApprovalBps = Math.round(accepted * 10_000 / Math.max(1, security?.sharesOutstanding ?? 1)); deal.status = deal.shareholderApprovalBps >= 5_001 ? "regulatory-review" : "failed"; }
  else if (deal.status === "regulatory-review") { const buyer = world.companies.find((item) => item.id === deal.buyerId); const combined = buyer ? buyer.marketShareBps + target.marketShareBps : 0; deal.antitrustResult = combined > 6_500 ? "rejected" : combined > 4_500 ? "divestiture" : "approved"; if (deal.antitrustResult === "rejected") deal.status = "failed"; else if (deal.antitrustResult === "divestiture") { if (executeRequiredDivestiture(world, deal)) deal.status = "closing"; } else deal.status = "closing"; }
  else if (deal.status === "closing") { const stockValue = deal.consideration === "stock" ? deal.offerPriceMinor : deal.consideration === "mixed" ? Math.round(deal.offerPriceMinor / 2) : 0; const cashValue = deal.offerPriceMinor - stockValue; const settlementOk = deal.consideration === "mixed" ? settleMixedConsideration(world, deal, cashValue, stockValue) : (stockValue === 0 || settleStockExchange(world, deal, stockValue)) && (cashValue === 0 || settleCashTender(world, deal, cashValue)); if (settlementOk) { const buyer = world.companies.find((item) => item.id === deal.buyerId); target.parentCompanyId = deal.buyerId; target.corporateStatus = "subsidiary"; if (buyer && !buyer.subsidiaryIds.includes(target.id)) buyer.subsidiaryIds.push(target.id); deal.status = "closed"; deal.closedAtMonth = world.clock.elapsedMonths; } else deal.status = "failed"; }
  return deal;
}
export function runMAndAIntegration(world: WorldState): void { for (const deal of world.mAndADeals.filter((item) => item.status === "closed" && item.integrationProgressBps < 10_000)) { const target = world.companies.find((item) => item.id === deal.targetCompanyId); deal.integrationProgressBps = Math.min(10_000, deal.integrationProgressBps + Math.max(150, 700 - deal.dueDiligenceRiskBps / 20)); if (target && deal.integrationProgressBps > 5_000) target.managementBps = Math.min(12_000, target.managementBps + 20); } }

export function createIPOProcess(world: WorldState, companyId: string, primaryShares: number, secondaryShares: number): IPOProcess | null { const company = world.companies.find((item) => item.id === companyId && item.active); if (!company) return null; const valuation = companyValuation(world, companyId); const shares = world.equitySecurities.find((item) => item.companyId === companyId)?.sharesOutstanding ?? 1; const midpoint = Math.max(1, Math.round(valuation.equityValueCents / shares)); const ipo: IPOProcess = { id: `ipo-process-${world.ipoProcesses.length + 1}`, companyId, underwriterBankId: null, stage: "preparation", primaryShares, secondaryShares, indicativeLowMinor: Math.round(midpoint * 0.85), indicativeHighMinor: Math.round(midpoint * 1.15), finalPriceMinor: null, feeBps: 180, lockupUntilMonth: null, indications: [], allocations: [], startedAtMonth: world.clock.elapsedMonths }; world.ipoProcesses.push(ipo); return ipo; }
export function submitIpoIndication(world: WorldState, ipoId: string, investorId: string, quantity: number, maxPriceMinor: number): boolean { const ipo = world.ipoProcesses.find((item) => item.id === ipoId && item.stage === "bookbuilding"); if (!ipo || quantity <= 0 || maxPriceMinor <= 0) return false; ipo.indications.push({ investorId, quantity: Math.floor(quantity), maxPriceMinor: Math.floor(maxPriceMinor) }); return true; }
function settleIPO(world: WorldState, ipo: IPOProcess): boolean { const company = world.companies.find((item) => item.id === ipo.companyId)!; const security = world.equitySecurities.find((item) => item.id === company.equitySecurityId)!; let primary = ipo.primaryShares; let secondary = ipo.secondaryShares; const owner = [...world.equityHoldings].filter((item) => item.securityId === security.id && item.shares > 0).sort((left, right) => right.shares - left.shares)[0]?.ownerId ?? company.ownerHouseholdId; for (const allocation of ipo.allocations) { const primaryQty = Math.min(primary, allocation.quantity); if (primaryQty && !raiseEquity(world, company.id, allocation.investorId, primaryQty * allocation.priceMinor, allocation.priceMinor, "IPO").ok) return false; primary -= primaryQty; const secondaryQty = Math.min(secondary, allocation.quantity - primaryQty); if (secondaryQty && !transferShares(world, security.id, owner, allocation.investorId, secondaryQty, allocation.priceMinor).ok) return false; secondary -= secondaryQty; }
  const underwriter = ipo.underwriterBankId; if (primary > 0 && underwriter) { const capacity = bankAccountsForOwner(world, underwriter, security.currencyId)[0]; if (capacity) { const placed = raiseEquity(world, company.id, underwriter, primary * ipo.finalPriceMinor!, ipo.finalPriceMinor!, "IPO"); if (placed.ok) primary = 0; } } if (primary > 0 || secondary > 0) return false;
  const exchange = world.exchanges.find((item) => item.countryId === company.headquartersCountryId && item.currencyId === security.currencyId); if (!exchange) return false; security.status = "listed"; company.corporateStatus = "public"; if (!exchange.listedSecurityIds.includes(security.id)) exchange.listedSecurityIds.push(security.id); if (!world.listings.some((item) => item.securityId === security.id && item.exchangeId === exchange.id)) world.listings.push({ id: `listing-${company.id}-${exchange.id}`, exchangeId: exchange.id, companyId: company.id, securityId: security.id, ticker: company.id.slice(-5).toUpperCase(), currencyId: security.currencyId, listedAtMonth: world.clock.elapsedMonths, lastPriceCents: ipo.finalPriceMinor!, previousCloseCents: ipo.finalPriceMinor! }); world.lockupRestrictions.push({ securityId: security.id, ownerId: owner, shares: world.equityHoldings.find((item) => item.securityId === security.id && item.ownerId === owner)?.shares ?? 0, expiresAtMonth: world.clock.elapsedMonths + 6 }); ipo.lockupUntilMonth = world.clock.elapsedMonths + 6; return true;
}
export function advanceIPO(world: WorldState, ipoId: string): IPOProcess | null { const ipo = world.ipoProcesses.find((item) => item.id === ipoId); if (!ipo || ["completed", "failed"].includes(ipo.stage)) return ipo ?? null; if (ipo.stage === "preparation") ipo.stage = "underwriter-selection"; else if (ipo.stage === "underwriter-selection") { ipo.underwriterBankId = world.companies.find((item) => item.id === ipo.companyId)?.bankId ?? null; ipo.stage = ipo.underwriterBankId ? "due-diligence" : "failed"; } else if (ipo.stage === "due-diligence") ipo.stage = "indicative-range"; else if (ipo.stage === "indicative-range") ipo.stage = "bookbuilding"; else if (ipo.stage === "bookbuilding") { const total = ipo.primaryShares + ipo.secondaryShares; if (!ipo.indications.length) { const company = world.companies.find((item) => item.id === ipo.companyId); const currency = company && world.countries.find((item) => item.id === company.headquartersCountryId)?.currencyReference; const security = company && world.equitySecurities.find((item) => item.id === company.equitySecurityId); const controllingOwner = security && [...world.equityHoldings].filter((item) => item.securityId === security.id).sort((left, right) => right.shares - left.shares)[0]?.ownerId; const candidates = [...world.funds.filter((item) => item.currencyId === currency && item.status === "active").map((item) => item.id), ...world.households.map((item) => item.id), ...(ipo.underwriterBankId ? [ipo.underwriterBankId] : [])].filter((id, index, values) => id !== controllingOwner && values.indexOf(id) === index); let remainingDemand = total; for (const investorId of candidates) { const account = bankAccountsForOwner(world, investorId, currency)[0]; const capacity = account ? Math.floor(bankAccountBalance(world, account.id) / Math.max(1, ipo.indicativeHighMinor)) : 0; const quantity = Math.min(remainingDemand, Math.max(0, capacity)); if (quantity > 0) { ipo.indications.push({ investorId, quantity, maxPriceMinor: ipo.indicativeHighMinor }); remainingDemand -= quantity; } if (remainingDemand <= 0) break; } } const ranked = [...ipo.indications].sort((a, b) => b.maxPriceMinor - a.maxPriceMinor); let demand = 0; let price = 0; for (const bid of ranked) { demand += bid.quantity; price = bid.maxPriceMinor; if (demand >= total) break; } if (demand < total || price < ipo.indicativeLowMinor) ipo.stage = "failed"; else { ipo.finalPriceMinor = Math.min(ipo.indicativeHighMinor, price); ipo.stage = "pricing"; } } else if (ipo.stage === "pricing") { let remaining = ipo.primaryShares + ipo.secondaryShares; for (const bid of ipo.indications.filter((item) => item.maxPriceMinor >= ipo.finalPriceMinor!).sort((a, b) => b.maxPriceMinor - a.maxPriceMinor)) { const quantity = Math.min(remaining, bid.quantity); if (quantity) ipo.allocations.push({ investorId: bid.investorId, quantity, priceMinor: ipo.finalPriceMinor! }); remaining -= quantity; } ipo.stage = "allocation"; } else if (ipo.stage === "allocation") ipo.stage = "listing"; else if (ipo.stage === "listing") ipo.stage = settleIPO(world, ipo) ? "completed" : "failed"; return ipo; }
