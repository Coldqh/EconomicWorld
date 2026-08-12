import { emitSimpleEvent } from "../core/events.ts";
import { accountIds, bankAccountBalance, ensureAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";
import { transferShares } from "../corporate/finance.ts";
import type {
  CreditDefaultSwapContract,
  DerivativeContract,
  ForwardContract,
  FuturesContract,
  InterestRateSwapContract,
  OptionContract,
  OptionMarketSeries,
  TotalReturnSwapContract,
  UnderlyingReference,
  WorldState,
} from "../domain/model.ts";
import { matchOrderBook, openBrokerageAccount, placeOrder } from "../markets/exchange.ts";
import { convertMinorAtRate } from "./currencies.ts";
import { createNettingSet, novateFuture, pledgeDerivativeCashCollateral, settleBilateralNet, settleFuturesVariationMargin } from "./clearing.ts";
import { currencyBankAccount, settleFinancialPayment } from "./financial-settlement.ts";
import { impliedVolatilityBps, valueEuropeanOption } from "./option-pricing.ts";
import { pledgeSecurityCollateral } from "./leverage.ts";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

function contractId(world: WorldState): string {
  return `derivative-${String(world.nextDerivativeId++).padStart(8, "0")}`;
}

function defaultCollateral(currencyId: string, initialMarginBps = 1_500, maintenanceMarginBps = 1_000) {
  return { initialMarginBps, maintenanceMarginBps, variationMargin: true, collateralCurrencyId: currencyId };
}

function defaultSettlement(mode: "cash" | "physical" = "cash", frequencyMonths = 1, nettingEnabled = true) {
  return { mode, frequencyMonths, nettingEnabled };
}

export function underlyingPriceMinor(world: WorldState, underlying: UnderlyingReference): number | null {
  if (underlying.kind === "commodity") return world.commodityMarkets.find((market) => market.commodityId === underlying.commodityId)?.spotPriceUsdMinor ?? null;
  if (underlying.kind === "equity") return world.listings.find((listing) => listing.securityId === underlying.securityId)?.lastPriceCents ?? null;
  if (underlying.kind === "bond") {
    const corporate = world.corporateBonds.find((bond) => bond.id === underlying.bondId);
    if (corporate) return corporate.faceValueCents;
    return world.sovereignBonds.find((bond) => bond.id === underlying.bondId)?.marketPriceMinor ?? null;
  }
  if (underlying.kind === "index") return world.marketIndices.find((index) => index.id === underlying.indexId)?.levelBps ?? null;
  if (underlying.kind === "currency-pair") return world.fxPairs.find((pair) => pair.id === underlying.pairId)?.lastRatePpm ?? null;
  if (underlying.kind === "interest-rate") {
    const area = world.monetaryAreas.find((item) => item.id === underlying.monetaryAreaId);
    return world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId)?.policyRateBps ?? null;
  }
  const corporate = world.corporateBonds.find((bond) => bond.id === underlying.obligationId);
  if (corporate) return corporate.status === "defaulted" ? 0 : corporate.faceValueCents;
  const sovereign = world.sovereignBonds.find((bond) => bond.id === underlying.obligationId);
  return sovereign ? (sovereign.status === "defaulted" ? 0 : sovereign.marketPriceMinor) : null;
}

export function createForward(
  world: WorldState,
  buyerId: string,
  sellerId: string,
  underlying: UnderlyingReference,
  quantity: number,
  forwardPriceMinor: number,
  maturityMonths: number,
  settlementMode: "cash" | "physical" = "cash",
): ForwardContract | null {
  const currencyId = underlying.kind === "commodity" ? "USD" : underlying.kind === "equity"
    ? world.equitySecurities.find((security) => security.id === underlying.securityId)?.currencyId
    : underlying.kind === "currency-pair"
      ? world.fxPairs.find((pair) => pair.id === underlying.pairId)?.quoteCurrencyId
      : currencyBankAccount(world, buyerId, world.player.reportingCurrencyId)?.currencyId;
  quantity = Math.floor(quantity);
  if (!currencyId || quantity <= 0 || forwardPriceMinor <= 0 || maturityMonths < 1 || buyerId === sellerId) return null;
  if (!currencyBankAccount(world, buyerId, currencyId) || !currencyBankAccount(world, sellerId, currencyId)) return null;
  const id = contractId(world);
  const set = createNettingSet(world, buyerId, sellerId, currencyId);
  const contract: ForwardContract = {
    id,
    type: underlying.kind === "currency-pair" ? "fx-forward" : "forward",
    counterpartyIds: [buyerId, sellerId],
    buyerId,
    sellerId,
    underlying,
    quantity,
    forwardPriceMinor: Math.floor(forwardPriceMinor),
    notionalMinor: Math.floor(quantity * forwardPriceMinor),
    currencyId,
    startMonth: world.clock.elapsedMonths,
    maturityMonth: world.clock.elapsedMonths + maturityMonths,
    status: "active",
    collateralTerms: defaultCollateral(currencyId, 1_000, 750),
    settlementTerms: defaultSettlement(settlementMode, maturityMonths, true),
    nettingSetId: set.id,
    ccpId: null,
    lastMarkMinor: 0,
    transactionIds: [],
  };
  set.contractIds.push(id);
  world.derivativeContracts.push(contract);
  emitSimpleEvent(world, "ForwardCreated", "Заключён форвард", id, [buyerId, sellerId], "info", [], { notionalMinor: contract.notionalMinor, maturityMonth: contract.maturityMonth });
  return contract;
}

