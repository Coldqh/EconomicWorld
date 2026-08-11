import { bankAccountBalance, bankAccountsForOwner, seedDeposit } from "../core/ledger.ts";
import { emitSimpleEvent } from "../core/events.ts";
import type { ClearingMemberAccount, CollateralPledge, FuturesContract, NettingSet, WorldState } from "../domain/model.ts";
import { settleFinancialPayment } from "./financial-settlement.ts";

function freeCashCollateral(world: WorldState, ownerId: string, currencyId: string): { accountId: string; amountMinor: number } | null {
  const account = bankAccountsForOwner(world, ownerId, currencyId)[0];
  if (!account) return null;
  const pledged = world.collateralPledges
    .filter((pledge) => pledge.ownerId === ownerId && pledge.assetType === "cash" && pledge.assetId === account.id && pledge.status === "active")
    .reduce((sum, pledge) => sum + pledge.quantity, 0);
  return { accountId: account.id, amountMinor: Math.max(0, bankAccountBalance(world, account.id) - pledged) };
}

export function seedClearingHouses(world: WorldState): void {
  if (world.clearingHouses.length) return;
  for (const country of world.countries) {
    const bank = world.banks.find((candidate) => candidate.countryId === country.id);
    const exchange = world.exchanges.find((candidate) => candidate.countryId === country.id);
    if (!bank || !exchange) continue;
    const id = `ccp-${country.id}`;
    seedDeposit(world, id, bank.id, 120_000_000_00);
    const bankAccount = bankAccountsForOwner(world, id, country.currencyReference)[0];
    world.clearingHouses.push({
      id,
      name: `${exchange.shortName} Клиринг`,
      countryId: country.id,
      currencyId: country.currencyReference,
      exchangeIds: [exchange.id],
      bankAccountId: bankAccount.id,
      defaultFundMinor: 35_000_000_00,
      ownCapitalMinor: 20_000_000_00,
      status: "active",
    });
  }
}

export function registerClearingMember(world: WorldState, clearingHouseId: string, memberId: string): ClearingMemberAccount | null {
  const ccp = world.clearingHouses.find((item) => item.id === clearingHouseId && item.status === "active");
  if (!ccp || !bankAccountsForOwner(world, memberId, ccp.currencyId)[0]) return null;
  const existing = world.clearingMemberAccounts.find((item) => item.clearingHouseId === ccp.id && item.memberId === memberId && item.status !== "closed");
  if (existing) return existing;
  const account: ClearingMemberAccount = {
    id: `clearing-member-${ccp.id}-${memberId}`,
    clearingHouseId: ccp.id,
    memberId,
    initialMarginMinor: 0,
    variationMarginMinor: 0,
    defaultFundContributionMinor: 0,
    netExposureMinor: 0,
    status: "active",
  };
  world.clearingMemberAccounts.push(account);
  return account;
}

export function pledgeDerivativeCashCollateral(world: WorldState, ownerId: string, securedPartyId: string, currencyId: string, amountMinor: number, referenceId: string | null = null): CollateralPledge | null {
  const free = freeCashCollateral(world, ownerId, currencyId);
  amountMinor = Math.floor(amountMinor);
  if (!free || amountMinor <= 0 || free.amountMinor < amountMinor) return null;
  const pledge: CollateralPledge = {
    id: `collateral-${String(world.nextCollateralId++).padStart(8, "0")}`,
    referenceId,
    ownerId,
    securedPartyId,
    assetType: "cash",
    assetId: free.accountId,
    quantity: amountMinor,
    currencyId,
    haircutBps: 0,
    markedValueMinor: amountMinor,
    purpose: "derivative-margin",
    status: "active",
  };
  world.collateralPledges.push(pledge);
  emitSimpleEvent(world, "DerivativeCollateralPledged", "Внесено обеспечение дериватива", `${ownerId}: ${amountMinor}`, [ownerId, securedPartyId, pledge.id], "info");
  return pledge;
}

