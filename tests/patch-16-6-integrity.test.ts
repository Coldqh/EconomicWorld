import assert from "node:assert/strict";
import test from "node:test";
import { createWorld } from "../src/economy/create-world.ts";
import { runMonthlyMarketEcology, stepMonth } from "../src/economy/simulation.ts";
import { bankAccountBalance, bankAccountsForOwner, openBankAccount, seedDeposit as seedGenesisDeposit, transferBankAccountBalance } from "../src/core/ledger.ts";
import { executeFxConversion } from "../src/finance/fx-market.ts";
import { subscribeFund } from "../src/finance/institutional.ts";
import { valueOwnerBalanceSheet } from "../src/finance/owner-valuation.ts";
import { playerMonthCashFlow } from "../src/player/system.ts";
import { callCapital, evaluatePrivateEquityTarget, executeLbo, initializePrivateEquityFund, settlePeExitWaterfall } from "../src/private-equity/engine.ts";
import { runProcurementTender } from "../src/markets/auction-engine/integrations.ts";
import { companyValuation } from "../src/corporate/finance.ts";
import { advanceIPO, advanceMAndA, createIPOProcess, proposeMAndA, submitIpoIndication } from "../src/corporate-finance/transactions.ts";
import { issueLoan } from "../src/finance/credit.ts";
import { incorporatePlayerCompany, buyPlayerInsurance, filePlayerInsuranceClaim } from "../src/player/economic-gameplay.ts";
import { recordInsuranceLossEvent } from "../src/insurance/engine.ts";
import { runMarketMakers } from "../src/markets/market-makers/engine.ts";
import { runCrossVenueArbitrage, runTriangularFxArbitrage } from "../src/markets/arbitrage/engine.ts";

const world = () => createWorld("baseline");

function seedDeposit(state: ReturnType<typeof createWorld>, ownerId: string, bankId: string, amountMinor: number): void {
  const initialized = state.initializationComplete;
  state.initializationComplete = false;
  try { seedGenesisDeposit(state, ownerId, bankId, amountMinor); }
  finally { state.initializationComplete = initialized; }
}

test("GENESIS проводки заканчиваются до первого живого месяца", () => {
  const w = world();
  const before = w.ledger.transactions.filter((tx) => tx.kind === "GENESIS").length;
  stepMonth(w);
  const after = w.ledger.transactions.filter((tx) => tx.kind === "GENESIS").length;
  assert.equal(after, before);
});

test("глобальный guard отклоняет runtime GENESIS до любых изменений реестра", () => {
  const w = world();
  const transactionsBefore = w.ledger.transactions.length;
  const accountsBefore = w.bankAccounts.length;
  assert.throws(() => seedGenesisDeposit(w, "forbidden-runtime-owner", w.banks[0].id, 100), /RUNTIME_GENESIS_FORBIDDEN/);
  assert.equal(w.ledger.transactions.length, transactionsBefore);
  assert.equal(w.bankAccounts.length, accountsBefore);
});

test("FX дилер фондирует дефицит реальным кредитом и не печатает GENESIS", () => {
  const w = world();
  const owner = w.player.householdId;
  const source = bankAccountsForOwner(w, owner, "RUB")[0];
  const usdBank = w.banks.find((bank) => bank.baseCurrency === "USD")!;
  const opened = openBankAccount(w, owner, usdBank.id, false);
  const target = w.bankAccounts.find((account) => account.id === opened.accountId)!;
  const dealer = w.fxDealers[0];
  const dealerUsd = dealer.bankAccountIds.map((id) => w.bankAccounts.find((account) => account.id === id)!).find((account) => account.currencyId === "USD")!;
  const recipient = bankAccountsForOwner(w, w.governments.find((government) => government.currencyId === "USD")!.id, "USD")[0];
  const available = bankAccountBalance(w, dealerUsd.id);
  assert.ok(available > 10);
  assert.ok(transferBankAccountBalance(w, dealerUsd.id, recipient.id, available - 1, "TRANSFER", "Integrity liquidity drain"));
  const genesisBefore = w.ledger.transactions.filter((tx) => tx.kind === "GENESIS").length;
  const loansBefore = w.loans.filter((loan) => loan.borrowerId === dealer.id).length;
  const result = executeFxConversion(w, owner, source.id, target.id, Math.min(10_000, bankAccountBalance(w, source.id)));
  assert.equal(result.ok, true);
  assert.equal(w.ledger.transactions.filter((tx) => tx.kind === "GENESIS").length, genesisBefore);
  const dealerLoans = w.loans.filter((loan) => loan.borrowerId === dealer.id);
  assert.ok(dealerLoans.length > loansBefore);
  const funded = dealerLoans.at(-1)!;
  assert.ok(funded.originalPrincipalCents > 0 && funded.remainingPrincipalCents > 0);
});