function settleFxExchange(
  world: WorldState,
  basePayerId: string,
  baseRecipientId: string,
  quotePayerId: string,
  quoteRecipientId: string,
  pairId: string,
  baseAmountMinor: number,
  ratePpm: number,
  kind: "FX_FORWARD_SETTLEMENT" | "DERIVATIVE_SETTLEMENT",
  referenceId: string,
): string[] | null {
  const pair = world.fxPairs.find((item) => item.id === pairId);
  if (!pair) return null;
  const basePayer = currencyBankAccount(world, basePayerId, pair.baseCurrencyId);
  const baseRecipient = currencyBankAccount(world, baseRecipientId, pair.baseCurrencyId);
  const quotePayer = currencyBankAccount(world, quotePayerId, pair.quoteCurrencyId);
  const quoteRecipient = currencyBankAccount(world, quoteRecipientId, pair.quoteCurrencyId);
  const quoteAmountMinor = convertMinorAtRate(baseAmountMinor, pair.baseCurrencyId, pair.quoteCurrencyId, ratePpm);
  if (!basePayer || !baseRecipient || !quotePayer || !quoteRecipient || bankAccountBalance(world, basePayer.id) < baseAmountMinor || bankAccountBalance(world, quotePayer.id) < quoteAmountMinor) return null;
  const baseTx = transferBankAccountBalance(world, basePayer.id, baseRecipient.id, baseAmountMinor, kind, `${referenceId}: ${pair.baseCurrencyId}`);
  const quoteTx = baseTx && transferBankAccountBalance(world, quotePayer.id, quoteRecipient.id, quoteAmountMinor, kind, `${referenceId}: ${pair.quoteCurrencyId}`, [baseTx]);
  if (!baseTx || !quoteTx) return null;
  const legs: string[] = [baseTx, quoteTx];
  for (const [payerId, recipientId, currencyId, amountMinor, causeId] of [
    [basePayerId, baseRecipientId, pair.baseCurrencyId, baseAmountMinor, baseTx],
    [quotePayerId, quoteRecipientId, pair.quoteCurrencyId, quoteAmountMinor, quoteTx],
  ] as const) {
    const payerPosition = accountIds.fxPosition(payerId, referenceId, currencyId);
    const recipientPosition = accountIds.fxPosition(recipientId, referenceId, currencyId);
    ensureAccount(world.ledger, payerPosition, payerId, `FX-позиция ${referenceId}`, "equity", currencyId);
    ensureAccount(world.ledger, recipientPosition, recipientId, `FX-позиция ${referenceId}`, "equity", currencyId);
    legs.push(postTransaction(world, kind, `${referenceId}: позиция ${currencyId}`, [
      { accountId: payerPosition, side: "debit", amountCents: amountMinor },
      { accountId: recipientPosition, side: "credit", amountCents: amountMinor },
    ], [causeId]));
  }
  return legs;
}

export function settleForward(world: WorldState, id: string): { ok: boolean; payoffMinor: number; transactionIds: string[] } {
  const contract = world.derivativeContracts.find((item): item is ForwardContract => item.id === id && (item.type === "forward" || item.type === "fx-forward") && item.status === "active");
  if (!contract || world.clock.elapsedMonths < contract.maturityMonth) return { ok: false, payoffMinor: 0, transactionIds: [] };
  if (contract.type === "fx-forward" && contract.underlying.kind === "currency-pair" && contract.settlementTerms.mode === "physical") {
    const legs = settleFxExchange(world, contract.sellerId, contract.buyerId, contract.buyerId, contract.sellerId, contract.underlying.pairId, contract.quantity, contract.forwardPriceMinor, "FX_FORWARD_SETTLEMENT", contract.id);
    if (!legs) return { ok: false, payoffMinor: 0, transactionIds: [] };
    contract.status = "matured";
    contract.transactionIds.push(...legs);
    return { ok: true, payoffMinor: 0, transactionIds: legs };
  }
  const marketPrice = underlyingPriceMinor(world, contract.underlying);
  if (marketPrice === null) return { ok: false, payoffMinor: 0, transactionIds: [] };
  if (contract.settlementTerms.mode === "physical" && contract.underlying.kind === "equity") {
    const transfer = transferShares(world, contract.underlying.securityId, contract.sellerId, contract.buyerId, contract.quantity, contract.forwardPriceMinor, "EQUITY_SECONDARY");
    if (!transfer.ok) return { ok: false, payoffMinor: 0, transactionIds: transfer.transactionIds };
    contract.status = "matured";
    contract.transactionIds.push(...transfer.transactionIds);
    return { ok: true, payoffMinor: (marketPrice - contract.forwardPriceMinor) * contract.quantity, transactionIds: transfer.transactionIds };
  }
  const payoffMinor = Math.round((marketPrice - contract.forwardPriceMinor) * contract.quantity);
  const payerId = payoffMinor >= 0 ? contract.sellerId : contract.buyerId;
  const recipientId = payoffMinor >= 0 ? contract.buyerId : contract.sellerId;
  const transactionId = payoffMinor === 0 ? null : settleFinancialPayment(world, payerId, recipientId, contract.currencyId, Math.abs(payoffMinor), contract.type === "fx-forward" ? "FX_FORWARD_SETTLEMENT" : "DERIVATIVE_SETTLEMENT", `Расчёт ${contract.id}`);
  if (payoffMinor !== 0 && !transactionId) return { ok: false, payoffMinor, transactionIds: [] };
  contract.status = "matured";
  if (transactionId) contract.transactionIds.push(transactionId);
  return { ok: true, payoffMinor, transactionIds: transactionId ? [transactionId] : [] };
}

export function createFuture(
  world: WorldState,
  longId: string,
  shortId: string,
  underlying: UnderlyingReference,
  exchangeId: string,
  quantity: number,
  contractSize: number,
  maturityMonths: number,
): FuturesContract | null {
  const exchange = world.exchanges.find((item) => item.id === exchangeId);
  const ccp = world.clearingHouses.find((item) => item.exchangeIds.includes(exchangeId) && item.status === "active");
  const price = underlyingPriceMinor(world, underlying);
  quantity = Math.floor(quantity);
  if (!exchange || !ccp || price === null || quantity <= 0 || contractSize <= 0 || maturityMonths < 1 || longId === shortId) return null;
  const notionalMinor = Math.round(price * contractSize * quantity);
  const contract: FuturesContract = {
    id: contractId(world), type: "future", counterpartyIds: [longId, shortId], underlying, notionalMinor,
    currencyId: exchange.currencyId, startMonth: world.clock.elapsedMonths, maturityMonth: world.clock.elapsedMonths + maturityMonths,
    status: "active", collateralTerms: defaultCollateral(exchange.currencyId, 1_200, 850), settlementTerms: defaultSettlement("cash", 1, true),
    nettingSetId: null, ccpId: ccp.id, lastMarkMinor: price, transactionIds: [], exchangeId, longId, shortId,
    contractSize, quantity, initialPriceMinor: price, lastSettlementPriceMinor: price, initialMarginMinor: Math.max(1, Math.round(notionalMinor * 1_200 / 10_000)),
  };
  world.derivativeContracts.push(contract);
  if (!novateFuture(world, contract)) {
    world.derivativeContracts.splice(world.derivativeContracts.indexOf(contract), 1);
    return null;
  }
  return contract;
}