export function novateFuture(world: WorldState, contract: FuturesContract): boolean {
  const ccp = world.clearingHouses.find((item) => item.id === contract.ccpId && item.status === "active");
  if (!ccp) return false;
  const longMember = registerClearingMember(world, ccp.id, contract.longId);
  const shortMember = registerClearingMember(world, ccp.id, contract.shortId);
  if (!longMember || !shortMember) return false;
  const longPledge = pledgeDerivativeCashCollateral(world, contract.longId, ccp.id, contract.currencyId, contract.initialMarginMinor, contract.id);
  const shortPledge = pledgeDerivativeCashCollateral(world, contract.shortId, ccp.id, contract.currencyId, contract.initialMarginMinor, contract.id);
  if (!longPledge || !shortPledge) {
    if (longPledge) longPledge.status = "released";
    if (shortPledge) shortPledge.status = "released";
    return false;
  }
  longMember.initialMarginMinor += contract.initialMarginMinor;
  shortMember.initialMarginMinor += contract.initialMarginMinor;
  for (const [memberId, side] of [[contract.longId, "long"], [contract.shortId, "short"]] as const) {
    world.clearedPositions.push({
      id: `cleared-position-${String(world.nextClearingPositionId++).padStart(8, "0")}`,
      clearingHouseId: ccp.id,
      contractId: contract.id,
      memberId,
      side,
      quantity: contract.quantity,
      netQuantity: side === "long" ? contract.quantity : -contract.quantity,
      lastSettlementPriceMinor: contract.lastSettlementPriceMinor,
      status: "open",
    });
  }
  emitSimpleEvent(world, "FutureNovated", "Фьючерс принят в клиринг", contract.id, [contract.longId, ccp.id, contract.shortId], "info", [], { initialMarginMinor: contract.initialMarginMinor });
  return true;
}

function issueDerivativeMarginCall(world: WorldState, contractId: string, debtorId: string, creditorId: string, requiredMinor: number, collateralMinor: number): void {
  const existing = world.derivativeMarginCalls.find((call) => call.contractId === contractId && call.debtorId === debtorId && call.status === "open");
  if (existing) {
    existing.requiredMinor = Math.max(existing.requiredMinor, requiredMinor);
    existing.collateralMinor = collateralMinor;
    return;
  }
  world.derivativeMarginCalls.push({
    id: `derivative-margin-call-${String(world.nextDerivativeMarginCallId++).padStart(8, "0")}`,
    contractId,
    debtorId,
    creditorId,
    requiredMinor,
    collateralMinor,
    issuedAtMonth: world.clock.elapsedMonths,
    deadlineMonth: world.clock.elapsedMonths + 1,
    status: "open",
  });
  emitSimpleEvent(world, "DerivativeMarginCall", "Маржинальное требование по деривативу", contractId, [debtorId, creditorId], "critical", [], { requiredMinor, collateralMinor });
}

export function settleFuturesVariationMargin(world: WorldState, contractId: string, settlementPriceMinor: number): { ok: boolean; amountMinor: number; transactionIds: string[] } {
  const contract = world.derivativeContracts.find((item): item is FuturesContract => item.id === contractId && item.type === "future" && item.status === "active");
  const ccp = contract && world.clearingHouses.find((item) => item.id === contract.ccpId && item.status === "active");
  if (!contract || !ccp) return { ok: false, amountMinor: 0, transactionIds: [] };
  const variation = Math.round((settlementPriceMinor - contract.lastSettlementPriceMinor) * contract.contractSize * contract.quantity);
  if (variation === 0) return { ok: true, amountMinor: 0, transactionIds: [] };
  const payerId = variation > 0 ? contract.shortId : contract.longId;
  const winnerId = variation > 0 ? contract.longId : contract.shortId;
  const amountMinor = Math.abs(variation);
  const payerCash = freeCashCollateral(world, payerId, contract.currencyId)?.amountMinor ?? 0;
  if (payerCash < amountMinor) {
    const pledged = world.collateralPledges.filter((item) => item.ownerId === payerId && item.securedPartyId === ccp.id && item.status === "active").reduce((sum, item) => sum + item.markedValueMinor, 0);
    issueDerivativeMarginCall(world, contract.id, payerId, ccp.id, amountMinor, pledged);
    contract.status = "margin-call";
    const member = world.clearingMemberAccounts.find((item) => item.clearingHouseId === ccp.id && item.memberId === payerId);
    if (member) member.status = "margin-call";
    return { ok: false, amountMinor, transactionIds: [] };
  }
  const received = settleFinancialPayment(world, payerId, ccp.id, contract.currencyId, amountMinor, "FUTURES_VARIATION_MARGIN", `Вариационная маржа ${contract.id}`);
  const paid = received && settleFinancialPayment(world, ccp.id, winnerId, contract.currencyId, amountMinor, "FUTURES_VARIATION_MARGIN", `Вариационная маржа ${contract.id}`, [received]);
  if (!received || !paid) return { ok: false, amountMinor, transactionIds: received ? [received] : [] };
  contract.lastSettlementPriceMinor = settlementPriceMinor;
  contract.lastMarkMinor = settlementPriceMinor;
  const payerMember = world.clearingMemberAccounts.find((item) => item.clearingHouseId === ccp.id && item.memberId === payerId);
  const winnerMember = world.clearingMemberAccounts.find((item) => item.clearingHouseId === ccp.id && item.memberId === winnerId);
  if (payerMember) payerMember.variationMarginMinor -= amountMinor;
  if (winnerMember) winnerMember.variationMarginMinor += amountMinor;
  for (const position of world.clearedPositions.filter((item) => item.contractId === contract.id)) position.lastSettlementPriceMinor = settlementPriceMinor;
  contract.transactionIds.push(received, paid);
  return { ok: true, amountMinor, transactionIds: [received, paid] };
}

