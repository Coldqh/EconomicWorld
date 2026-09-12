import { gdpReconciliationTolerance } from "../accounting/national-accounts.ts";
import { accountIds, balanceOf, entityBook, sumAccounts, sumAccountsByCategoryInstrument, sumAccountsByCurrencyCategoryInstrument } from "../core/ledger.ts";
import type { InvariantResult, LedgerAccount, WorldState } from "../domain/model.ts";

function result(section: InvariantResult["section"], id: string, title: string, ok: boolean, detail: string, differenceCents?: number): InvariantResult {
  return { section, id, title, ok, detail, differenceCents };
}

function monetaryValuesMatch(left: number, right: number): boolean {
  // REAL_WORLD stocks can exceed Number.MAX_SAFE_INTEGER after aggregation in
  // low-value currencies.  Individual entries remain integral; this tolerance
  // only absorbs the few ULPs introduced while summing macro balances.
  return Math.abs(left - right) <= Math.max(1, Math.ceil(Math.max(Math.abs(left), Math.abs(right)) * Number.EPSILON * 64));
}

export function checkInvariants(world: WorldState): InvariantResult[] {
  const results: InvariantResult[] = [];
  const brokenTransaction = world.ledger.transactions.find((transaction) => transaction.entries.filter((entry) => entry.side === "debit").reduce((sum, entry) => sum + entry.amountCents, 0) !== transaction.entries.filter((entry) => entry.side === "credit").reduce((sum, entry) => sum + entry.amountCents, 0));
  results.push(result("Бухгалтерия", "double-entry", "Дебеты равны кредитам", !brokenTransaction, brokenTransaction ? `Нарушение в ${brokenTransaction.id}` : `${world.ledger.transactions.length.toLocaleString("ru-RU")} транзакций сбалансированы`));
  const mixedCurrencyTransaction = world.ledger.transactions.find((transaction) => new Set(transaction.entries.map((entry) => world.ledger.accounts[entry.accountId]?.currency)).size !== 1);
  results.push(result("Бухгалтерия", "single-currency-legs", "Каждая проводка выражена в одной валюте", !mixedCurrencyTransaction, mixedCurrencyTransaction?.id ?? "FX исполняется двумя связанными ledger-ногами"));

  const depositAssets = sumAccountsByCategoryInstrument(world, "asset", "deposit");
  const depositLiabilities = sumAccountsByCategoryInstrument(world, "liability", "deposit");
  results.push(result("Деньги", "deposit-mirror", "Депозиты имеют банковскую сторону", monetaryValuesMatch(depositAssets, depositLiabilities), `Клиенты / банки: ${(depositAssets / 100).toLocaleString("ru-RU")} ₽`, depositAssets - depositLiabilities));
  const currencyDepositMismatch = world.currencies.find((currency) => {
    const assets = sumAccountsByCurrencyCategoryInstrument(world, currency.id, "asset", "deposit");
    const liabilities = sumAccountsByCurrencyCategoryInstrument(world, currency.id, "liability", "deposit");
    return !monetaryValuesMatch(assets, liabilities);
  });
  results.push(result("Деньги", "deposit-mirror-by-currency", "Депозиты сверены по каждой валюте", !currencyDepositMismatch, currencyDepositMismatch?.id ?? `${world.currencies.length} валют сверены`));

  const brokenBankAccount = world.bankAccounts.find((account) => {
    const bank = world.banks.find((item) => item.id === account.bankId);
    return !bank || bank.baseCurrency !== account.currencyId
      || world.ledger.accounts[account.ledgerDepositAccountId]?.currency !== account.currencyId
      || world.ledger.accounts[account.ledgerBankLiabilityAccountId]?.currency !== account.currencyId;
  });
  const duplicatedPrimary = [...new Set(world.bankAccounts.map((account) => account.ownerId))].find((ownerId) => world.bankAccounts.filter((account) => account.ownerId === ownerId && account.status === "active" && account.isPrimary).length !== 1);
  results.push(result("Деньги", "bank-account-registry", "Банковские счета и валюты связаны", !brokenBankAccount && !duplicatedPrimary, brokenBankAccount?.id ?? duplicatedPrimary ?? `${world.bankAccounts.length} счетов`));

  const reserveAssets = sumAccounts(world, (account) => account.category === "asset" && account.instrument === "reserve" && world.banks.some((bank) => bank.id === account.ownerId));
  const reserveLiabilities = sumAccounts(world, (account) => account.category === "liability" && account.instrument === "reserve" && world.centralBanks.some((bank) => bank.id === account.ownerId));
  results.push(result("Ликвидность банков", "reserve-mirror", "Резервы сверены с центральным банком", reserveAssets === reserveLiabilities, `Резервы: ${(reserveAssets / 100).toLocaleString("ru-RU")} ₽`, reserveAssets - reserveLiabilities));

  const negativeReserves = world.banks.filter((bank) => balanceOf(world, accountIds.bankReserve(bank.id)) < 0);
  results.push(result("Ликвидность банков", "non-negative-reserves", "Резервы банков неотрицательны", negativeReserves.length === 0, negativeReserves.length ? negativeReserves.map((bank) => bank.name).join(", ") : "Межбанк и окно ЦБ закрывают расчётный дефицит"));

  const loanAssets = sumAccounts(world, (account) => account.category === "asset" && account.instrument === "loan" && !account.id.includes(":margin-loan:") && world.banks.some((bank) => bank.id === account.ownerId));
  const loanLiabilities = sumAccounts(world, (account) => account.category === "liability" && account.instrument === "loan" && !account.id.includes(":margin-loan:"));
  const contracts = world.loans.filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  results.push(result("Кредит", "loan-mirror", "Кредитор, должник и договор совпадают", monetaryValuesMatch(loanAssets, loanLiabilities) && monetaryValuesMatch(loanAssets, contracts), `Основной долг: ${(contracts / 100).toLocaleString("ru-RU")} ₽`, loanAssets - contracts));

  const owners = [...new Set(Object.values(world.ledger.accounts).map((account) => account.ownerId))];
  let brokenBook = "";
  let bookDifference = 0;
  for (const ownerId of owners) {
    const book = entityBook(world, ownerId);
    const difference = book.assets + book.expenses - book.liabilities - book.equity - book.income;
    const grossBook = Math.max(Math.abs(book.assets), Math.abs(book.liabilities), Math.abs(book.equity), Math.abs(book.income), Math.abs(book.expenses));
    // Macro books can be far above Number.MAX_SAFE_INTEGER. Transactions remain
    // exactly balanced; this tolerance only absorbs ULPs from aggregate summation.
    const bookTolerance = Math.max(1, Math.ceil(grossBook * Number.EPSILON * 1_024));
    if (Math.abs(difference) > bookTolerance) { brokenBook = ownerId; bookDifference = difference; break; }
  }
  results.push(result("Бухгалтерия", "accounting-equation", "Балансовые уравнения выполняются", !brokenBook, brokenBook ? `Не сходится книга ${brokenBook}` : `${owners.length} книг прошли проверку`, bookDifference));

  const negativeDeposits = world.bankAccounts.filter((account) => balanceOf(world, account.ledgerDepositAccountId) < 0).map((account) => account.id);
  results.push(result("Деньги", "non-negative-money", "Нет неразрешённого овердрафта", negativeDeposits.length === 0, negativeDeposits.length ? negativeDeposits.join(", ") : "Все депозитные счета неотрицательны"));

  const allowedMoneyChanges = new Set(["GENESIS", "LOAN_ISSUED", "LOAN_PRINCIPAL", "LOAN_INTEREST", "MARGIN_FINANCE", "MARGIN_REPAYMENT", "OPEN_MARKET_PURCHASE", "OPEN_MARKET_SALE", "QE", "QT", "DEPOSIT_INSURANCE"]);
  const unauthorized = world.ledger.transactions.find((transaction) => {
    const change = transaction.entries.reduce((sum, entry) => {
      const account: LedgerAccount = world.ledger.accounts[entry.accountId];
      return account.category === "asset" && account.instrument === "deposit" ? sum + (entry.side === "debit" ? entry.amountCents : -entry.amountCents) : sum;
    }, 0);
    return change !== 0 && !allowedMoneyChanges.has(transaction.kind);
  });
  results.push(result("Деньги", "authorized-money", "Изменения денежной массы авторизованы", !unauthorized, unauthorized ? unauthorized.id : "Только начальные проводки и банковский кредит меняют сумму депозитов"));
  const postInitializationGenesis = world.ledger.transactions.find((transaction) => transaction.kind === "GENESIS" && transaction.elapsedMonth > 0);
  results.push(result("Деньги", "post-init-genesis", "После инициализации нет стартовых проводок", !postInitializationGenesis, postInitializationGenesis?.id ?? "Runtime GENESIS запрещён глобальным guard"));

  const negativeGoods = world.companies.filter((company) => company.inventoryMilliUnits < 0 || Object.values(company.inputInventoryMilliUnits).some((value) => value < 0));
  results.push(result("Товары", "goods-conservation", "Товарные остатки неотрицательны", negativeGoods.length === 0, negativeGoods.length ? negativeGoods[0].name : `${world.goodsMovements.length.toLocaleString("ru-RU")} движений товаров`));

  const inventoryMismatch = world.companies.find((company) => {
    const ledgerValue = balanceOf(world, accountIds.finishedInventory(company.id)) + world.goods.reduce((sum, good) => sum + balanceOf(world, accountIds.inputInventory(company.id, good.id)), 0);
    const modelValue = company.inventoryValueCents + Object.values(company.inputInventoryValueCents).reduce((sum, value) => sum + value, 0);
    return ledgerValue !== modelValue;
  });
  results.push(result("Бухгалтерия", "inventory-valuation", "Оценка запасов сверена с книгой", !inventoryMismatch, inventoryMismatch ? inventoryMismatch.name : "Физические и денежные регистры связаны"));

  const capitalMismatch = world.companies.find((company) => balanceOf(world, accountIds.productiveCapital(company.id)) !== company.productiveCapital.bookValueCents);
  results.push(result("Бухгалтерия", "productive-capital", "Производственный капитал сверён", !capitalMismatch, capitalMismatch ? capitalMismatch.name : "Амортизация и инвестиции отражены в книге"));

  const employmentIssue = world.households.find((household) => household.employerId && !world.companies.find((company) => company.id === household.employerId && company.active && company.employees.includes(household.id)));
  results.push(result("Игрок", "employment-links", "Рынок труда согласован", !employmentIssue, employmentIssue?.id ?? "Работник и работодатель ссылаются друг на друга"));

  const person = world.people.find((item) => item.id === world.player.personId);
  const playerHousehold = world.households.find((item) => item.id === world.player.householdId);
  const playerOk = Boolean(person && playerHousehold && person.householdId === playerHousehold.id && playerHousehold.personIds.includes(person.id));
  results.push(result("Игрок", "player-link", "Игрок является экономическим агентом", playerOk, playerOk ? "Персона, домохозяйство, банк и книга связаны" : "Нарушена связь игрока"));

  const latest = world.metricsHistory.at(-1);
  const tolerance = latest ? gdpReconciliationTolerance(latest) : 100;
  const gap = latest?.gdpReconciliationGapCents ?? 0;
  results.push(result("Национальные счета", "gdp-reconciliation", "ВВП согласован двумя методами", Math.abs(gap) <= tolerance, `Расхождение: ${(gap / 100).toLocaleString("ru-RU")} ₽`, gap));

  const representedPopulation = world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) + world.people.length;
  const invalidPopulation = world.populationCohorts.find((cohort) => cohort.populationCount < 0 || cohort.employedCount < 0 || cohort.employedCount > cohort.populationCount);
  results.push(result("Население", "population-cohorts", "Когорты населения согласованы", !invalidPopulation && representedPopulation >= 1_000_000, `${representedPopulation.toLocaleString("ru-RU")} жителей`));

  const representedFirms = world.firmCohorts.reduce((sum, cohort) => sum + cohort.firmCount, 0) + world.companies.length;
  results.push(result("Производительность", "firm-cohorts", "Агрегированные фирмы учтены", representedFirms >= 10_000 && world.firmCohorts.every((cohort) => cohort.firmCount >= 0 && cohort.inventoryMilliUnits >= 0), `${representedFirms.toLocaleString("ru-RU")} фирм`));

  const brokenCity = world.cities.find((city) => !world.countries.some((country) => country.id === city.countryId) || city.costOfLivingCents <= 0 || city.population < 0);
  const brokenCountry = world.countries.find((country) => country.cityIds.some((id) => !world.cities.some((city) => city.id === id)));
  results.push(result("География", "world-references", "Страны и города связаны", !brokenCity && !brokenCountry && world.countries.length >= 10 && world.cities.length >= 30, `${world.countries.length} стран · ${world.cities.length} городов`));

  const brokenHousing = world.housingCohorts.find((cohort) => cohort.availableUnits < 0 || cohort.availableUnits > cohort.totalUnits || cohort.monthlyRentCents <= 0 || cohort.salePriceCents <= 0);
  const brokenProperty = world.properties.find((property) => !world.housingCohorts.some((cohort) => cohort.id === property.sourceCohortId) || !world.cities.some((city) => city.id === property.cityId));
  results.push(result("Жильё", "housing-stock", "Жилищный фонд согласован", !brokenHousing && !brokenProperty, `${world.housingCohorts.reduce((sum, cohort) => sum + cohort.totalUnits, 0).toLocaleString("ru-RU")} объектов`));

  const brokenProgram = world.universityPrograms.find((program) => !world.universities.some((university) => university.id === program.universityId) || program.occupiedSeats < 0 || program.occupiedSeats > program.capacity || program.durationMonths < 12);
  const brokenUniversity = world.universities.find((university) => !world.cities.some((city) => city.id === university.cityId) || university.programIds.some((id) => !world.universityPrograms.some((program) => program.id === id)));
  results.push(result("Образование", "universities", "Вузы, программы и места согласованы", !brokenProgram && !brokenUniversity, `${world.universities.length} вузов · ${world.universityPrograms.length} программ`));

  const archiveIssue = world.ledgerArchives.find((archive) => !monetaryValuesMatch(archive.debitCents, archive.creditCents));
  const budgetIssue = world.fidelity.materializedPersonIds.length > world.fidelity.budgets.maxActivePersons;
  results.push(result("Производительность", "fidelity-budget", "Уровни детализации укладываются в бюджет", !budgetIssue, `${world.fidelity.materializedPersonIds.length}/${world.fidelity.budgets.maxActivePersons} материализованных персон`));
  results.push(result("Бухгалтерия", "ledger-archives", "Архивы реестра сбалансированы", !archiveIssue, `${world.ledgerArchives.length} архивных сегментов`));

  const brokenCapTable = world.equitySecurities.find((security) => {
    const registered = world.equityHoldings.filter((holding) => holding.securityId === security.id).reduce((sum, holding) => sum + holding.shares, 0);
    return registered !== security.sharesOutstanding || registered < 0;
  });
  results.push(result("Собственность", "cap-table", "Реестр акций сходится", !brokenCapTable, brokenCapTable?.id ?? `${world.equitySecurities.length} выпусков сверены`));

  const brokenAcquisitionStructure = world.privateEquityDeals.find((deal) => {
    if (!deal.acquisitionVehicleId) return Boolean(deal.acquisitionLoanIds?.length);
    const vehicle = world.acquisitionVehicles.find((item) => item.id === deal.acquisitionVehicleId && item.dealId === deal.id && item.fundId === deal.fundId && item.targetCompanyId === deal.targetCompanyId);
    if (!vehicle) return true;
    const acquisitionLoans = new Set(deal.acquisitionLoanIds ?? []);
    if (world.loans.some((loan) => acquisitionLoans.has(loan.id) && loan.borrowerId !== vehicle.id)) return true;
    if (deal.status === "owned" || deal.status === "covenant-breach") {
      const securityId = world.companies.find((company) => company.id === deal.targetCompanyId)?.equitySecurityId;
      return !securityId || !world.equityHoldings.some((holding) => holding.ownerId === vehicle.id && holding.securityId === securityId && holding.shares > 0);
    }
    return false;
  });
  results.push(result("Собственность", "pe-acquisition-structure", "Фонд, холдинговая компания, цель и долг по покупке связаны", !brokenAcquisitionStructure, brokenAcquisitionStructure?.id ?? `${world.acquisitionVehicles.length} структур владения сверено`));

  const brokenInsuranceClaim = world.insuranceClaims.find((claim) => {
    const policy = world.insurancePolicies.find((item) => item.id === claim.policyId);
    const loss = world.insuranceLossEvents.find((item) => item.id === claim.lossEventId);
    return !policy || !loss || loss.ownerId !== policy.policyholderId || loss.line !== policy.line || claim.paidMinor > claim.reservedMinor || claim.paidMinor > Math.max(0, loss.economicLossMinor - policy.deductibleMinor);
  });
  const overpaidLoss = world.insuranceLossEvents.find((loss) => world.insuranceClaims.filter((claim) => claim.lossEventId === loss.id).reduce((sum, claim) => sum + claim.paidMinor, 0) > loss.economicLossMinor);
  results.push(result("Страхование", "covered-loss-limit", "Выплаты опираются на реальный покрытый ущерб", !brokenInsuranceClaim && !overpaidLoss, brokenInsuranceClaim?.id ?? overpaidLoss?.id ?? `${world.insuranceClaims.length} требований сверены`));

  const brokenBond = world.corporateBonds.find((bond) => {
    const claims = world.bondHoldings.filter((holding) => holding.bondId === bond.id).reduce((sum, holding) => sum + holding.faceValueCents, 0);
    return claims !== bond.outstandingFaceValueCents || claims < 0;
  });
  results.push(result("Собственность", "bond-registry", "Требования по облигациям сходятся", !brokenBond, brokenBond?.id ?? `${world.corporateBonds.length} выпусков сверены`));

  const brokenOrder = world.marketOrders.find((order) => order.quantity <= 0 || order.remainingQuantity < 0 || order.remainingQuantity > order.quantity || (order.type === "limit" && (!order.limitPriceCents || order.limitPriceCents <= 0)));
  results.push(result("Рынки", "order-book", "Заявки корректны", !brokenOrder, brokenOrder?.id ?? `${world.marketOrders.length} заявок`));

  const allOrderIds = new Set([...world.marketOrders, ...world.archivedMarketOrders].map((order) => order.id));
  const brokenTrade = world.marketTrades.find((trade) => trade.quantity <= 0 || trade.priceCents <= 0 || !allOrderIds.has(trade.buyOrderId) || !allOrderIds.has(trade.sellOrderId));
  results.push(result("Рынки", "trade-registry", "Сделки связаны с заявками", !brokenTrade, brokenTrade?.id ?? `${world.marketTrades.length} сделок`));

  const brokenScope = world.countries.find((country) => country.companyIds.some((id) => !world.companies.some((company) => company.id === id && company.headquartersCountryId === country.id)) || country.bankIds.some((id) => !world.banks.some((bank) => bank.id === id && bank.countryId === country.id)) || !world.centralBanks.some((bank) => bank.id === country.centralBankId));
  results.push(result("География", "country-economy-scope", "Экономические контуры стран связаны", !brokenScope, brokenScope?.name ?? `${world.countries.length} локальных контуров`));

  const brokenMonetaryArea = world.monetaryAreas.find((area) => !world.centralBanks.some((bank) => bank.id === area.monetaryAuthorityId && bank.setsPolicyRate && bank.currencyId === area.currencyId)
    || area.memberCountryIds.some((countryId) => { const country = world.countries.find((item) => item.id === countryId); return !country || country.monetaryAreaId !== area.id || country.currencyReference !== area.currencyId; }));
  results.push(result("Деньги", "monetary-areas", "Денежные зоны имеют одну власть", !brokenMonetaryArea, brokenMonetaryArea?.name ?? `${world.monetaryAreas.length} денежных зон`));

  const brokenFundUnits = world.funds.find((fund) => world.fundUnitHoldings.filter((holding) => holding.fundId === fund.id).reduce((sum, holding) => sum + holding.unitsMicros, 0) !== fund.unitsOutstandingMicros);
  const brokenFundNav = world.funds.find((fund) => {
    const cash = balanceOf(world, world.bankAccounts.find((account) => account.id === fund.bankAccountId)?.ledgerDepositAccountId ?? "");
    const securities = world.equityHoldings.filter((holding) => holding.ownerId === fund.id).reduce((sum, holding) => sum + holding.shares * (world.listings.find((listing) => listing.securityId === holding.securityId)?.lastPriceCents ?? Math.round(holding.costBasisCents / Math.max(1, holding.shares))), 0);
    const corporateBonds = world.bondHoldings.filter((holding) => holding.holderId === fund.id).reduce((sum, holding) => sum + holding.costBasisCents, 0);
    const sovereignBonds = world.sovereignBondHoldings.filter((holding) => holding.holderId === fund.id).reduce((sum, holding) => {
      const bond = world.sovereignBonds.find((item) => item.id === holding.bondId);
      return !bond || bond.outstandingFaceValueMinor <= 0 ? sum : sum + Math.round(bond.marketPriceMinor * holding.faceValueMinor / bond.outstandingFaceValueMinor);
    }, 0);
    const liabilities = world.marginAccounts.filter((account) => account.ownerId === fund.id && account.status !== "closed").reduce((sum, account) => sum + account.borrowedMinor, 0)
      + world.repoAgreements.filter((repo) => repo.cashBorrowerId === fund.id && repo.status === "active").reduce((sum, repo) => sum + repo.cashAmountMinor, 0);
    return cash + securities + corporateBonds + sovereignBonds - liabilities !== fund.navMinor;
  });
  results.push(result("Фонды", "fund-units", "Паи фондов сходятся", !brokenFundUnits, brokenFundUnits?.name ?? `${world.funds.length} фондов`));
  results.push(result("Фонды", "fund-nav", "Активы минус обязательства равны NAV", !brokenFundNav, brokenFundNav?.name ?? "NAV сверён с реальными позициями"));

  const doublePledged = world.collateralPledges.find((pledge) => pledge.status === "active" && pledge.assetType === "security" && world.collateralPledges.filter((item) => item.status === "active" && item.ownerId === pledge.ownerId && item.assetType === "security" && item.assetId === pledge.assetId).reduce((sum, item) => sum + item.quantity, 0) > (world.equityHoldings.find((holding) => holding.ownerId === pledge.ownerId && holding.securityId === pledge.assetId)?.shares ?? 0));
  const brokenMarginExposure = world.marginAccounts.find((account) => !world.primeBrokerExposures.some((exposure) => exposure.marginAccountId === account.id && exposure.primeBrokerId === account.primeBrokerId) || account.borrowedMinor < 0);
  results.push(result("Обеспечение", "collateral-availability", "Залог нельзя использовать дважды", !doublePledged, doublePledged?.id ?? `${world.collateralPledges.filter((item) => item.status === "active").length} активных залогов`));
  results.push(result("Обеспечение", "prime-broker-exposure", "Маржинальные счета связаны с прайм-брокером", !brokenMarginExposure, brokenMarginExposure?.id ?? `${world.marginAccounts.length} маржинальных счетов`));

  const validUnderlying = (contract: WorldState["derivativeContracts"][number]): boolean => {
    const underlying = contract.underlying;
    if (underlying.kind === "equity") return world.equitySecurities.some((security) => security.id === underlying.securityId);
    if (underlying.kind === "bond") return world.corporateBonds.some((bond) => bond.id === underlying.bondId) || world.sovereignBonds.some((bond) => bond.id === underlying.bondId);
    if (underlying.kind === "currency-pair") return world.fxPairs.some((pair) => pair.id === underlying.pairId);
    if (underlying.kind === "interest-rate") return world.monetaryAreas.some((area) => area.id === underlying.monetaryAreaId);
    if (underlying.kind === "index") return world.exchanges.some((exchange) => exchange.id === underlying.indexId) || world.countries.some((country) => country.id === underlying.indexId);
    if (underlying.kind === "commodity") return world.globalCommodities.some((commodity) => commodity.id === underlying.commodityId);
    return world.corporateBonds.some((bond) => bond.id === underlying.obligationId) || world.sovereignBonds.some((bond) => bond.id === underlying.obligationId) || world.loans.some((loan) => loan.id === underlying.obligationId) || world.companies.some((company) => company.id === underlying.obligationId);
  };
  const brokenDerivative = world.derivativeContracts.find((contract) => contract.notionalMinor <= 0 || contract.maturityMonth < contract.startMonth || contract.counterpartyIds[0] === contract.counterpartyIds[1] || !validUnderlying(contract));
  results.push(result("Деривативы", "derivative-contracts", "Договоры деривативов имеют базовый актив и номинал", !brokenDerivative, brokenDerivative?.id ?? `${world.derivativeContracts.length} договоров`));

  const brokenOpenInterest = world.optionMarketSeries.find((series) => series.openInterest !== world.derivativeContracts.reduce((sum, contract) => contract.type === "option" && contract.seriesId === series.id && (contract.status === "active" || contract.status === "margin-call") ? sum + contract.quantity : sum, 0));
  results.push(result("Деривативы", "option-open-interest", "Открытый интерес опционов сверен", !brokenOpenInterest, brokenOpenInterest?.id ?? `${world.optionMarketSeries.length} серий`));

  const doublePledgedSovereign = world.collateralPledges.find((pledge) => pledge.status === "active" && pledge.assetType === "sovereign-bond" && world.collateralPledges.filter((item) => item.status === "active" && item.ownerId === pledge.ownerId && item.assetType === "sovereign-bond" && item.assetId === pledge.assetId).reduce((sum, item) => sum + item.quantity, 0) > (world.sovereignBondHoldings.find((holding) => holding.holderId === pledge.ownerId && holding.bondId === pledge.assetId)?.faceValueMinor ?? 0));
  results.push(result("Обеспечение", "sovereign-collateral-availability", "Государственный долг нельзя заложить дважды", !doublePledgedSovereign, doublePledgedSovereign?.id ?? "Залоги госдолга обеспечены"));

  const brokenClearedFuture = world.derivativeContracts.find((contract) => contract.type === "future" && contract.ccpId && (contract.status === "active" || contract.status === "margin-call") && (() => {
    const positions = world.clearedPositions.filter((position) => position.contractId === contract.id && position.status === "open");
    return positions.length !== 2 || positions.reduce((sum, position) => sum + position.netQuantity, 0) !== 0;
  })());
  const brokenClearingMember = world.clearingMemberAccounts.find((account) => !world.clearingHouses.some((house) => house.id === account.clearingHouseId) || account.initialMarginMinor < 0 || account.defaultFundContributionMinor < 0);
  results.push(result("Клиринг", "clearing-positions", "Клиринг сохраняет нулевую сумму позиций", !brokenClearedFuture && !brokenClearingMember, brokenClearedFuture?.id ?? brokenClearingMember?.id ?? `${world.clearingHouses.length} клиринговых домов`));

  const brokenSovereignRegistry = world.sovereignBonds.find((bond) => !monetaryValuesMatch(world.sovereignBondHoldings.filter((holding) => holding.bondId === bond.id).reduce((sum, holding) => sum + holding.faceValueMinor, 0), bond.outstandingFaceValueMinor));
  const brokenGovernmentBudget = world.governmentBudgets.find((budget) => !monetaryValuesMatch(budget.publicDebtMinor, world.sovereignBonds.filter((bond) => bond.governmentId === budget.governmentId && bond.status !== "matured").reduce((sum, bond) => sum + bond.outstandingFaceValueMinor + bond.arrearsCouponMinor, 0)));
  results.push(result("Государственный долг", "sovereign-registry", "Государственный долг сверен с держателями", !brokenSovereignRegistry && !brokenGovernmentBudget, brokenSovereignRegistry?.id ?? brokenGovernmentBudget?.governmentId ?? `${world.sovereignBonds.length} выпусков`));

  const brokenYieldCurve = world.countries.find((country) => {
    const curve = [...world.yieldCurveHistory].reverse().find((snapshot) => snapshot.countryId === country.id);
    return !curve || curve.points.length !== 5 || curve.points.some((point, index) => point.maturityMonths <= 0 || (index > 0 && point.maturityMonths <= curve.points[index - 1].maturityMonths));
  });
  results.push(result("Государственный долг", "yield-curves", "Кривые доходности имеют пять сроков", !brokenYieldCurve, brokenYieldCurve?.name ?? `${world.countries.length} кривых`));

  const brokenCentralBankSheet = world.centralBankBalanceSheets.find((sheet) => sheet.governmentSecuritiesMinor !== world.sovereignBondHoldings.filter((holding) => holding.holderId === sheet.centralBankId).reduce((sum, holding) => sum + holding.bookValueMinor, 0) || sheet.bankReservesMinor < 0 || !world.centralBanks.some((bank) => bank.id === sheet.centralBankId && bank.currencyId === sheet.currencyId));
  results.push(result("Денежная политика", "central-bank-balance", "Баланс центрального банка сверен", !brokenCentralBankSheet, brokenCentralBankSheet?.centralBankId ?? `${world.centralBankBalanceSheets.length} балансов`));
  const negativeResource = world.resourceDeposits.find((deposit) => deposit.extractableReservesMilliUnits < 0 || deposit.extractableReservesMilliUnits > deposit.provenReservesMilliUnits);
  results.push(result("Товары", "resource-conservation", "Добываемые запасы не создаются из ничего", !negativeResource, negativeResource?.id ?? `${world.resourceDeposits.length} месторождений сверены`));
  const badTrade = world.tradeFlows.find((flow) => flow.quantityMilliUnits <= 0 || flow.exporterCountryId === flow.importerCountryId || flow.status === "settled" && flow.paymentTransactionIds.length === 0);
  results.push(result("Товары", "trade-goods-money", "Поставка имеет товарную и денежную ноги", !badTrade, badTrade?.id ?? `${world.tradeFlows.length} поставок сверены`));
  const brokenBop = world.balanceOfPayments.find((point) => point.currentAccountUsdMinor + point.capitalAccountUsdMinor + point.financialAccountUsdMinor + point.reserveChangeUsdMinor + point.errorsAndOmissionsUsdMinor !== point.reconciliationGapUsdMinor || point.reconciliationWarning);
  results.push(result("Национальные счета", "bop-reconciliation", "Платёжный баланс сходится", !brokenBop, brokenBop ? `${brokenBop.countryId}:${brokenBop.elapsedMonth}` : `${world.balanceOfPayments.length} периодов сверены`));
  const brokenCountryPeriod = Object.values(world.countryEconomicAccounts.closedByCountry).find((period) => period.status !== "closed" || period.elapsedMonth !== world.clock.elapsedMonths && period.elapsedMonth !== world.clock.elapsedMonths - 1 || !monetaryValuesMatch(period.reconciliation.productionGdpMinor, period.reconciliation.expenditureGdpMinor) || !monetaryValuesMatch(period.reconciliation.productionGdpMinor, period.reconciliation.incomeGdpMinor));
  results.push(result("Национальные счета", "country-monthly-period", "Три метода ВВП сходятся в месячном периоде", !brokenCountryPeriod, brokenCountryPeriod ? `${brokenCountryPeriod.countryId}:${brokenCountryPeriod.elapsedMonth}` : `${Object.keys(world.countryEconomicAccounts.closedByCountry).length} стран сверены`));
  const brokenHouseholdAccount = world.countryEconomicAccounts.householdAccounts.find((account) => account.status !== "closed" || !monetaryValuesMatch(account.budgetGapMinor, 0));
  const brokenFirmAccount = world.countryEconomicAccounts.firmAccounts.find((account) => account.status !== "closed" || !monetaryValuesMatch(account.pnlGapMinor, 0));
  const brokenFiscalBridge = Object.values(world.countryEconomicAccounts.closedByCountry).find((period) => !monetaryValuesMatch(period.fiscal.cashGapMinor, 0));
  const brokenDebtBridge = Object.values(world.countryEconomicAccounts.closedByCountry).find((period) => Math.abs(period.financial.debtBridgeGapMinor) > Math.max(1, Math.ceil(Math.abs(period.financial.closingGrossDebtMinor) * Number.EPSILON * 32)));
  const brokenExternalPeriod = Object.values(world.countryEconomicAccounts.closedByCountry).find((period) => !monetaryValuesMatch(period.external.reconciliationGapMinor, 0));
  const brokenRepresentation = world.countryEconomicAccounts.representations.find((item) => !monetaryValuesMatch(item.explicitCarveOutMinor + item.residualTargetMinor, item.baselineTargetMinor));
  results.push(result("Национальные счета", "household-period", "Бюджеты household cohorts сходятся", !brokenHouseholdAccount, brokenHouseholdAccount?.cohortId ?? `${world.countryEconomicAccounts.householdAccounts.length} счетов`));
  results.push(result("Национальные счета", "firm-period", "P&L firm cohorts сходится", !brokenFirmAccount, brokenFirmAccount?.cohortId ?? `${world.countryEconomicAccounts.firmAccounts.length} счетов`));
  results.push(result("Бухгалтерия", "fiscal-cash-bridge", "Денежный мост государства сходится", !brokenFiscalBridge, brokenFiscalBridge?.countryId ?? "Все страны"));
  results.push(result("Государственный долг", "sovereign-debt-bridge", "Мост государственного долга сходится", !brokenDebtBridge, brokenDebtBridge?.countryId ?? "Все страны"));
  results.push(result("Национальные счета", "external-period", "Внешний счёт и BOP сходятся", !brokenExternalPeriod, brokenExternalPeriod?.countryId ?? "Все страны"));
  results.push(result("Производительность", "representation-carveout", "Explicit и residual representation не пересекаются", !brokenRepresentation, brokenRepresentation?.sectorId ?? `${world.countryEconomicAccounts.representations.length} секторов`));
  const overCapacityRoute = world.tradeRoutes.find((route) => route.usedCapacityMilliUnits > route.capacityMilliUnits);
  results.push(result("Товары", "route-capacity", "Логистика не превышает пропускную способность", !overCapacityRoute, overCapacityRoute?.id ?? `${world.tradeRoutes.length} маршрутов`));
  return results;
}