export function refreshOptionQuotes(world: WorldState): void {
  for (const series of world.optionMarketSeries) {
    const listing = world.listings.find((item) => item.securityId === series.underlyingSecurityId);
    const exchange = world.exchanges.find((item) => item.id === series.exchangeId);
    const area = world.monetaryAreas.find((item) => item.currencyId === series.currencyId);
    const rate = world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId)?.policyRateBps ?? 0;
    if (!listing || !exchange) continue;
    const bars = world.ohlcvBars.filter((bar) => bar.securityId === series.underlyingSecurityId).slice(-12);
    const realizedVolBps = bars.length > 1
      ? clamp(Math.round(Math.sqrt(bars.reduce((sum, bar, index) => index === 0 ? sum : sum + ((bar.closeCents - bars[index - 1].closeCents) / Math.max(1, bars[index - 1].closeCents)) ** 2, 0) / (bars.length - 1)) * Math.sqrt(12) * 10_000), 800, 12_000)
      : 2_500;
    const value = valueEuropeanOption({ optionType: series.optionType, underlyingPriceMinor: listing.lastPriceCents, strikeMinor: series.strikeMinor, timeToExpiryYears: Math.max(1, series.expirationMonth - world.clock.elapsedMonths) / 12, riskFreeRateBps: rate, volatilityBps: series.impliedVolatilityBps ?? realizedVolBps });
    const spread = Math.max(1, Math.round(value.theoreticalValueMinor * 500 / 10_000));
    series.bidMinor = Math.max(1, value.theoreticalValueMinor - spread);
    series.askMinor = Math.max(series.bidMinor + 1, value.theoreticalValueMinor + spread);
    if (series.lastMinor !== null) series.impliedVolatilityBps = impliedVolatilityBps({ optionType: series.optionType, underlyingPriceMinor: listing.lastPriceCents, strikeMinor: series.strikeMinor, timeToExpiryYears: Math.max(1, series.expirationMonth - world.clock.elapsedMonths) / 12, riskFreeRateBps: rate }, series.lastMinor);
  }
}

export function createOptionSeries(world: WorldState, exchangeId: string, securityId: string, expirationMonths: number, strikeMinor: number, optionType: "call" | "put", contractMultiplier = 100): OptionMarketSeries | null {
  const exchange = world.exchanges.find((item) => item.id === exchangeId && item.listedSecurityIds.includes(securityId));
  if (!exchange || expirationMonths < 1 || strikeMinor <= 0 || contractMultiplier <= 0) return null;
  const expirationMonth = world.clock.elapsedMonths + expirationMonths;
  const existing = world.optionMarketSeries.find((item) => item.exchangeId === exchangeId && item.underlyingSecurityId === securityId && item.expirationMonth === expirationMonth && item.strikeMinor === strikeMinor && item.optionType === optionType);
  if (existing) return existing;
  const series: OptionMarketSeries = {
    id: `option-series-${exchange.id}-${securityId}-${expirationMonth}-${strikeMinor}-${optionType}`,
    exchangeId, underlyingSecurityId: securityId, currencyId: exchange.currencyId, expirationMonth, strikeMinor: Math.floor(strikeMinor), optionType,
    exerciseStyle: "european", contractMultiplier: Math.floor(contractMultiplier), bidMinor: null, askMinor: null, lastMinor: null, impliedVolatilityBps: null, volume: 0, openInterest: 0,
  };
  world.optionMarketSeries.push(series);
  refreshOptionQuotes(world);
  return series;
}

function reclassifyOptionPremium(world: WorldState, contract: OptionContract, premiumMinor: number, paymentTransactionId: string): string {
  const holderAsset = accountIds.derivativeAsset(contract.holderId, contract.id);
  const writerLiability = accountIds.derivativeLiability(contract.writerId, contract.id);
  const holderExpense = accountIds.derivativeExpense(contract.holderId, contract.currencyId);
  const writerIncome = accountIds.derivativeIncome(contract.writerId, contract.currencyId);
  ensureAccount(world.ledger, holderAsset, contract.holderId, `Опцион ${contract.id}`, "asset", contract.currencyId);
  ensureAccount(world.ledger, writerLiability, contract.writerId, `Обязательство ${contract.id}`, "liability", contract.currencyId);
  ensureAccount(world.ledger, holderExpense, contract.holderId, `Финансовый расход · ${contract.currencyId}`, "expense", contract.currencyId);
  ensureAccount(world.ledger, writerIncome, contract.writerId, `Финансовый доход · ${contract.currencyId}`, "income", contract.currencyId);
  return postTransaction(world, "DERIVATIVE_PREMIUM", `Признание опциона ${contract.id}`, [
    { accountId: holderAsset, side: "debit", amountCents: premiumMinor },
    { accountId: writerIncome, side: "debit", amountCents: premiumMinor },
    { accountId: holderExpense, side: "credit", amountCents: premiumMinor },
    { accountId: writerLiability, side: "credit", amountCents: premiumMinor },
  ], [paymentTransactionId]);
}

