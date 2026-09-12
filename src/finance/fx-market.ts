import { emitSimpleEvent } from "../core/events.ts";
import { accountIds, bankAccountBalance, ensureAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";
import type { FxPair, WorldState } from "../domain/model.ts";
import { convertMinorAtRate, fxRatePpm } from "./currencies.ts";
import { valueOwnerBalanceSheet } from "./owner-valuation.ts";
import { issueLoan } from "./credit.ts";

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

function dealerAccounts(world: WorldState, currencyId: string) {
  const dealer = world.fxDealers[0];
  if (!dealer) return [];
  // bankAccountIds is kept for save compatibility, but runtime selection also scans
  // the owner's live accounts so liquidity facilities opened at another bank become
  // immediately usable by the dealer.
  return world.bankAccounts
    .filter((account) => account.ownerId === dealer.id && account.currencyId === currencyId && account.status === "active")
    .sort((left, right) => bankAccountBalance(world, right.id) - bankAccountBalance(world, left.id));
}

function dealerAccount(world: WorldState, currencyId: string, requiredMinor = 0): WorldState["bankAccounts"][number] | null {
  const accounts = dealerAccounts(world, currencyId);
  if (requiredMinor > 0) return accounts.find((account) => bankAccountBalance(world, account.id) >= requiredMinor) ?? null;
  return accounts[0] ?? null;
}

function dealerInventoryMinor(world: WorldState, currencyId: string): number {
  return dealerAccounts(world, currencyId).reduce((sum, account) => sum + bankAccountBalance(world, account.id), 0);
}

function fundDealerInventory(world: WorldState, currencyId: string, requiredMinor: number): WorldState["bankAccounts"][number] | null {
  let funded: WorldState["bankAccounts"][number] | null = dealerAccount(world, currencyId, requiredMinor);
  if (funded) return funded;
  const dealer = world.fxDealers[0];
  if (!dealer) return null;

  // A global FX dealer is a liquidity intermediary, not an ordinary operating firm.
  // If a currency inventory is temporarily exhausted it draws a *real bank credit
  // facility*: the bank creates a deposit and a matching loan asset/liability. This
  // preserves the money/credit identities and replaces the old post-init GENESIS
  // refill. We spread facilities across eligible same-currency banks, so one bank's
  // prudential limit cannot become an artificial hard stop for the entire FX market.
  const banks = world.banks
    .filter((bank) => bank.baseCurrency === currencyId)
    .sort((left, right) => {
      const leftLoans = world.loans.filter((loan) => loan.lenderBankId === left.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
      const rightLoans = world.loans.filter((loan) => loan.lenderBankId === right.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
      return leftLoans - rightLoans;
    });
  const targetInventory = Math.max(requiredMinor, dealer.targetInventoryByCurrency[currencyId] ?? requiredMinor);
  const facilityChunk = Math.max(requiredMinor, Math.ceil(Math.min(targetInventory * 0.05, requiredMinor * 8)));

  for (const bank of banks) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      funded = dealerAccount(world, currencyId, requiredMinor);
      if (funded) return funded;
      const existing = world.bankAccounts.find((account) => account.ownerId === dealer.id && account.bankId === bank.id && account.currencyId === currencyId && account.status === "active");
      const existingBalance = existing ? bankAccountBalance(world, existing.id) : 0;
      const request = Math.max(1, Math.ceil(Math.max(requiredMinor - existingBalance, facilityChunk) * 1.08));
      const loan = issueLoan(world, bank.id, dealer.id, request, 120, 120 + attempt * 30, ["fx-dealer-liquidity", currencyId]);
      if (!loan) break;
      if (!dealer.bankAccountIds.includes(loan.settlementBankAccountId)) dealer.bankAccountIds.push(loan.settlementBankAccountId);
    }
  }
  return dealerAccount(world, currencyId, requiredMinor);
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
  let targetDealer: WorldState["bankAccounts"][number] | null = dealerAccount(world, toAccount.currencyId, quote?.amountToMinor ?? 0);
  if (!quote || !sourceDealer) return { ok: false, message: "Для пары нет исполнимой котировки" };
  if (bankAccountBalance(world, fromAccount.id) < quote.amountFromMinor) return { ok: false, message: `Недостаточно ${fromAccount.currencyId}` };
  const maximumEntry = Number.MAX_SAFE_INTEGER - 1_000_000;
  if (quote.amountFromMinor > maximumEntry || quote.amountToMinor > maximumEntry) {
    let remaining = quote.amountFromMinor;
    let firstTradeId: string | undefined;
    let lastQuote: FxConversionQuote | undefined;
    const maximumSourceTranche = Math.max(1, Math.min(maximumEntry, Math.floor(quote.amountFromMinor * maximumEntry / Math.max(1, quote.amountToMinor))));
    while (remaining > 0) {
      const tranche = Math.min(remaining, maximumSourceTranche);
      const result = executeFxConversion(world, ownerId, fromBankAccountId, toBankAccountId, tranche);
      if (!result.ok) return result;
      firstTradeId ??= result.tradeId;
      lastQuote = result.quote;
      remaining -= tranche;
    }
    return { ok: true, message: "Обмен исполнен траншами", tradeId: firstTradeId, quote: lastQuote };
  }
  if (!targetDealer) targetDealer = fundDealerInventory(world, toAccount.currencyId, quote.amountToMinor);
  if (!targetDealer) return { ok: false, message: `У дилера недостаточно ликвидности; банковское фондирование недоступно (${toAccount.currencyId}: ${dealerInventoryMinor(world, toAccount.currencyId)} / ${quote.amountToMinor})` };

  const tradeId = `fx-trade-${String(world.nextFxTradeId++).padStart(8, "0")}`;
  const groupId = `fx-group-${tradeId}`;
  const sourceLeg = transferBankAccountBalance(world, fromAccount.id, sourceDealer.id, quote.amountFromMinor, "FX_TRADE", `${tradeId}: ${fromAccount.currencyId} leg`, [groupId]);
  if (!sourceLeg) return { ok: false, message: "Не удалось провести исходящую валютную ногу" };
  // Reserve/interbank settlement of the first leg can change bank liquidity but must
  // never leave the client with a one-sided FX trade. Re-check executable inventory
  // immediately before the counter-leg and draw another real dealer facility if
  // necessary.
  let executableTargetDealer: WorldState["bankAccounts"][number] | null = targetDealer;
  if (!executableTargetDealer || bankAccountBalance(world, executableTargetDealer.id) < quote.amountToMinor) {
    executableTargetDealer = fundDealerInventory(world, toAccount.currencyId, quote.amountToMinor);
  }
  if (!executableTargetDealer) {
    const rollback = transferBankAccountBalance(world, sourceDealer.id, fromAccount.id, quote.amountFromMinor, "FX_TRADE", `${tradeId}: rollback ${fromAccount.currencyId} leg`, [sourceLeg, groupId]);
    if (!rollback) throw new Error(`FX ${tradeId}: встречная нога и rollback отклонены`);
    return { ok: false, message: `FX ${tradeId}: встречная нога не профинансирована, исходящая нога возвращена` };
  }
  targetDealer = executableTargetDealer;
  const targetBalanceBefore = bankAccountBalance(world, targetDealer.id);
  const targetLeg = transferBankAccountBalance(world, targetDealer.id, toAccount.id, quote.amountToMinor, "FX_TRADE", `${tradeId}: ${toAccount.currencyId} leg`, [groupId]);
  if (!targetLeg) {
    // Compensate the already-settled source leg instead of leaving an economically
    // impossible half trade in the ledger.
    const rollback = transferBankAccountBalance(world, sourceDealer.id, fromAccount.id, quote.amountFromMinor, "FX_TRADE", `${tradeId}: rollback ${fromAccount.currencyId} leg`, [sourceLeg, groupId]);
    if (!rollback) throw new Error(`FX ${tradeId}: встречная нога и rollback отклонены`);
    return { ok: false, message: `FX ${tradeId}: встречная нога отклонена, исходящая нога возвращена (account=${targetDealer.id}, status=${targetDealer.status}, currency=${targetDealer.currencyId}/${toAccount.currencyId}, balance=${targetBalanceBefore}, required=${quote.amountToMinor})` };
  }
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
  const executedPairRate = pair.baseCurrencyId === fromAccount.currencyId
    ? quote.ratePpm
    : Math.max(1, Math.round(1_000_000_000_000 / quote.ratePpm));
  // Execution occurs at bid/ask. The market mid is updated separately from
  // dealer inventory/policy pressure in refreshFxQuotes; a retail spread must
  // never become the new fundamental midpoint by itself.
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
  const inventoryByCurrency = new Map<string, number>();
  if (dealer) {
    for (const account of world.bankAccounts) {
      if (account.ownerId !== dealer.id || account.status !== "active") continue;
      inventoryByCurrency.set(account.currencyId, (inventoryByCurrency.get(account.currencyId) ?? 0) + bankAccountBalance(world, account.id));
    }
  }
  const policyRateByCurrency = new Map<string, number>();
  for (const area of world.monetaryAreas) {
    policyRateByCurrency.set(area.currencyId, world.centralBanks.find((bank) => bank.id === area.monetaryAuthorityId)?.policyRateBps ?? 0);
  }
  for (const pair of world.fxPairs) {
    const baseTarget = dealer?.targetInventoryByCurrency[pair.baseCurrencyId] ?? 1;
    const quoteTarget = dealer?.targetInventoryByCurrency[pair.quoteCurrencyId] ?? 1;
    const baseInventory = inventoryByCurrency.get(pair.baseCurrencyId) ?? 0;
    const quoteInventory = inventoryByCurrency.get(pair.quoteCurrencyId) ?? 0;
    const baseInventoryPressure = Math.round((baseInventory - baseTarget) * 200 / Math.max(1, baseTarget));
    const quoteInventoryPressure = Math.round((quoteInventory - quoteTarget) * 200 / Math.max(1, quoteTarget));
    const baseRate = policyRateByCurrency.get(pair.baseCurrencyId) ?? 0;
    const quoteRate = policyRateByCurrency.get(pair.quoteCurrencyId) ?? 0;
    const policySkewBps = Math.max(-80, Math.min(80, Math.round((baseRate - quoteRate) / 20)));
    const inventorySkewBps = Math.max(-45, Math.min(45, quoteInventoryPressure - baseInventoryPressure));
    // The midpoint moves only from funding/policy pressure. Dealer bid/ask execution prices
    // never become the next midpoint by themselves. Divide the instantaneous pressure
    // over a year-equivalent horizon so a burst of retail conversions cannot compound
    // into an artificial FX trend inside one simulation month.
    const midpointMoveBps = Math.max(-25, Math.min(25, Math.round((policySkewBps + inventorySkewBps) / 12)));
    const quotedMid = Math.max(1, Math.round(pair.lastRatePpm * (10_000 + midpointMoveBps) / 10_000));
    pair.previousRatePpm = pair.lastRatePpm;
    pair.lastRatePpm = quotedMid;
    const halfSpread = Math.max(1, Math.round(quotedMid * pair.spreadBps / 20_000));
    pair.bidRatePpm = Math.max(1, quotedMid - halfSpread);
    pair.askRatePpm = quotedMid + halfSpread;
  }
}

export function valueInReportingCurrency(world: WorldState, ownerId: string, reportingCurrencyId: string): { totalMinor: number; translationEffectMinor: number } {
  const value = valueOwnerBalanceSheet(world, ownerId, reportingCurrencyId);
  return { totalMinor: value.totalMinor, translationEffectMinor: value.translationEffectMinor };
}