test("FX execution spread не становится новым market mid", () => {
  const w = world();
  const owner = w.player.householdId;
  const rub = bankAccountsForOwner(w, owner, "RUB")[0];
  const usdBank = w.banks.find((bank) => bank.baseCurrency === "USD")!;
  const opened = openBankAccount(w, owner, usdBank.id, false);
  const usd = w.bankAccounts.find((account) => account.id === opened.accountId)!;
  const pair = w.fxPairs.find((item) => item.id === "RUB-USD")!;
  const beforeMid = pair.lastRatePpm;
  const result = executeFxConversion(w, owner, rub.id, usd.id, 10_000);
  assert.equal(result.ok, true);
  assert.notEqual(pair.lastRatePpm, result.quote!.ratePpm);
  assert.ok(Math.abs(pair.lastRatePpm - beforeMid) * 10_000 / beforeMid <= 26);
});

test("страховая выплата требует реального loss event и одно событие нельзя заявить дважды", () => {
  const w = world();
  const policy = buyPlayerInsurance(w)!;
  assert.ok(policy);
  assert.equal(filePlayerInsuranceClaim(w, policy.id), null);
  const loss = recordInsuranceLossEvent(w, {
    ownerId: w.player.householdId,
    assetId: "player-property-exposure",
    line: policy.line,
    category: "property-damage",
    sourceSystem: "integrity-test",
    economicLossMinor: Math.max(policy.deductibleMinor + 10, Math.round(policy.insuredValueMinor * 0.1)),
    description: "Подтверждённый имущественный ущерб",
    causeIds: ["integrity-loss"],
  })!;
  const first = filePlayerInsuranceClaim(w, policy.id);
  assert.ok(first && first.lossEventId === loss.id && first.status === "paid");
  assert.ok(first.paidMinor <= loss.economicLossMinor - policy.deductibleMinor);
  assert.ok(first.paidMinor <= policy.limitMinor);
  assert.equal(filePlayerInsuranceClaim(w, policy.id), null);
  assert.equal(w.insuranceClaims.filter((claim) => claim.lossEventId === loss.id).length, 1);
});

test("procurement reverse auction выбирает минимальную допустимую цену", () => {
  const w = world();
  const government = w.governments[0];
  const suppliers = w.companies.filter((company) => company.active && company.headquartersCountryId === government.countryId).slice(0, 3);
  assert.equal(suppliers.length, 3);
  const winner = runProcurementTender(w, government.id, suppliers.map((supplier) => supplier.id), 100_000);
  assert.equal(winner, suppliers[0].id); // bids are 75%, 79%, 83% of budget
  const auction = w.economicAuctions.at(-1)!;
  assert.equal(auction.allocations[0].clearingPriceMinor, 75_000);
});

test("default M&A consideration платится от Equity Value, а не Enterprise Value", () => {
  const w = world();
  const target = w.companies.find((company) => company.active && company.corporateStatus !== "subsidiary")!;
  const lender = w.banks.find((bank) => bank.baseCurrency === w.countries.find((country) => country.id === target.headquartersCountryId)!.currencyReference)!;
  issueLoan(w, lender.id, target.id, 2_000_000, 36, 300);
  const valuation = companyValuation(w, target.id);
  const buyer = w.companies.find((company) => company.id !== target.id && company.active)!;
  const deal = proposeMAndA(w, buyer.id, target.id, "friendly", "cash")!;
  assert.equal(deal.offerPriceMinor, Math.round(valuation.equityValueCents * 1.15));
  if (valuation.enterpriseValueCents !== valuation.equityValueCents) assert.notEqual(deal.offerPriceMinor, Math.round(valuation.enterpriseValueCents * 1.15));
});