export function writeOption(world: WorldState, seriesId: string, holderId: string, writerId: string, quantity: number, premiumPerContractMinor?: number): { ok: boolean; message: string; contractId?: string } {
  const series = world.optionMarketSeries.find((item) => item.id === seriesId && item.expirationMonth > world.clock.elapsedMonths);
  const listing = series && world.listings.find((item) => item.securityId === series.underlyingSecurityId);
  quantity = Math.floor(quantity);
  const premium = Math.floor(premiumPerContractMinor ?? series?.askMinor ?? 0);
  if (!series || !listing || quantity <= 0 || premium <= 0 || holderId === writerId) return { ok: false, message: "Некорректная опционная сделка" };
  const notionalMinor = series.strikeMinor * series.contractMultiplier * quantity;
  let pledge = null;
  if (series.optionType === "call") {
    pledge = pledgeSecurityCollateral(world, writerId, holderId, series.underlyingSecurityId, series.contractMultiplier * quantity, "derivative-margin");
    if (!pledge) pledge = pledgeDerivativeCashCollateral(world, writerId, holderId, series.currencyId, Math.max(1, Math.round(notionalMinor * 2_500 / 10_000)));
  } else {
    pledge = pledgeDerivativeCashCollateral(world, writerId, holderId, series.currencyId, notionalMinor);
  }
  if (!pledge) return { ok: false, message: "Недостаточно покрытых акций или денежного обеспечения" };
  const totalPremiumMinor = premium * quantity;
  const payment = settleFinancialPayment(world, holderId, writerId, series.currencyId, totalPremiumMinor, "DERIVATIVE_PREMIUM", `Премия ${series.id}`);
  if (!payment) { pledge.status = "released"; return { ok: false, message: "Премия не оплачена" }; }
  const id = contractId(world);
  const set = createNettingSet(world, holderId, writerId, series.currencyId);
  const contract: OptionContract = {
    id, type: "option", counterpartyIds: [holderId, writerId], underlying: { kind: "equity", securityId: series.underlyingSecurityId },
    notionalMinor, currencyId: series.currencyId, startMonth: world.clock.elapsedMonths, maturityMonth: series.expirationMonth, status: "active",
    collateralTerms: defaultCollateral(series.currencyId, series.optionType === "put" ? 10_000 : 2_500, 2_000), settlementTerms: defaultSettlement("physical", series.expirationMonth - world.clock.elapsedMonths, true),
    nettingSetId: set.id, ccpId: null, lastMarkMinor: premium, transactionIds: [payment], seriesId: series.id, holderId, writerId,
    optionType: series.optionType, exerciseStyle: series.exerciseStyle, strikeMinor: series.strikeMinor, contractMultiplier: series.contractMultiplier,
    quantity, premiumPerContractMinor: premium, carryingValueMinor: totalPremiumMinor,
  };
  const recognition = reclassifyOptionPremium(world, contract, totalPremiumMinor, payment);
  contract.transactionIds.push(recognition);
  world.derivativeContracts.push(contract);
  set.contractIds.push(contract.id);
  set.collateralPledgeIds.push(pledge.id);
  series.lastMinor = premium;
  series.volume += quantity;
  series.openInterest += quantity;
  refreshOptionQuotes(world);
  return { ok: true, message: "Опцион заключён, премия оплачена", contractId: contract.id };
}

function closeOptionCarryingValue(world: WorldState, contract: OptionContract): string | null {
  if (contract.carryingValueMinor <= 0) return null;
  const holderAsset = accountIds.derivativeAsset(contract.holderId, contract.id);
  const writerLiability = accountIds.derivativeLiability(contract.writerId, contract.id);
  const holderExpense = accountIds.derivativeExpense(contract.holderId, contract.currencyId);
  const writerIncome = accountIds.derivativeIncome(contract.writerId, contract.currencyId);
  const tx = postTransaction(world, "DERIVATIVE_SETTLEMENT", `Закрытие стоимости ${contract.id}`, [
    { accountId: holderExpense, side: "debit", amountCents: contract.carryingValueMinor },
    { accountId: writerLiability, side: "debit", amountCents: contract.carryingValueMinor },
    { accountId: holderAsset, side: "credit", amountCents: contract.carryingValueMinor },
    { accountId: writerIncome, side: "credit", amountCents: contract.carryingValueMinor },
  ]);
  contract.carryingValueMinor = 0;
  return tx;
}

export function exerciseOption(world: WorldState, id: string, forceCashSettlement = false): { ok: boolean; message: string; transactionIds: string[] } {
  const contract = world.derivativeContracts.find((item): item is OptionContract => item.id === id && item.type === "option" && item.status === "active");
  if (!contract || (contract.exerciseStyle === "european" && world.clock.elapsedMonths < contract.maturityMonth)) return { ok: false, message: "Опцион пока нельзя исполнить", transactionIds: [] };
  const spot = underlyingPriceMinor(world, contract.underlying);
  if (spot === null) return { ok: false, message: "Нет цены базового актива", transactionIds: [] };
  const intrinsicPerShare = contract.optionType === "call" ? spot - contract.strikeMinor : contract.strikeMinor - spot;
  if (intrinsicPerShare <= 0) return { ok: false, message: "Опцион вне денег", transactionIds: [] };
  const transactionIds: string[] = [];
  if (!forceCashSettlement && contract.settlementTerms.mode === "physical" && contract.underlying.kind === "equity") {
    const sellerId = contract.optionType === "call" ? contract.writerId : contract.holderId;
    const buyerId = contract.optionType === "call" ? contract.holderId : contract.writerId;
    const transfer = transferShares(world, contract.underlying.securityId, sellerId, buyerId, contract.quantity * contract.contractMultiplier, contract.strikeMinor, "EQUITY_SECONDARY");
    if (!transfer.ok) return { ok: false, message: transfer.message, transactionIds: transfer.transactionIds };
    transactionIds.push(...transfer.transactionIds);
  } else {
    const payoffMinor = intrinsicPerShare * contract.contractMultiplier * contract.quantity;
    const payment = settleFinancialPayment(world, contract.writerId, contract.holderId, contract.currencyId, payoffMinor, "DERIVATIVE_SETTLEMENT", `Исполнение ${contract.id}`);
    if (!payment) return { ok: false, message: "Расчёт исполнения не выполнен", transactionIds: [] };
    transactionIds.push(payment);
  }
  const closing = closeOptionCarryingValue(world, contract);
  if (closing) transactionIds.push(closing);
  contract.status = "exercised";
  contract.transactionIds.push(...transactionIds);
  const series = world.optionMarketSeries.find((item) => item.id === contract.seriesId);
  if (series) series.openInterest = Math.max(0, series.openInterest - contract.quantity);
  for (const pledge of world.collateralPledges.filter((item) => contract.nettingSetId && world.nettingSets.find((set) => set.id === contract.nettingSetId)?.collateralPledgeIds.includes(item.id))) pledge.status = "released";
  return { ok: true, message: "Опцион исполнен", transactionIds };
}

export function expireOptions(world: WorldState): number {
  let expired = 0;
  for (const contract of world.derivativeContracts.filter((item): item is OptionContract => item.type === "option" && item.status === "active" && item.maturityMonth <= world.clock.elapsedMonths)) {
    const spot = underlyingPriceMinor(world, contract.underlying) ?? 0;
    const intrinsic = contract.optionType === "call" ? spot - contract.strikeMinor : contract.strikeMinor - spot;
    if (intrinsic > 0) {
      const exercised = exerciseOption(world, contract.id, true);
      if (exercised.ok) continue;
    }
    const closing = closeOptionCarryingValue(world, contract);
    if (closing) contract.transactionIds.push(closing);
    contract.status = "expired";
    const series = world.optionMarketSeries.find((item) => item.id === contract.seriesId);
    if (series) series.openInterest = Math.max(0, series.openInterest - contract.quantity);
    const nettingSet = world.nettingSets.find((set) => set.id === contract.nettingSetId);
    for (const pledge of world.collateralPledges.filter((item) => nettingSet?.collateralPledgeIds.includes(item.id))) pledge.status = "released";
    expired += 1;
  }
  return expired;
}

