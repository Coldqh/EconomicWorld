import type { CausalExplanation, MarketAgentKind, WorldState } from "../domain/model.ts";

function put(world: WorldState, explanation: CausalExplanation): void {
  world.causalExplanations.push(explanation);
  if (world.causalExplanations.length > 1_000) world.causalExplanations.splice(0, world.causalExplanations.length - 1_000);
}

function contribution(cause: string, valueBps: number, evidenceIds: string[]) {
  return { cause, valueBps: Math.round(valueBps), evidenceIds };
}

function captureMarkets(world: WorldState): void {
  const barsBySecurity = new Map<string, WorldState["ohlcvBars"][number]>();
  for (const bar of world.ohlcvBars) if (bar.elapsedMonth === world.clock.elapsedMonths && !barsBySecurity.has(bar.securityId)) barsBySecurity.set(bar.securityId, bar);
  const tradesBySecurity = new Map<string, WorldState["marketTrades"]>();
  for (const trade of world.marketTrades) {
    if (trade.elapsedMonth !== world.clock.elapsedMonths) continue;
    const trades = tradesBySecurity.get(trade.securityId) ?? [];
    trades.push(trade);
    tradesBySecurity.set(trade.securityId, trades);
  }
  const brokerageOwnerById = new Map(world.brokerageAccounts.map((item) => [item.id, item.ownerId]));
  const agentKindByOwner = new Map<string, MarketAgentKind>();
  for (const agent of world.marketAgents) if (!agentKindByOwner.has(agent.ownerId)) agentKindByOwner.set(agent.ownerId, agent.kind);
  const orderKindById = new Map<string, MarketAgentKind | "other">();
  for (const order of world.marketOrders) orderKindById.set(order.id, agentKindByOwner.get(brokerageOwnerById.get(order.brokerageAccountId) ?? "") ?? "other");
  for (const order of world.archivedMarketOrders) if (!orderKindById.has(order.id)) orderKindById.set(order.id, agentKindByOwner.get(brokerageOwnerById.get(order.brokerageAccountId) ?? "") ?? "other");
  const latestMakerBySecurity = new Map<string, WorldState["marketMakerQuotes"][number]>();
  for (const maker of world.marketMakerQuotes) if (maker.elapsedMonth === world.clock.elapsedMonths) latestMakerBySecurity.set(maker.securityId, maker);
  for (const listing of world.listings) {
    const bar = barsBySecurity.get(listing.securityId);
    const trades = tradesBySecurity.get(listing.securityId) ?? [];
    if (bar && trades.length > 0) {
      const gross = trades.reduce((sum, item) => sum + item.quantity * item.priceCents, 0);
      const flowByKind = new Map<string, { signed: number; ids: string[] }>();
      for (const trade of trades) {
        const buyKind = orderKindById.get(trade.buyOrderId) ?? "other";
        const sellKind = orderKindById.get(trade.sellOrderId) ?? "other";
        const value = trade.quantity * trade.priceCents;
        const buy = flowByKind.get(buyKind) ?? { signed: 0, ids: [] }; buy.signed += value; buy.ids.push(trade.id); flowByKind.set(buyKind, buy);
        const sell = flowByKind.get(sellKind) ?? { signed: 0, ids: [] }; sell.signed -= value; sell.ids.push(trade.id); flowByKind.set(sellKind, sell);
      }
      const labels: Record<string, string> = { retail: "Розничный поток", fundamental: "Фундаментальные инвесторы", passive: "Пассивные фонды", momentum: "Следование за трендом", "market-maker": "Инвентарь маркет-мейкеров", arbitrageur: "Арбитраж", hedge: "Хедж-фонды", pension: "Пенсионные фонды", "forced-seller": "Принудительные продажи", other: "Прочие исполненные заявки" };
      const flows = [...flowByKind.entries()].map(([kind, value]) => contribution(labels[kind] ?? kind, value.signed * 10_000 / Math.max(1, gross), value.ids)).filter((item) => item.valueBps !== 0).sort((left, right) => Math.abs(right.valueBps) - Math.abs(left.valueBps));
      put(world, { id: `why-price-${listing.securityId}-${world.clock.elapsedMonths}`, entityType: "price", entityId: listing.securityId, elapsedMonth: world.clock.elapsedMonths, title: "Почему изменилась цена", contributions: [contribution("Фактическое изменение цены", (bar.closeCents - bar.openCents) * 10_000 / Math.max(1, bar.openCents), trades.map((item) => item.id)), ...flows].slice(0, 6) });
    }
    const maker = latestMakerBySecurity.get(listing.securityId);
    if (maker) put(world, { id: `why-liquidity-${listing.securityId}-${world.clock.elapsedMonths}`, entityType: "liquidity", entityId: listing.securityId, elapsedMonth: world.clock.elapsedMonths, title: "Почему изменился спред", contributions: [contribution("Волатильность", maker.volatilityBps, [maker.id]), contribution("Использование лимита инвентаря", Math.abs(maker.inventory) * 10_000 / Math.max(1, maker.inventoryLimit), [maker.id]), contribution("Риск токсичного потока", maker.adverseSelectionBps, [maker.id]), contribution("Фактический спред", (maker.askMinor - maker.bidMinor) * 10_000 / Math.max(1, maker.bidMinor), [maker.id])] });
  }
}