test("новая компания игрока не клонирует живые inventories/history шаблона", () => {
  const w = world();
  const good = w.goods[0];
  const template = w.companies.find((company) => company.goodId === good.id) ?? w.companies[0];
  template.inventoryMilliUnits = 9_999_999;
  template.inventoryValueCents = 8_888_888;
  template.financialReports.push({ elapsedMonth: 999, quarter: 4, year: 2099, revenueCents: 1_000_000, cogsCents: 400_000, grossProfitCents: 600_000, wagesCents: 200_000, depreciationCents: 20_000, interestCents: 10_000, taxesCents: 50_000, netIncomeCents: 320_000, operatingCashFlowCents: 350_000, investingCashFlowCents: -50_000, financingCashFlowCents: 0, assetsCents: 2_000_000, liabilitiesCents: 500_000, equityCents: 1_500_000, inventoryCents: 100_000, productiveCapitalCents: 1_000_000 });
  for (const key of Object.keys(template.inputInventoryMilliUnits)) template.inputInventoryMilliUnits[key] = 777_777;
  const company = incorporatePlayerCompany(w, w.player.currentCityId, good.id, "CleanCo", 100_000)!;
  assert.equal(company.inventoryMilliUnits, 0);
  assert.equal(company.inventoryValueCents, 0);
  assert.ok(Object.values(company.inputInventoryMilliUnits).every((value) => value === 0));
  assert.equal(company.financialReports.length, 0);
  assert.equal(company.goodwillCents, 0);
  assert.equal(company.employees.length, 0);
});

test("подписка на обычный фонд меняет cash на asset, а не уничтожает net worth", () => {
  const w = world();
  const owner = w.player.householdId;
  const fund = w.funds.find((item) => item.status === "active" && item.type !== "etf" && item.type !== "private-capital" && item.currencyId === w.player.reportingCurrencyId)!;
  assert.ok(fund);
  const before = valueOwnerBalanceSheet(w, owner, w.player.reportingCurrencyId).totalMinor;
  const result = subscribeFund(w, fund.id, owner, 100_000);
  assert.equal(result.ok, true);
  const after = valueOwnerBalanceSheet(w, owner, w.player.reportingCurrencyId);
  assert.ok((after.components.funds ?? 0) >= 99_000);
  assert.ok(Math.abs(after.totalMinor - before) <= 2);
});

test("покупка финансового актива не попадает в бытовые расходы игрока", () => {
  const w = world();
  const fund = w.funds.find((item) => item.status === "active" && item.type !== "etf" && item.type !== "private-capital" && item.currencyId === w.player.reportingCurrencyId)!;
  assert.equal(subscribeFund(w, fund.id, w.player.householdId, 50_000).ok, true);
  const flow = playerMonthCashFlow(w);
  assert.ok(flow.investing < 0);
  assert.equal(flow.expenses, 0);
});

test("market-maker заявки остаются на venue, для которого рассчитана котировка", () => {
  const w = world();
  runMarketMakers(w);
  assert.ok(w.marketMakerQuotes.length > 0);
  for (const quote of w.marketMakerQuotes.slice(0, 20)) {
    const agent = w.marketAgents.find((item) => item.id === quote.agentId)!;
    const brokerageIds = new Set(w.brokerageAccounts.filter((account) => account.ownerId === agent.ownerId).map((account) => account.id));
    assert.ok(w.marketOrders.some((order) => brokerageIds.has(order.brokerageAccountId) && order.securityId === quote.securityId && order.exchangeId === quote.exchangeId));
  }
});

test("REAL_WORLD topology содержит реальные cross-listings и arbitrageur имеет доступ к обеим площадкам", () => {
  const w = world();
  const cross = [...new Set(w.listings.map((listing) => listing.securityId))].find((securityId) => new Set(w.listings.filter((listing) => listing.securityId === securityId).map((listing) => listing.exchangeId)).size >= 2);
  assert.ok(cross);
  const venues = w.listings.filter((listing) => listing.securityId === cross).map((listing) => listing.exchangeId);
  assert.ok(w.marketAgents.some((agent) => agent.kind === "arbitrageur" && venues.every((venue) => agent.exchangeIds.includes(venue))));
});