export function createInterestRateSwap(world: WorldState, fixedPayerId: string, floatingPayerId: string, monetaryAreaId: string, notionalMinor: number, fixedRateBps: number, maturityMonths: number, paymentFrequencyMonths = 3): InterestRateSwapContract | null {
  const area = world.monetaryAreas.find((item) => item.id === monetaryAreaId);
  if (!area || notionalMinor <= 0 || fixedRateBps < 0 || maturityMonths < paymentFrequencyMonths || fixedPayerId === floatingPayerId || !currencyBankAccount(world, fixedPayerId, area.currencyId) || !currencyBankAccount(world, floatingPayerId, area.currencyId)) return null;
  const id = contractId(world);
  const marginMinor = Math.max(1, Math.round(notionalMinor * 300 / 10_000));
  const fixedPledge = pledgeDerivativeCashCollateral(world, fixedPayerId, floatingPayerId, area.currencyId, marginMinor, id);
  const floatingPledge = pledgeDerivativeCashCollateral(world, floatingPayerId, fixedPayerId, area.currencyId, marginMinor, id);
  if (!fixedPledge || !floatingPledge) {
    if (fixedPledge) fixedPledge.status = "released";
    if (floatingPledge) floatingPledge.status = "released";
    return null;
  }
  const set = createNettingSet(world, fixedPayerId, floatingPayerId, area.currencyId);
  set.collateralPledgeIds.push(fixedPledge.id, floatingPledge.id);
  const contract: InterestRateSwapContract = {
    id, type: "interest-rate-swap", counterpartyIds: [fixedPayerId, floatingPayerId], underlying: { kind: "interest-rate", monetaryAreaId },
    notionalMinor: Math.floor(notionalMinor), currencyId: area.currencyId, startMonth: world.clock.elapsedMonths, maturityMonth: world.clock.elapsedMonths + maturityMonths, status: "active",
    collateralTerms: defaultCollateral(area.currencyId, 500, 350), settlementTerms: defaultSettlement("cash", paymentFrequencyMonths, true), nettingSetId: set.id, ccpId: null,
    lastMarkMinor: 0, transactionIds: [], fixedPayerId, floatingPayerId, fixedRateBps, referenceMonetaryAreaId: monetaryAreaId, paymentFrequencyMonths, lastPaymentMonth: world.clock.elapsedMonths,
  };
  world.derivativeContracts.push(contract);
  set.contractIds.push(contract.id);
  return contract;
}

export function floatingReferenceRateBps(world: WorldState, monetaryAreaId: string): number {
  const area = world.monetaryAreas.find((item) => item.id === monetaryAreaId);
  const policy = world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId)?.policyRateBps ?? 0;
  const localFunding = world.bankFunding.filter((funding) => funding.status === "active" && world.banks.find((bank) => bank.id === funding.borrowerBankId)?.centralBankId === area?.monetaryAuthorityId);
  const spread = localFunding.length ? Math.round(localFunding.reduce((sum, funding) => sum + Math.max(0, funding.annualRateBps - policy), 0) / localFunding.length) : 120;
  return policy + spread;
}

export function settleInterestRateSwap(world: WorldState, id: string): { ok: boolean; netMinor: number; transactionId: string | null } {
  const contract = world.derivativeContracts.find((item): item is InterestRateSwapContract => item.id === id && item.type === "interest-rate-swap" && item.status === "active");
  if (!contract || world.clock.elapsedMonths - contract.lastPaymentMonth < contract.paymentFrequencyMonths) return { ok: false, netMinor: 0, transactionId: null };
  const floatingRateBps = floatingReferenceRateBps(world, contract.referenceMonetaryAreaId);
  const fixedMinor = Math.round(contract.notionalMinor * contract.fixedRateBps / 10_000 * contract.paymentFrequencyMonths / 12);
  const floatingMinor = Math.round(contract.notionalMinor * floatingRateBps / 10_000 * contract.paymentFrequencyMonths / 12);
  const set = world.nettingSets.find((item) => item.id === contract.nettingSetId)!;
  const settled = settleBilateralNet(world, set.id, fixedMinor, floatingMinor, `IRS ${contract.id}`);
  if (settled.netMinor !== 0 && !settled.transactionId) return { ok: false, netMinor: settled.netMinor, transactionId: null };
  contract.lastPaymentMonth = world.clock.elapsedMonths;
  contract.lastMarkMinor = floatingMinor - fixedMinor;
  if (settled.transactionId) contract.transactionIds.push(settled.transactionId);
  if (world.clock.elapsedMonths >= contract.maturityMonth) {
    contract.status = "matured";
    for (const pledge of world.collateralPledges.filter((item) => item.referenceId === contract.id && item.status === "active")) pledge.status = "released";
  }
  return { ok: true, netMinor: settled.netMinor, transactionId: settled.transactionId };
}

export function createTotalReturnSwap(world: WorldState, receiverId: string, payerId: string, securityId: string, quantity: number, maturityMonths: number, financingSpreadBps = 350): TotalReturnSwapContract | null {
  const listing = world.listings.find((item) => item.securityId === securityId);
  quantity = Math.floor(quantity);
  if (!listing || quantity <= 0 || maturityMonths < 1 || receiverId === payerId || !currencyBankAccount(world, receiverId, listing.currencyId) || !currencyBankAccount(world, payerId, listing.currencyId)) return null;
  const notionalMinor = listing.lastPriceCents * quantity;
  const pledge = pledgeDerivativeCashCollateral(world, receiverId, payerId, listing.currencyId, Math.max(1, Math.round(notionalMinor * 2_000 / 10_000)));
  if (!pledge) return null;
  const set = createNettingSet(world, receiverId, payerId, listing.currencyId);
  set.collateralPledgeIds.push(pledge.id);
  let brokerage = world.brokerageAccounts.find((item) => item.ownerId === payerId && item.currencyId === listing.currencyId && item.status === "active");
  if (!brokerage) {
    openBrokerageAccount(world, payerId, undefined, currencyBankAccount(world, payerId, listing.currencyId)?.id);
    brokerage = world.brokerageAccounts.find((item) => item.ownerId === payerId && item.currencyId === listing.currencyId && item.status === "active");
  }
  const contract: TotalReturnSwapContract = {
    id: contractId(world), type: "total-return-swap", counterpartyIds: [receiverId, payerId], underlying: { kind: "equity", securityId }, notionalMinor,
    currencyId: listing.currencyId, startMonth: world.clock.elapsedMonths, maturityMonth: world.clock.elapsedMonths + maturityMonths, status: "active",
    collateralTerms: defaultCollateral(listing.currencyId, 2_000, 1_500), settlementTerms: defaultSettlement("cash", 1, true), nettingSetId: set.id, ccpId: null,
    lastMarkMinor: 0, transactionIds: [], receiverId, payerId, securityId, quantity, referencePriceMinor: listing.lastPriceCents, lastReferencePriceMinor: listing.lastPriceCents,
    financingSpreadBps, accruedDividendMinor: 0, hedgeBrokerageAccountId: brokerage?.id ?? null, hedgeQuantity: 0,
  };
  world.derivativeContracts.push(contract);
  set.contractIds.push(contract.id);
  if (brokerage) {
    const hedge = placeOrder(world, brokerage.id, securityId, "buy", "market", quantity);
    contract.hedgeQuantity = hedge.tradeIds?.reduce((sum, tradeId) => sum + (world.marketTrades.find((trade) => trade.id === tradeId)?.quantity ?? 0), 0) ?? 0;
  }
  return contract;
}