export function createNettingSet(world: WorldState, partyAId: string, partyBId: string, currencyId: string): NettingSet {
  const existing = world.nettingSets.find((set) => set.status === "active" && set.currencyId === currencyId && ((set.partyAId === partyAId && set.partyBId === partyBId) || (set.partyAId === partyBId && set.partyBId === partyAId)));
  if (existing) return existing;
  const set: NettingSet = { id: `netting-set-${String(world.nextNettingSetId++).padStart(7, "0")}`, partyAId, partyBId, currencyId, contractIds: [], collateralPledgeIds: [], closeOutNetting: true, status: "active" };
  world.nettingSets.push(set);
  return set;
}

export function settleBilateralNet(world: WorldState, nettingSetId: string, amountAOwesBMinor: number, amountBOwesAMinor: number, memo: string): { netMinor: number; transactionId: string | null } {
  const set = world.nettingSets.find((item) => item.id === nettingSetId && item.status === "active");
  if (!set) return { netMinor: 0, transactionId: null };
  const netMinor = Math.floor(amountAOwesBMinor - amountBOwesAMinor);
  if (netMinor === 0) return { netMinor, transactionId: null };
  const payerId = netMinor > 0 ? set.partyAId : set.partyBId;
  const recipientId = netMinor > 0 ? set.partyBId : set.partyAId;
  return { netMinor, transactionId: settleFinancialPayment(world, payerId, recipientId, set.currencyId, Math.abs(netMinor), "SWAP_SETTLEMENT", memo, set.contractIds) };
}

export function applyClearingDefaultWaterfall(world: WorldState, clearingHouseId: string, memberId: string, lossMinor: number, creditorId?: string): { uncoveredMinor: number } {
  const ccp = world.clearingHouses.find((item) => item.id === clearingHouseId);
  const member = world.clearingMemberAccounts.find((item) => item.clearingHouseId === clearingHouseId && item.memberId === memberId);
  if (!ccp || !member || lossMinor <= 0) return { uncoveredMinor: Math.max(0, lossMinor) };
  const creditor = creditorId ?? world.clearingMemberAccounts.find((item) => item.clearingHouseId === clearingHouseId && item.memberId !== memberId && item.status === "active")?.memberId;
  if (!creditor || creditor === memberId) return { uncoveredMinor: lossMinor };
  let remaining = lossMinor;
  const memberCash = bankAccountsForOwner(world, memberId, ccp.currencyId)[0];
  const memberResources = Math.min(member.initialMarginMinor + member.defaultFundContributionMinor, memberCash ? bankAccountBalance(world, memberCash.id) : 0);
  const memberUse = Math.min(remaining, memberResources);
  const memberPayment = memberUse > 0 ? settleFinancialPayment(world, memberId, creditor, ccp.currencyId, memberUse, "DERIVATIVE_DEFAULT", `Дефолт участника ${memberId}`) : null;
  const memberPaid = memberPayment ? memberUse : 0;
  const initialMarginUse = Math.min(member.initialMarginMinor, memberPaid);
  member.initialMarginMinor -= initialMarginUse;
  member.defaultFundContributionMinor = Math.max(0, member.defaultFundContributionMinor - (memberPaid - initialMarginUse));
  remaining -= memberPaid;
  const ccpCash = bankAccountBalance(world, ccp.bankAccountId);
  const ccpResources = Math.min(ccp.defaultFundMinor + ccp.ownCapitalMinor, ccpCash);
  const ccpUse = Math.min(remaining, ccpResources);
  const ccpPayment = ccpUse > 0 ? settleFinancialPayment(world, ccp.id, creditor, ccp.currencyId, ccpUse, "DERIVATIVE_DEFAULT", `Гарантийный фонд ${ccp.id}`, memberPayment ? [memberPayment] : []) : null;
  const ccpPaid = ccpPayment ? ccpUse : 0;
  const fundUse = Math.min(ccp.defaultFundMinor, ccpPaid);
  ccp.defaultFundMinor -= fundUse;
  ccp.ownCapitalMinor = Math.max(0, ccp.ownCapitalMinor - (ccpPaid - fundUse));
  remaining -= ccpPaid;
  member.status = "defaulted";
  for (const pledge of world.collateralPledges.filter((item) => item.ownerId === memberId && item.securedPartyId === ccp.id && item.status === "active")) pledge.status = "liquidated";
  if (remaining > 0) ccp.status = "recovery";
  emitSimpleEvent(world, "ClearingMemberDefault", "Дефолт участника клиринга", memberId, [memberId, ccp.id], "critical", [], { lossMinor, uncoveredMinor: remaining });
  return { uncoveredMinor: remaining };
}