test("positive cross-venue edge исполняется реальными ногами и сходится через книгу", () => {
  const w = world();
  const securityId = [...new Set(w.listings.map((listing) => listing.securityId))].find((id) => new Set(w.listings.filter((listing) => listing.securityId === id).map((listing) => listing.exchangeId)).size >= 2)!;
  const listings = w.listings.filter((listing) => listing.securityId === securityId).slice(0, 2);
  listings[0].lastPriceCents = 900;
  listings[1].lastPriceCents = 1_200;
  runMonthlyMarketEcology(w);
  const record = w.arbitrageRecords.find((item) => item.type === "cross-venue");
  assert.ok(record && (record.status === "executed" || record.status === "partial"));
  assert.ok(record.legs.filter(Boolean).length >= 2);
});

test("triangular FX arbitrage подключён к автономному контуру и исполняет положительный edge", () => {
  const w = world();
  const rubUsd = w.fxPairs.find((pair) => pair.id === "RUB-USD")!;
  rubUsd.lastRatePpm = Math.round(rubUsd.lastRatePpm * 2);
  rubUsd.bidRatePpm = Math.round(rubUsd.lastRatePpm * 0.999);
  rubUsd.askRatePpm = Math.round(rubUsd.lastRatePpm * 1.001);
  runMonthlyMarketEcology(w);
  assert.ok(w.arbitrageRecords.some((record) => record.type === "fx-triangle" && record.status === "executed"));
});


test("FX-перевод между собственными валютными счетами не становится доходом или бытовым расходом", () => {
  const w = world();
  const owner = w.player.householdId;
  const rub = bankAccountsForOwner(w, owner, "RUB")[0];
  const usdBank = w.banks.find((bank) => bank.baseCurrency === "USD")!;
  const opened = openBankAccount(w, owner, usdBank.id, false);
  const usd = w.bankAccounts.find((account) => account.id === opened.accountId)!;
  const before = valueOwnerBalanceSheet(w, owner, w.player.reportingCurrencyId).totalMinor;
  const converted = executeFxConversion(w, owner, rub.id, usd.id, 100_000);
  assert.equal(converted.ok, true);
  const flow = playerMonthCashFlow(w);
  assert.equal(flow.income, 0);
  assert.equal(flow.expenses, 0);
  assert.equal(flow.investing, 0);
  assert.equal(flow.financing, 0);
  const after = valueOwnerBalanceSheet(w, owner, w.player.reportingCurrencyId).totalMinor;
  assert.ok(after <= before);
  assert.ok(before - after < 5_000); // spread/rounding only, not loss of the whole converted amount
});

test("LBO выдаёт только один отслеживаемый acquisition loan, а не по кредиту от каждого банка", () => {
  const w = world();
  const fund = w.funds.find((item) => item.type === "private-capital")!;
  w.privateEquityFunds = w.privateEquityFunds.filter((state) => state.fundId !== fund.id);
  const lp = w.households.find((household) => bankAccountsForOwner(w, household.id, fund.currencyId).length > 0)!;
  const lpFunding = bankAccountsForOwner(w, lp.id, fund.currencyId)[0];
  seedDeposit(w, lp.id, lpFunding.bankId, 3_000_000_000);
  const state = initializePrivateEquityFund(w, fund.id, fund.managerId, [{ lpId: lp.id, committedMinor: 3_000_000_000 }]);
  const target = w.companies
    .filter((company) => company.active && company.corporateStatus !== "subsidiary" && w.countries.find((country) => country.id === company.headquartersCountryId)?.currencyReference === fund.currencyId)
    .sort((left, right) => companyValuation(w, left.id).equityValueCents - companyValuation(w, right.id).equityValueCents)[0];
  target.financialReports = [];
  target.lastGrossRevenueCents = Math.max(target.lastGrossRevenueCents, 8_000_000);
  target.lastOperatingExpenseCents = 0;
  target.lastProductionMilliUnits = Math.round(target.capacityMilliUnits * 0.9);
  target.managementBps = 4_000;
  target.distressMonths = 1;
  const purchase = companyValuation(w, target.id).equityValueCents;
  assert.ok(callCapital(w, fund.id, Math.min(state.committedCapitalMinor, purchase)) > 0);
  const beforeLoans = new Set(w.loans.map((loan) => loan.id));
  const deal = executeLbo(w, fund.id, target.id, purchase);
  assert.ok(deal);
  assert.equal(deal.acquisitionLoanIds?.length, 1);
  const vehicle = w.acquisitionVehicles.find((item) => item.id === deal.acquisitionVehicleId);
  assert.ok(vehicle);
  const newLoans = w.loans.filter((loan) => !beforeLoans.has(loan.id) && loan.borrowerId === vehicle.id);
  assert.equal(newLoans.length, 1);
  assert.equal(newLoans[0].id, deal.acquisitionLoanIds![0]);
  assert.equal(w.loans.some((loan) => !beforeLoans.has(loan.id) && loan.borrowerId === fund.id), false);
  assert.equal(vehicle.debtMinor, newLoans[0].originalPrincipalCents);
  assert.equal(vehicle.sponsorEquityMinor, deal.sponsorEquityMinor);
  assert.equal(deal.sponsorEquityMinor + newLoans[0].originalPrincipalCents, deal.purchaseConsiderationMinor);
});