export function accrueTrsDividend(world: WorldState, securityId: string, amountPerShareMinor: number): void {
  for (const contract of world.derivativeContracts.filter((item): item is TotalReturnSwapContract => item.type === "total-return-swap" && item.status === "active" && item.securityId === securityId)) contract.accruedDividendMinor += amountPerShareMinor * contract.quantity;
}

function issueContractMarginCall(world: WorldState, contract: DerivativeContract, debtorId: string, creditorId: string, requiredMinor: number): void {
  const collateral = world.collateralPledges.filter((pledge) => pledge.ownerId === debtorId && pledge.securedPartyId === creditorId && pledge.status === "active").reduce((sum, pledge) => sum + Math.round(pledge.markedValueMinor * (10_000 - pledge.haircutBps) / 10_000), 0);
  const existing = world.derivativeMarginCalls.find((call) => call.contractId === contract.id && call.debtorId === debtorId && call.status === "open");
  if (existing) { existing.requiredMinor = Math.max(existing.requiredMinor, requiredMinor); existing.collateralMinor = collateral; return; }
  world.derivativeMarginCalls.push({ id: `derivative-margin-call-${String(world.nextDerivativeMarginCallId++).padStart(8, "0")}`, contractId: contract.id, debtorId, creditorId, requiredMinor, collateralMinor: collateral, issuedAtMonth: world.clock.elapsedMonths, deadlineMonth: world.clock.elapsedMonths + 1, status: "open" });
  contract.status = "margin-call";
}

export function settleTotalReturnSwap(world: WorldState, id: string): { ok: boolean; netMinor: number; transactionId: string | null } {
  const contract = world.derivativeContracts.find((item): item is TotalReturnSwapContract => item.id === id && item.type === "total-return-swap" && (item.status === "active" || item.status === "margin-call"));
  const listing = contract && world.listings.find((item) => item.securityId === contract.securityId);
  if (!contract || !listing) return { ok: false, netMinor: 0, transactionId: null };
  const priceReturnMinor = (listing.lastPriceCents - contract.lastReferencePriceMinor) * contract.quantity;
  const referenceRate = floatingReferenceRateBps(world, world.monetaryAreas.find((area) => area.currencyId === contract.currencyId)?.id ?? "");
  const financingMinor = Math.max(1, Math.round(contract.notionalMinor * (referenceRate + contract.financingSpreadBps) / 10_000 / 12));
  const netMinor = priceReturnMinor + contract.accruedDividendMinor - financingMinor;
  const payerId = netMinor >= 0 ? contract.payerId : contract.receiverId;
  const recipientId = netMinor >= 0 ? contract.receiverId : contract.payerId;
  const payment = netMinor === 0 ? null : settleFinancialPayment(world, payerId, recipientId, contract.currencyId, Math.abs(netMinor), "TRS_SETTLEMENT", `TRS ${contract.id}`);
  if (netMinor !== 0 && !payment) {
    issueContractMarginCall(world, contract, payerId, recipientId, Math.abs(netMinor));
    return { ok: false, netMinor, transactionId: null };
  }
  contract.status = world.clock.elapsedMonths >= contract.maturityMonth ? "matured" : "active";
  contract.lastReferencePriceMinor = listing.lastPriceCents;
  contract.lastMarkMinor = netMinor;
  contract.accruedDividendMinor = 0;
  if (payment) contract.transactionIds.push(payment);
  return { ok: true, netMinor, transactionId: payment };
}

export function forceTrsUnwind(world: WorldState, id: string): string[] {
  const contract = world.derivativeContracts.find((item): item is TotalReturnSwapContract => item.id === id && item.type === "total-return-swap" && item.status === "margin-call");
  if (!contract) return [];
  const transactionIds: string[] = [];
  if (contract.hedgeBrokerageAccountId && contract.hedgeQuantity > 0) {
    const order = placeOrder(world, contract.hedgeBrokerageAccountId, contract.securityId, "sell", "market", contract.hedgeQuantity);
    for (const tradeId of order.tradeIds ?? []) transactionIds.push(tradeId);
    matchOrderBook(world, contract.securityId);
  }
  const call = world.derivativeMarginCalls.find((item) => item.contractId === contract.id && item.status === "open");
  if (call) call.status = "defaulted";
  contract.status = "defaulted";
  emitSimpleEvent(world, "TrsForcedUnwind", "Принудительное закрытие TRS", contract.id, [contract.receiverId, contract.payerId], "critical", transactionIds, { hedgeQuantity: contract.hedgeQuantity });
  return transactionIds;
}

export function cdsFairSpreadBps(world: WorldState, referenceObligationId: string, recoveryBps = 4_000): number {
  const corporateBond = world.corporateBonds.find((bond) => bond.id === referenceObligationId);
  const sovereignBond = world.sovereignBonds.find((bond) => bond.id === referenceObligationId);
  const company = corporateBond && world.companies.find((item) => item.id === corporateBond.issuerCompanyId);
  const defaultProbabilityBps = corporateBond
    ? clamp(80 + (company?.distressMonths ?? 0) * 180 + (corporateBond.status === "defaulted" ? 9_000 : 0), 40, 9_800)
    : clamp(60 + (world.countryMacroStates.find((state) => state.countryId === sovereignBond?.countryId)?.sovereignRiskBps ?? 0) * 2, 30, 9_800);
  const lossGivenDefaultBps = 10_000 - recoveryBps;
  const liquidityBps = corporateBond ? 45 : 25;
  return Math.max(1, Math.round(defaultProbabilityBps * lossGivenDefaultBps / 10_000 + liquidityBps));
}