function captureCompaniesAndBanks(world: WorldState): void {
  const activeLoanIdsByBorrower = new Map<string, string[]>();
  const defaultedLoanIdsByBank = new Map<string, string[]>();
  for (const loan of world.loans) {
    const target = loan.status === "active" ? activeLoanIdsByBorrower : loan.status === "defaulted" ? defaultedLoanIdsByBank : null;
    const key = loan.status === "active" ? loan.borrowerId : loan.lenderBankId;
    if (target) { const ids = target.get(key) ?? []; ids.push(loan.id); target.set(key, ids); }
  }
  const currentOfferLossByBank = new Map<string, number>();
  for (const offer of world.creditOffers) if (offer.createdAtMonth === world.clock.elapsedMonths) currentOfferLossByBank.set(offer.bankId, (currentOfferLossByBank.get(offer.bankId) ?? 0) + offer.expectedLossBps);
  const bankById = new Map(world.banks.map((item) => [item.id, item]));
  for (const company of world.companies) {
    const report = company.financialReports.at(-1);
    if (!report) continue;
    const scale = Math.max(1, Math.abs(report.revenueCents));
    put(world, { id: `why-company-${company.id}-${world.clock.elapsedMonths}`, entityType: "company", entityId: company.id, elapsedMonth: world.clock.elapsedMonths, title: "Почему изменилась прибыль", contributions: [contribution("Объём и цена продаж", report.revenueCents * 10_000 / scale, []), contribution("Сырьё и комплектующие", -report.cogsCents * 10_000 / scale, []), contribution("Заработная плата", -report.wagesCents * 10_000 / scale, []), contribution("Проценты", -report.interestCents * 10_000 / scale, activeLoanIdsByBorrower.get(company.id) ?? []), contribution("Налоги", -report.taxesCents * 10_000 / scale, []), contribution("Изменение запасов", report.inventoryCents * 1_000 / scale, [])] });
  }
  for (const alm of world.bankAlmStates) {
    const bank = bankById.get(alm.bankId);
    const capital = bank ? Math.max(0, bank.minimumCapitalRatioBps) : 0;
    put(world, { id: `why-bank-${alm.bankId}-${world.clock.elapsedMonths}`, entityType: "bank", entityId: alm.bankId, elapsedMonth: world.clock.elapsedMonths, title: "Почему банк меняет условия кредита", contributions: [contribution("Норматив капитала", -capital, []), contribution("Разрыв ликвидности", alm.liquidityGapMinor < 0 ? -Math.min(10_000, Math.abs(alm.liquidityGapMinor) * 10_000 / Math.max(1, alm.depositsMinor)) : 0, []), contribution("Стоимость фондирования", -alm.fundingCostBps, []), contribution("Кредитные потери", -alm.expectedCreditLossBps, defaultedLoanIdsByBank.get(alm.bankId) ?? []), contribution("Риск заёмщика", -Math.round(currentOfferLossByBank.get(alm.bankId) ?? 0), [])] });
  }
}