test("PE target approval использует Equity Value как cash consideration, а не EV", () => {
  const w = world();
  const fund = w.funds.find((item) => item.type === "private-capital")!;
  w.privateEquityFunds = w.privateEquityFunds.filter((state) => state.fundId !== fund.id);
  const lp = w.households.find((household) => bankAccountsForOwner(w, household.id, fund.currencyId).length > 0)!;
  const state = initializePrivateEquityFund(w, fund.id, fund.managerId, [{ lpId: lp.id, committedMinor: 500_000_000 }]);
  state.dryPowderMinor = 500_000_000;
  const target = w.companies.find((company) => company.active && company.corporateStatus !== "subsidiary" && w.countries.find((country) => country.id === company.headquartersCountryId)?.currencyReference === fund.currencyId)!;
  target.financialReports = [];
  target.lastGrossRevenueCents = Math.max(1, target.lastGrossRevenueCents);
  const valuation = companyValuation(w, target.id);
  assert.ok(valuation.equityValueCents > valuation.enterpriseValueCents);
  // With only 500m sponsor capacity this cash-rich target must not be approved merely because EV is smaller.
  const decision = evaluatePrivateEquityTarget(w, fund.id, target.id)!;
  assert.equal(decision.equityValueMinor, valuation.equityValueCents);
  assert.equal(decision.approved, false);
});

test("издержки устраняют арбитраж: при неположительном net edge сделок нет", () => {
  const w = world();
  const agent = w.marketAgents.find((item) => item.kind === "arbitrageur" && bankAccountsForOwner(w, item.ownerId).length >= 3)!;
  const currencies = [...new Set(bankAccountsForOwner(w, agent.ownerId).map((account) => account.currencyId))].slice(0, 3) as [string, string, string];
  const source = bankAccountsForOwner(w, agent.ownerId, currencies[0])[0];
  const recordsBefore = w.arbitrageRecords.length;
  assert.equal(runTriangularFxArbitrage(w, agent.ownerId, currencies, Math.min(10_000, bankAccountBalance(w, source.id))), false);
  assert.equal(w.arbitrageRecords.length, recordsBefore);

  const crossBefore = w.arbitrageRecords.filter((record) => record.type === "cross-venue").length;
  assert.equal(runCrossVenueArbitrage(w), 0);
  assert.equal(w.arbitrageRecords.filter((record) => record.type === "cross-venue").length, crossBefore);
});

test("PE waterfall распределяет доход только по фактически внесённому капиталу", () => {
  const w = world();
  const fund = w.funds.find((item) => item.type === "private-capital")!;
  w.privateEquityFunds = w.privateEquityFunds.filter((state) => state.fundId !== fund.id);
  const eligible = w.households.filter((household) => bankAccountsForOwner(w, household.id, fund.currencyId).length > 0).slice(0, 2);
  assert.equal(eligible.length, 2);
  const state = initializePrivateEquityFund(w, fund.id, fund.managerId, eligible.map((lp) => ({ lpId: lp.id, committedMinor: 100 })));
  state.lpCommitments[0].calledMinor = 100;
  state.lpCommitments[1].calledMinor = 0;
  state.calledCapitalMinor = 100;
  seedDeposit(w, fund.id, w.bankAccounts.find((account) => account.id === fund.bankAccountId)!.bankId, 100);
  w.privateEquityDeals.push({ id: "integrity-waterfall", fundId: fund.id, targetCompanyId: w.companies[0].id, sponsorEquityMinor: 100, seniorDebtMinor: 0, subordinatedDebtMinor: 0, purchaseConsiderationMinor: 100, outstandingDebtMinor: 0, entryMonth: 0, exitMonth: null, exitProceedsMinor: 0, leverageCovenantBps: 10_000, interestCoverageCovenantBps: 0, status: "owned", cashFlows: [{ elapsedMonth: 0, amountMinor: -100 }] });
  const firstAccount = bankAccountsForOwner(w, eligible[0].id, fund.currencyId)[0];
  const secondAccount = bankAccountsForOwner(w, eligible[1].id, fund.currencyId)[0];
  const firstBefore = bankAccountBalance(w, firstAccount.id);
  const secondBefore = bankAccountBalance(w, secondAccount.id);
  assert.equal(settlePeExitWaterfall(w, "integrity-waterfall", 100), true);
  assert.equal(bankAccountBalance(w, firstAccount.id) - firstBefore, 100);
  assert.equal(bankAccountBalance(w, secondAccount.id) - secondBefore, 0);
});