export function createCreditDefaultSwap(world: WorldState, protectionBuyerId: string, protectionSellerId: string, referenceObligationId: string, notionalMinor: number, maturityMonths: number, recoveryBps = 4_000): CreditDefaultSwapContract | null {
  const corporateBond = world.corporateBonds.find((bond) => bond.id === referenceObligationId);
  const sovereignBond = world.sovereignBonds.find((bond) => bond.id === referenceObligationId);
  const currencyId = corporateBond?.currencyId ?? sovereignBond?.currencyId;
  if (!currencyId || notionalMinor <= 0 || maturityMonths < 1 || protectionBuyerId === protectionSellerId || !currencyBankAccount(world, protectionBuyerId, currencyId) || !currencyBankAccount(world, protectionSellerId, currencyId)) return null;
  const pledge = pledgeDerivativeCashCollateral(world, protectionSellerId, protectionBuyerId, currencyId, Math.max(1, Math.round(notionalMinor * (10_000 - recoveryBps) / 10_000 * 2_500 / 10_000)));
  if (!pledge) return null;
  const set = createNettingSet(world, protectionBuyerId, protectionSellerId, currencyId);
  set.collateralPledgeIds.push(pledge.id);
  const ownsReference = corporateBond
    ? (world.bondHoldings.find((holding) => holding.bondId === corporateBond.id && holding.holderId === protectionBuyerId)?.faceValueCents ?? 0) > 0
    : (world.sovereignBondHoldings.find((holding) => holding.bondId === sovereignBond?.id && holding.holderId === protectionBuyerId)?.faceValueMinor ?? 0) > 0;
  const contract: CreditDefaultSwapContract = {
    id: contractId(world), type: "credit-default-swap", counterpartyIds: [protectionBuyerId, protectionSellerId], underlying: { kind: "credit", obligationId: referenceObligationId }, notionalMinor: Math.floor(notionalMinor),
    currencyId, startMonth: world.clock.elapsedMonths, maturityMonth: world.clock.elapsedMonths + maturityMonths, status: "active", collateralTerms: defaultCollateral(currencyId, 1_500, 1_000),
    settlementTerms: defaultSettlement("cash", 3, true), nettingSetId: set.id, ccpId: null, lastMarkMinor: 0, transactionIds: [], protectionBuyerId, protectionSellerId,
    referenceObligationId, premiumBps: cdsFairSpreadBps(world, referenceObligationId, recoveryBps), recoveryBps, paymentFrequencyMonths: 3, lastPremiumMonth: world.clock.elapsedMonths,
    creditEvents: ["default", "failure-to-pay", "bankruptcy"], speculative: !ownsReference,
  };
  world.derivativeContracts.push(contract);
  set.contractIds.push(contract.id);
  return contract;
}

export function settleCdsPremium(world: WorldState, id: string): string | null {
  const contract = world.derivativeContracts.find((item): item is CreditDefaultSwapContract => item.id === id && item.type === "credit-default-swap" && item.status === "active");
  if (!contract || world.clock.elapsedMonths - contract.lastPremiumMonth < contract.paymentFrequencyMonths) return null;
  const premiumMinor = Math.max(1, Math.round(contract.notionalMinor * contract.premiumBps / 10_000 * contract.paymentFrequencyMonths / 12));
  const tx = settleFinancialPayment(world, contract.protectionBuyerId, contract.protectionSellerId, contract.currencyId, premiumMinor, "CDS_PREMIUM", `Премия CDS ${contract.id}`);
  if (!tx) return null;
  contract.lastPremiumMonth = world.clock.elapsedMonths;
  contract.transactionIds.push(tx);
  return tx;
}

function creditEvent(world: WorldState, obligationId: string): boolean {
  const corporate = world.corporateBonds.find((bond) => bond.id === obligationId);
  if (corporate) return corporate.status === "defaulted";
  const sovereign = world.sovereignBonds.find((bond) => bond.id === obligationId);
  return sovereign?.status === "defaulted";
}

export function settleCdsCreditEvent(world: WorldState, id: string): { ok: boolean; paymentMinor: number; transactionId: string | null } {
  const contract = world.derivativeContracts.find((item): item is CreditDefaultSwapContract => item.id === id && item.type === "credit-default-swap" && item.status === "active");
  if (!contract || !creditEvent(world, contract.referenceObligationId)) return { ok: false, paymentMinor: 0, transactionId: null };
  const paymentMinor = Math.round(contract.notionalMinor * (10_000 - contract.recoveryBps) / 10_000);
  const tx = settleFinancialPayment(world, contract.protectionSellerId, contract.protectionBuyerId, contract.currencyId, paymentMinor, "CDS_SETTLEMENT", `Credit event ${contract.id}`);
  if (!tx) {
    issueContractMarginCall(world, contract, contract.protectionSellerId, contract.protectionBuyerId, paymentMinor);
    return { ok: false, paymentMinor, transactionId: null };
  }
  contract.status = "matured";
  contract.transactionIds.push(tx);
  return { ok: true, paymentMinor, transactionId: tx };
}