function captureTransactions(world: WorldState): void {
  for (const event of world.etfArbitrageEvents.filter((item) => item.elapsedMonth === world.clock.elapsedMonths)) put(world, { id: `why-etf-${event.id}`, entityType: "etf", entityId: event.fundId, elapsedMonth: world.clock.elapsedMonths, title: event.type === "creation" ? "Почему созданы паи биржевого фонда" : "Почему погашены паи биржевого фонда", contributions: [contribution("Отклонение рыночной цены от стоимости корзины", (event.marketValueMinor - event.navMinor) * 10_000 / Math.max(1, event.navMinor), event.transactionIds), contribution("Издержки исполнения", -event.costsMinor * 10_000 / Math.max(1, event.navMinor), event.transactionIds)] });
  for (const deal of world.privateEquityDeals) { const id = `why-pe-${deal.id}-${deal.status}`; if (!world.causalExplanations.some((item) => item.id === id)) put(world, { id, entityType: "pe", entityId: deal.id, elapsedMonth: world.clock.elapsedMonths, title: deal.status === "exited" ? "Почему фонд вышел из инвестиции" : "Почему фонд выбрал компанию", contributions: [contribution("Доля собственного капитала", deal.sponsorEquityMinor * 10_000 / Math.max(1, deal.purchaseConsiderationMinor), []), contribution("Финансовый рычаг", (deal.seniorDebtMinor + deal.subordinatedDebtMinor) * 10_000 / Math.max(1, deal.purchaseConsiderationMinor), []), contribution("Ковенант по долгу", -deal.leverageCovenantBps, []), contribution("Результат выхода", deal.exitProceedsMinor * 10_000 / Math.max(1, deal.sponsorEquityMinor), [])] }); }
  for (const deal of world.mAndADeals) { const id = `why-ma-${deal.id}-${deal.status}`; if (!world.causalExplanations.some((item) => item.id === id)) put(world, { id, entityType: "ma", entityId: deal.id, elapsedMonth: world.clock.elapsedMonths, title: deal.status === "failed" ? "Почему сделка не состоялась" : "Почему изменилась цена сделки", contributions: [contribution("Премия к оценке", deal.premiumBps, deal.competingBidIds), contribution("Риск проверки", -deal.dueDiligenceRiskBps, []), contribution("Поддержка акционеров", deal.shareholderApprovalBps, deal.tenderElections.map((item) => item.holderId)), contribution("Антимонопольное решение", deal.antitrustResult === "rejected" ? -10_000 : deal.antitrustResult === "divestiture" ? -3_000 : 0, deal.conditions)] }); }
  for (const ipo of world.ipoProcesses) { const id = `why-ipo-${ipo.id}-${ipo.stage}`; if (world.causalExplanations.some((item) => item.id === id)) continue; const demand = ipo.indications.reduce((sum, item) => sum + item.quantity, 0); put(world, { id, entityType: "ipo", entityId: ipo.id, elapsedMonth: world.clock.elapsedMonths, title: "Почему первичное размещение оценено по этой цене", contributions: [contribution("Спрос книги заявок", demand * 10_000 / Math.max(1, ipo.primaryShares + ipo.secondaryShares), ipo.indications.map((item) => item.investorId)), contribution("Цена относительно нижней границы", ((ipo.finalPriceMinor ?? ipo.indicativeLowMinor) - ipo.indicativeLowMinor) * 10_000 / Math.max(1, ipo.indicativeLowMinor), []), contribution("Комиссия андеррайтера", -ipo.feeBps, ipo.underwriterBankId ? [ipo.underwriterBankId] : [])] }); }
  for (const auction of world.economicAuctions.filter((item) => item.status !== "open" && (item.closesAtMonth === world.clock.elapsedMonths || item.openedAtMonth === world.clock.elapsedMonths))) put(world, { id: `why-auction-${auction.id}`, entityType: "auction", entityId: auction.id, elapsedMonth: world.clock.elapsedMonths, title: "Почему аукцион дал этот результат", contributions: [contribution("Допущенные заявки", auction.bids.length * 100, auction.bids.map((item) => item.id)), contribution("Резервная цена", -auction.reserveMinor, []), contribution("Клиринговая цена", auction.allocations[0]?.clearingPriceMinor ?? 0, auction.allocations.map((item) => item.bidId)), contribution("Распределённый объём", auction.allocations.reduce((sum, item) => sum + item.quantity, 0) * 100, auction.allocations.map((item) => item.bidId))] });
  for (const policy of world.insurancePolicies.filter((item) => item.inceptionMonth === world.clock.elapsedMonths)) put(world, { id: `why-insurance-${policy.id}`, entityType: "insurance", entityId: policy.id, elapsedMonth: world.clock.elapsedMonths, title: "Почему страховая премия такая", contributions: [contribution("Частота убытка", policy.expectedFrequencyBps, []), contribution("Тяжесть убытка", policy.expectedSeverityBps, []), contribution("Франшиза", -policy.deductibleMinor * 10_000 / Math.max(1, policy.insuredValueMinor), []), contribution("Лимит покрытия", policy.limitMinor * 10_000 / Math.max(1, policy.insuredValueMinor), []), contribution("Состояние риска", policy.line === "cyber" ? 10_000 - policy.securityPostureBps : 0, [])] });
}

export function captureEconomicExplanations(world: WorldState): void {
  captureMarkets(world);
  captureCompaniesAndBanks(world);
  captureTransactions(world);
}

export function whyFor(world: WorldState, entityType: CausalExplanation["entityType"], entityId: string): CausalExplanation | null {
  return [...world.causalExplanations].reverse().find((item) => item.entityType === entityType && item.entityId === entityId) ?? null;
}

export function explanationText(explanation: CausalExplanation | null, fallback = "Данных для объяснения пока нет."): string {
  if (!explanation || explanation.contributions.length === 0) return fallback;
  return explanation.contributions.slice().sort((left, right) => Math.abs(right.valueBps) - Math.abs(left.valueBps)).map((item) => `${item.cause}: ${item.valueBps >= 0 ? "+" : ""}${(item.valueBps / 100).toFixed(2)}%`).join("\n");
}