test("обычный 12-месячный мир создаёт рыночные заявки каждый месяц, а не раз в квартал", () => {
  const w = world();
  const activeMonths: number[] = [];
  for (let month = 0; month < 12; month += 1) {
    const elapsedMonth = w.clock.elapsedMonths;
    stepMonth(w);
    if (w.marketOrders.some((order) => order.placedAtMonth === elapsedMonth)) activeMonths.push(elapsedMonth);
  }
  assert.equal(activeMonths.length, 12);
  assert.ok(activeMonths.some((month) => month % 3 !== 0));
});

test("закрытые M&A и IPO не исполняют расчёты повторно через legacy runtime", () => {
  const w = world();
  const candidates = w.companies.filter((company) => company.active && company.corporateStatus !== "subsidiary").sort((left, right) => left.marketShareBps - right.marketShareBps);
  const target = candidates[0];
  target.distressMonths = Math.max(1, target.distressMonths);
  const currency = w.countries.find((country) => country.id === target.headquartersCountryId)!.currencyReference;
  const buyer = candidates.find((company) => company.id !== target.id && bankAccountsForOwner(w, company.id, currency).length > 0)!;
  target.marketShareBps = Math.min(target.marketShareBps, 1_000);
  buyer.marketShareBps = Math.min(buyer.marketShareBps, 1_000);
  const deal = proposeMAndA(w, buyer.id, target.id, "friendly", "cash")!;
  seedDeposit(w, buyer.id, w.bankAccounts.find((account) => account.ownerId === buyer.id && account.currencyId === currency)!.bankId, deal.offerPriceMinor * 2);
  for (let index = 0; index < 8 && !["closed", "failed"].includes(deal.status); index += 1) advanceMAndA(w, deal.id);
  assert.equal(deal.status, "closed", JSON.stringify({ approval: deal.shareholderApprovalBps, antitrust: deal.antitrustResult, conditions: deal.conditions, elections: deal.tenderElections.length }));
  const transactionsAfterMa = w.ledger.transactions.length;
  for (let index = 0; index < 3; index += 1) advanceMAndA(w, deal.id);
  assert.equal(w.ledger.transactions.length, transactionsAfterMa);

  const company = incorporatePlayerCompany(w, w.player.currentCityId, w.goods[0].id, "Idempotent IPO", 100_000)!;
  const ipo = createIPOProcess(w, company.id, 10, 0)!;
  for (let index = 0; index < 4; index += 1) advanceIPO(w, ipo.id);
  assert.equal(ipo.stage, "bookbuilding");
  const ipoCurrency = w.countries.find((country) => country.id === company.headquartersCountryId)!.currencyReference;
  const investor = w.households.find((household) => household.id !== w.player.householdId && bankAccountsForOwner(w, household.id, ipoCurrency).length > 0)!;
  seedDeposit(w, investor.id, w.bankAccounts.find((account) => account.ownerId === investor.id && account.currencyId === ipoCurrency)!.bankId, ipo.indicativeHighMinor * 20);
  assert.equal(submitIpoIndication(w, ipo.id, investor.id, 10, ipo.indicativeHighMinor), true);
  for (let index = 0; index < 4 && !["completed", "failed"].includes(ipo.stage); index += 1) advanceIPO(w, ipo.id);
  assert.equal(ipo.stage, "completed");
  const transactionsAfterIpo = w.ledger.transactions.length;
  for (let index = 0; index < 3; index += 1) advanceIPO(w, ipo.id);
  assert.equal(w.ledger.transactions.length, transactionsAfterIpo);
});