export function createFxSwap(world: WorldState, partyAId: string, partyBId: string, pairId: string, baseAmountMinor: number, maturityMonths: number, forwardRatePpm?: number): DerivativeContract | null {
  const pair = world.fxPairs.find((item) => item.id === pairId);
  if (!pair || baseAmountMinor <= 0 || maturityMonths < 1 || partyAId === partyBId) return null;
  const legs = settleFxExchange(world, partyAId, partyBId, partyBId, partyAId, pair.id, Math.floor(baseAmountMinor), pair.lastRatePpm, "DERIVATIVE_SETTLEMENT", `fx-swap-near-${world.nextDerivativeId}`);
  if (!legs) return null;
  const id = contractId(world);
  const set = createNettingSet(world, partyAId, partyBId, pair.quoteCurrencyId);
  const contract: DerivativeContract = {
    id, type: "fx-swap", counterpartyIds: [partyAId, partyBId], underlying: { kind: "currency-pair", pairId }, notionalMinor: convertMinorAtRate(baseAmountMinor, pair.baseCurrencyId, pair.quoteCurrencyId, pair.lastRatePpm),
    currencyId: pair.quoteCurrencyId, startMonth: world.clock.elapsedMonths, maturityMonth: world.clock.elapsedMonths + maturityMonths, status: "active", collateralTerms: defaultCollateral(pair.quoteCurrencyId, 500, 350),
    settlementTerms: defaultSettlement("physical", maturityMonths, true), nettingSetId: set.id, ccpId: null, lastMarkMinor: pair.lastRatePpm, transactionIds: legs,
    partyAId, partyBId, pairId, baseAmountMinor: Math.floor(baseAmountMinor), spotRatePpm: pair.lastRatePpm,
    forwardRatePpm: forwardRatePpm ?? Math.round(pair.lastRatePpm * (10_000 + ((world.centralBanks.find((bank) => bank.currencyId === pair.baseCurrencyId && bank.setsPolicyRate)?.policyRateBps ?? 0) - (world.centralBanks.find((bank) => bank.currencyId === pair.quoteCurrencyId && bank.setsPolicyRate)?.policyRateBps ?? 0)) * maturityMonths / 12) / 10_000), nearLegSettled: true,
  };
  world.derivativeContracts.push(contract);
  set.contractIds.push(contract.id);
  return contract;
}

function settleFxSwapMaturity(world: WorldState, contract: Extract<DerivativeContract, { type: "fx-swap" }>): boolean {
  const legs = settleFxExchange(world, contract.partyBId, contract.partyAId, contract.partyAId, contract.partyBId, contract.pairId, contract.baseAmountMinor, contract.forwardRatePpm, "DERIVATIVE_SETTLEMENT", contract.id);
  if (!legs) return false;
  contract.transactionIds.push(...legs);
  contract.status = "matured";
  return true;
}

export function derivativeExposure(world: WorldState, institutionId: string) {
  const contracts = world.derivativeContracts.filter((contract) => contract.status === "active" || contract.status === "margin-call").filter((contract) => contract.counterpartyIds.includes(institutionId));
  const grossNotionalMinor = contracts.reduce((sum, contract) => sum + contract.notionalMinor, 0);
  const grossMarketValueMinor = contracts.reduce((sum, contract) => sum + Math.abs(contract.lastMarkMinor), 0);
  const signed = contracts.reduce((sum, contract) => sum + (contract.counterpartyIds[0] === institutionId ? contract.lastMarkMinor : -contract.lastMarkMinor), 0);
  const posted = world.collateralPledges.filter((pledge) => pledge.ownerId === institutionId && pledge.purpose === "derivative-margin" && pledge.status === "active").reduce((sum, pledge) => sum + pledge.markedValueMinor, 0);
  const received = world.collateralPledges.filter((pledge) => pledge.securedPartyId === institutionId && pledge.purpose === "derivative-margin" && pledge.status === "active").reduce((sum, pledge) => sum + pledge.markedValueMinor, 0);
  return { institutionId, elapsedMonth: world.clock.elapsedMonths, grossNotionalMinor, grossMarketValueMinor, netExposureMinor: signed, collateralPostedMinor: posted, collateralReceivedMinor: received, potentialExposureMinor: Math.max(0, grossMarketValueMinor + Math.round(grossNotionalMinor * 300 / 10_000) - received) };
}

export function processDerivativeMonth(world: WorldState): void {
  refreshOptionQuotes(world);
  for (const contract of [...world.derivativeContracts]) {
    if (contract.type === "future" && contract.status === "active") {
      const price = underlyingPriceMinor(world, contract.underlying);
      if (price !== null) settleFuturesVariationMargin(world, contract.id, price);
      if (contract.status === "active" && world.clock.elapsedMonths >= contract.maturityMonth) {
        contract.status = "matured";
        for (const position of world.clearedPositions.filter((item) => item.contractId === contract.id && item.status === "open")) position.status = "closed";
        for (const pledge of world.collateralPledges.filter((item) => item.status === "active" && item.referenceId === contract.id)) pledge.status = "released";
      }
    } else if ((contract.type === "forward" || contract.type === "fx-forward") && contract.status === "active" && world.clock.elapsedMonths >= contract.maturityMonth) settleForward(world, contract.id);
    else if (contract.type === "interest-rate-swap" && contract.status === "active") settleInterestRateSwap(world, contract.id);
    else if (contract.type === "total-return-swap" && (contract.status === "active" || contract.status === "margin-call")) settleTotalReturnSwap(world, contract.id);
    else if (contract.type === "credit-default-swap" && contract.status === "active") {
      if (creditEvent(world, contract.referenceObligationId)) settleCdsCreditEvent(world, contract.id);
      else settleCdsPremium(world, contract.id);
    } else if (contract.type === "fx-swap" && contract.status === "active" && world.clock.elapsedMonths >= contract.maturityMonth) settleFxSwapMaturity(world, contract);
  }
  expireOptions(world);
  for (const call of world.derivativeMarginCalls.filter((item) => item.status === "open" && item.deadlineMonth <= world.clock.elapsedMonths)) {
    const contract = world.derivativeContracts.find((item) => item.id === call.contractId);
    if (contract?.type === "total-return-swap") forceTrsUnwind(world, contract.id);
    else { call.status = "defaulted"; if (contract) contract.status = "defaulted"; }
  }
  const institutions = new Set(world.derivativeContracts.flatMap((contract) => contract.counterpartyIds));
  for (const institutionId of institutions) world.derivativeExposureHistory.push(derivativeExposure(world, institutionId));
  if (world.derivativeExposureHistory.length > 4_000) world.derivativeExposureHistory.splice(0, world.derivativeExposureHistory.length - 4_000);
}

export function seedDerivativeMarkets(world: WorldState): void {
  if (world.optionMarketSeries.length) return;
  for (const exchange of world.exchanges) {
    const securityId = exchange.listedSecurityIds.find((id) => world.listings.some((listing) => listing.securityId === id));
    const listing = securityId && world.listings.find((item) => item.securityId === securityId);
    if (!securityId || !listing) continue;
    for (const strikeFactor of [9_000, 10_000, 11_000]) {
      for (const optionType of ["call", "put"] as const) createOptionSeries(world, exchange.id, securityId, 6, Math.max(1, Math.round(listing.lastPriceCents * strikeFactor / 10_000)), optionType);
    }
  }
  refreshOptionQuotes(world);
}
