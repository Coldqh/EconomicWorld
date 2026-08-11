import { emitSimpleEvent } from "../core/events.ts";
import { accountIds, bankAccountBalance, bankAccountsForOwner, ensureAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";
import type { FxPair, WorldState } from "../domain/model.ts";
import { convertMinor, convertMinorAtRate, fxRatePpm } from "./currencies.ts";

export interface FxConversionQuote {
  fromCurrencyId: string;
  toCurrencyId: string;
  amountFromMinor: number;
  ratePpm: number;
  spreadBps: number;
  feeMinor: number;
  amountToMinor: number;
  pairId: string;
}

function pairFor(world: WorldState, leftCurrencyId: string, rightCurrencyId: string): FxPair | null {
  return world.fxPairs.find((pair) =>
    (pair.baseCurrencyId === leftCurrencyId && pair.quoteCurrencyId === rightCurrencyId)
    || (pair.baseCurrencyId === rightCurrencyId && pair.quoteCurrencyId === leftCurrencyId)) ?? null;
}

function dealerAccount(world: WorldState, currencyId: string) {
  const dealer = world.fxDealers[0];
  return dealer && dealer.bankAccountIds.map((id) => world.bankAccounts.find((account) => account.id === id)).find((account) => account?.currencyId === currencyId) || null;
}

export function quoteFxConversion(world: WorldState, fromCurrencyId: string, toCurrencyId: string, amountFromMinor: number): FxConversionQuote | null {
  amountFromMinor = Math.floor(amountFromMinor);
  const pair = pairFor(world, fromCurrencyId, toCurrencyId);
  const mid = fxRatePpm(world, fromCurrencyId, toCurrencyId);
  if (!pair || !mid || amountFromMinor <= 0) return null;
  const spreadBps = pair.spreadBps;
  const ratePpm = Math.max(1, Math.round(mid * (10_000 - Math.ceil(spreadBps / 2)) / 10_000));
  const grossToMinor = Math.max(1, convertMinorAtRate(amountFromMinor, fromCurrencyId, toCurrencyId, ratePpm));
  const feeMinor = Math.max(1, Math.floor(grossToMinor * 6 / 10_000));
  return { fromCurrencyId, toCurrencyId, amountFromMinor, ratePpm, spreadBps, feeMinor, amountToMinor: grossToMinor - feeMinor, pairId: pair.id };
}

export function executeFxConversion(
  world: WorldState,
  ownerId: string,
  fromBankAccountId: string,
  toBankAccountId: string,
  amountFromMinor: number,
): { ok: boolean; message: string; tradeId?: string; quote?: FxConversionQuote } {
  const fromAccount = world.bankAccounts.find((account) => account.id === fromBankAccountId && account.ownerId === ownerId && account.status === "active");
  const toAccount = world.bankAccounts.find((account) => account.id === toBankAccountId && account.ownerId === ownerId && account.status === "active");
  if (!fromAccount || !toAccount || fromAccount.currencyId === toAccount.currencyId) return { ok: false, message: "Выберите два действующих счёта в разных валютах" };
  const quote = quoteFxConversion(world, fromAccount.currencyId, toAccount.currencyId, amountFromMinor);
  const sourceDealer = dealerAccount(world, fromAccount.currencyId);
  const targetDealer = dealerAccount(world, toAccount.currencyId);
  if (!quote || !sourceDealer || !targetDealer) return { ok: false, message: "Для пары нет исполнимой котировки" };
  if (bankAccountBalance(world, fromAccount.id) < quote.amountFromMinor) return { ok: false, message: `Недостаточно ${fromAccount.currencyId}` };
  if (bankAccountBalance(world, targetDealer.id) < quote.amountToMinor) return { ok: false, message: "У дилера недостаточно ликвидности" };

  const tradeId = `fx-trade-${String(world.nextFxTradeId++).padStart(8, "0")}`;
  const groupId = `fx-group-${tradeId}`;
  const sourceLeg = transferBankAccountBalance(world, fromAccount.id, sourceDealer.id, quote.amountFromMinor, "FX_TRADE", `${tradeId}: ${fromAccount.currencyId} leg`, [groupId]);
  if (!sourceLeg) return { ok: false, message: "Не удалось провести исходящую валютную ногу" };
  const targetLeg = transferBankAccountBalance(world, targetDealer.id, toAccount.id, quote.amountToMinor, "FX_TRADE", `${tradeId}: ${toAccount.currencyId} leg`, [groupId]);
  if (!targetLeg) throw new Error(`FX ${tradeId}: исходящая нога проведена, встречная нога отклонена`);
  const ownerSourcePosition = accountIds.fxPosition(ownerId, tradeId, fromAccount.currencyId);
  const dealerSourcePosition = accountIds.fxPosition(sourceDealer.ownerId, tradeId, fromAccount.currencyId);
  const dealerTargetPosition = accountIds.fxPosition(targetDealer.ownerId, tradeId, toAccount.currencyId);
  const ownerTargetPosition = accountIds.fxPosition(ownerId, tradeId, toAccount.currencyId);
  ensureAccount(world.ledger, ownerSourcePosition, ownerId, `FX-позиция ${tradeId}`, "equity", fromAccount.currencyId);
  ensureAccount(world.ledger, dealerSourcePosition, sourceDealer.ownerId, `FX-позиция ${tradeId}`, "equity", fromAccount.currencyId);
  ensureAccount(world.ledger, dealerTargetPosition, targetDealer.ownerId, `FX-позиция ${tradeId}`, "equity", toAccount.currencyId);
  ensureAccount(world.ledger, ownerTargetPosition, ownerId, `FX-позиция ${tradeId}`, "equity", toAccount.currencyId);
  const sourcePositionLeg = postTransaction(world, "FX_TRADE", `${tradeId}: признание ${fromAccount.currencyId}`, [
    { accountId: ownerSourcePosition, side: "debit", amountCents: quote.amountFromMinor },
    { accountId: dealerSourcePosition, side: "credit", amountCents: quote.amountFromMinor },
  ], [sourceLeg, groupId]);
  const targetPositionLeg = postTransaction(world, "FX_TRADE", `${tradeId}: признание ${toAccount.currencyId}`, [
    { accountId: dealerTargetPosition, side: "debit", amountCents: quote.amountToMinor },
    { accountId: ownerTargetPosition, side: "credit", amountCents: quote.amountToMinor },
  ], [targetLeg, groupId]);

  const pair = world.fxPairs.find((item) => item.id === quote.pairId)!;
  pair.previousRatePpm = pair.lastRatePpm;
  const executedPairRate = pair.baseCurrencyId === fromAccount.currencyId
    ? quote.ratePpm
    : Math.max(1, Math.round(1_000_000_000_000 / quote.ratePpm));
  pair.lastRatePpm = executedPairRate;
  pair.volumeBaseMinor += pair.baseCurrencyId === fromAccount.currencyId
    ? quote.amountFromMinor
    : quote.amountToMinor;
  refreshFxQuotes(world);
  world.fxTrades.push({
    id: tradeId,
    pairId: pair.id,
    buyerId: pair.baseCurrencyId === toAccount.currencyId ? ownerId : sourceDealer.ownerId,
    sellerId: pair.baseCurrencyId === fromAccount.currencyId ? ownerId : targetDealer.ownerId,
    baseAmountMinor: pair.baseCurrencyId === fromAccount.currencyId ? quote.amountFromMinor : quote.amountToMinor,
    quoteAmountMinor: pair.quoteCurrencyId === toAccount.currencyId ? quote.amountToMinor : quote.amountFromMinor,
    ratePpm: executedPairRate,
    feeQuoteMinor: quote.feeMinor,
    elapsedMonth: world.clock.elapsedMonths,
    transactionGroupId: groupId,
    baseLegTransactionId: sourceLeg,
    quoteLegTransactionId: targetLeg,
  });
  emitSimpleEvent(world, "FxTradeExecuted", "Валюта обменена", `${fromAccount.currencyId} → ${toAccount.currencyId}`, [ownerId, sourceDealer.ownerId], "positive", [sourceLeg, targetLeg, sourcePositionLeg, targetPositionLeg], { amountFromMinor: quote.amountFromMinor, amountToMinor: quote.amountToMinor, ratePpm: quote.ratePpm });
  return { ok: true, message: "Обмен исполнен", tradeId, quote };
}

export function refreshFxQuotes(world: WorldState): void {
  const dealer = world.fxDealers[0];
  for (const pair of world.fxPairs) {
    const baseAccount = dealerAccount(world, pair.baseCurrencyId);
    const quoteAccount = dealerAccount(world, pair.quoteCurrencyId);
    const baseTarget = dealer?.targetInventoryByCurrency[pair.baseCurrencyId] ?? 1;
    const quoteTarget = dealer?.targetInventoryByCurrency[pair.quoteCurrencyId] ?? 1;
    const baseInventoryPressure = baseAccount ? Math.round((bankAccountBalance(world, baseAccount.id) - baseTarget) * 200 / Math.max(1, baseTarget)) : 0;
    const quoteInventoryPressure = quoteAccount ? Math.round((bankAccountBalance(world, quoteAccount.id) - quoteTarget) * 200 / Math.max(1, quoteTarget)) : 0;
    const baseArea = world.monetaryAreas.find((area) => area.currencyId === pair.baseCurrencyId);
    const quoteArea = world.monetaryAreas.find((area) => area.currencyId === pair.quoteCurrencyId);
    const baseRate = world.centralBanks.find((bank) => bank.id === baseArea?.monetaryAuthorityId)?.policyRateBps ?? 0;
    const quoteRate = world.centralBanks.find((bank) => bank.id === quoteArea?.monetaryAuthorityId)?.policyRateBps ?? 0;
    const policySkewBps = Math.max(-80, Math.min(80, Math.round((baseRate - quoteRate) / 20)));
    const inventorySkewBps = Math.max(-45, Math.min(45, quoteInventoryPressure - baseInventoryPressure));
    const quotedMid = Math.max(1, Math.round(pair.lastRatePpm * (10_000 + policySkewBps + inventorySkewBps) / 10_000));
    const halfSpread = Math.max(1, Math.round(quotedMid * pair.spreadBps / 20_000));
    pair.bidRatePpm = quotedMid - halfSpread;
    pair.askRatePpm = quotedMid + halfSpread;
  }
}

export function valueInReportingCurrency(world: WorldState, ownerId: string, reportingCurrencyId: string): { totalMinor: number; translationEffectMinor: number } {
  let totalMinor = 0;
  let translationEffectMinor = 0;
  for (const account of bankAccountsForOwner(world, ownerId)) {
    const balance = bankAccountBalance(world, account.id);
    const converted = convertMinor(world, balance, account.currencyId, reportingCurrencyId) ?? 0;
    totalMinor += converted;
    if (account.currencyId !== reportingCurrencyId) translationEffectMinor += converted;
  }
  for (const holding of world.equityHoldings.filter((item) => item.ownerId === ownerId && item.shares > 0)) {
    const listing = world.listings.find((item) => item.securityId === holding.securityId);
    const security = world.equitySecurities.find((item) => item.id === holding.securityId);
    const native = holding.shares * (listing?.lastPriceCents ?? Math.round(holding.costBasisCents / Math.max(1, holding.shares)));
    const converted = convertMinor(world, native, security?.currencyId ?? reportingCurrencyId, reportingCurrencyId) ?? 0;
    totalMinor += converted;
    if (security?.currencyId !== reportingCurrencyId) translationEffectMinor += converted;
  }
  return { totalMinor, translationEffectMinor };
}
