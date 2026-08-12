import { accountIds, ensureAccount, ensureEntityAccounts, seedDeposit, seedNonCashAsset } from "../core/ledger.ts";
import type { MetricPoint, WorldState } from "../domain/model.ts";
import { createWorld } from "../economy/create-world.ts";
import { seedMacroeconomics } from "../economy/macroeconomics.ts";
import { seedClearingHouses } from "../finance/clearing.ts";
import { seedDerivativeMarkets } from "../finance/derivatives.ts";

type LegacyWorld = Omit<Partial<WorldState>, "schemaVersion" | "saveVersion"> & { schemaVersion?: number; saveVersion?: number };

function migrateMetric(metric: Partial<MetricPoint>, world: WorldState): MetricPoint {
  const prices = metric.priceByGoodCents ?? Object.fromEntries(world.goods.map((good) => [good.id, good.basePriceCents]));
  const nominal = metric.nominalGdpCents ?? 0;
  return {
    elapsedMonth: metric.elapsedMonth ?? 0,
    nominalGdpCents: nominal,
    gdpValueAddedCents: metric.gdpValueAddedCents ?? nominal,
    gdpExpenditureCents: metric.gdpExpenditureCents ?? nominal,
    gdpReconciliationGapCents: metric.gdpReconciliationGapCents ?? 0,
    realGdpCents: metric.realGdpCents ?? nominal,
    realGdpGrowthBps: metric.realGdpGrowthBps ?? 0,
    gdpDeflatorBps: metric.gdpDeflatorBps ?? 10_000,
    householdConsumptionCents: metric.householdConsumptionCents ?? 0,
    capitalFormationCents: metric.capitalFormationCents ?? 0,
    governmentConsumptionCents: metric.governmentConsumptionCents ?? 0,
    inventoryChangeCents: metric.inventoryChangeCents ?? 0,
    cpiBps: metric.cpiBps ?? 10_000,
    monthlyInflationBps: metric.monthlyInflationBps ?? 0,
    annualInflationBps: metric.annualInflationBps ?? 0,
    cpiContributionBpsByGood: metric.cpiContributionBpsByGood ?? Object.fromEntries(world.goods.map((good) => [good.id, good.consumptionWeightBps])),
    unemploymentBps: metric.unemploymentBps ?? 0,
    depositMoneyCents: metric.depositMoneyCents ?? 0,
    loanStockCents: metric.loanStockCents ?? 0,
    activeCompanies: metric.activeCompanies ?? world.companies.filter((company) => company.active).length,
    employedHouseholds: metric.employedHouseholds ?? world.households.filter((household) => household.employerId).length,
    policyRateBps: metric.policyRateBps ?? world.centralBank.policyRateBps,
    priceByGoodCents: prices,
    productionByGoodMilliUnits: metric.productionByGoodMilliUnits ?? Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    salesByGoodMilliUnits: metric.salesByGoodMilliUnits ?? Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    companyMetrics: (metric.companyMetrics ?? []).map((item) => ({ ...item, cogsCents: item.cogsCents ?? 0, netIncomeCents: item.netIncomeCents ?? item.revenueCents - item.expenseCents })),
    marketConcentrationBpsByGood: metric.marketConcentrationBpsByGood ?? Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    priceElasticityBpsByGood: metric.priceElasticityBpsByGood ?? Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    marketShareBpsByCompany: metric.marketShareBpsByCompany ?? Object.fromEntries(world.companies.map((company) => [company.id, 0])),
  };
}

export function migrateWorldState(raw: unknown): WorldState {
  const legacy = structuredClone(raw) as LegacyWorld;
  if ((legacy.schemaVersion ?? 1) > 9 || (legacy.saveVersion ?? 1) > 9) {
    throw new Error("Сохранение создано более новой версией приложения");
  }
  if (legacy.schemaVersion === 9 && legacy.saveVersion === 9) return legacy as WorldState;
  if (legacy.schemaVersion === 8 && legacy.saveVersion === 8) {
    const template = createWorld();
    return {
      ...legacy,
      schemaVersion: 9 as const,
      saveVersion: 9 as const,
      baselineReference: { ...template.baselineReference, ...(legacy.baselineReference ?? {}), replayObservedExternalShocks: false },
      companies: (legacy.companies ?? template.companies).map((company) => ({ ...company, baselineFinancials: null })),
      banks: (legacy.banks ?? template.banks).map((bank) => ({ ...bank, baselineFinancials: null })),
      firmCohorts: (legacy.firmCohorts ?? template.firmCohorts).map((cohort) => ({ ...template.firmCohorts.find((item) => item.id === cohort.id), ...cohort })),
      countryScaleReconciliations: [], realWorldInitializationReports: [], tradeSectors: [], logisticsSectors: [], bankingSectorCohorts: [], sovereignHolderCohorts: [],
      calibratedParameters: template.calibratedParameters, countryCalibratedParameters: {}, policyInterventions: [], macroContributionEvents: [], physicalCommodityFlows: [], externalClaims: [],
    } as WorldState;
  }
  if (legacy.schemaVersion === 7 && legacy.saveVersion === 7) {
    const template = createWorld();
    const migrated = {
      ...template,
      ...legacy,
      schemaVersion: 9 as const,
      saveVersion: 9 as const,
      baselineReference: template.baselineReference,
      companies: (legacy.companies ?? template.companies).map((company) => ({ ...company, globalInputConstraintBps: company.globalInputConstraintBps ?? 10_000 })),
      history: {
        ...template.history,
        ...(legacy.history ?? {}),
        policy: { ...template.history.policy, ...(legacy.history?.policy ?? {}) },
        compactedTradeRecords: legacy.history?.compactedTradeRecords ?? [],
      },
      globalCommodities: template.globalCommodities,
      commodityMarkets: template.commodityMarkets,
      resourceDeposits: template.resourceDeposits,
      countryCommodityStates: template.countryCommodityStates,
      energyBalances: [], tradeRoutes: template.tradeRoutes, ports: template.ports, tradeFlows: [], strategicReserves: template.strategicReserves,
      inputOutputCoefficients: template.inputOutputCoefficients, countrySectorInventories: template.countrySectorInventories,
      balanceOfPayments: [], internationalInvestmentPositions: [], foreignDirectInvestments: [], internationalPortfolioPositions: [], crossBorderLoans: [],
      reservePortfolios: template.reservePortfolios, fxRegimes: template.fxRegimes, fxPressureHistory: [],
      nextTradeFlowId: 1, nextFdiId: 1, nextInternationalPositionId: 1, nextCrossBorderLoanId: 1,
    } as WorldState;
    return migrated;
  }
  const template = createWorld();
  const world = {
    ...template,
    ...legacy,
    schemaVersion: 9 as const,
    saveVersion: 9 as const,
    goods: template.goods.map((good) => ({ ...good, ...(legacy.goods?.find((item) => item.id === good.id) ?? {}), essential: good.essential })),
    countries: template.countries.map((base) => ({ ...base, ...(legacy.countries?.find((item) => item.id === base.id) ?? {}) })),
    cities: template.cities.map((base) => ({ ...base, ...(legacy.cities?.find((item) => item.id === base.id) ?? {}) })),
    populationCohorts: template.populationCohorts.map((base) => ({ ...base, ...(legacy.populationCohorts?.find((item) => item.id === base.id) ?? {}) })),
    firmCohorts: template.firmCohorts.map((base) => ({ ...base, ...(legacy.firmCohorts?.find((item) => item.id === base.id) ?? {}) })),
    housingCohorts: template.housingCohorts.map((base) => ({ ...base, ...(legacy.housingCohorts?.find((item) => item.id === base.id) ?? {}) })),
    people: template.people.map((base) => ({ ...base, ...(legacy.people?.find((item) => item.id === base.id) ?? {}) })),
    households: template.households.map((base) => ({ ...base, ...(legacy.households?.find((item) => item.id === base.id) ?? {}), personIds: base.personIds, savingsPreferenceBps: (legacy.households?.find((item) => item.id === base.id) as Partial<typeof base> | undefined)?.savingsPreferenceBps ?? base.savingsPreferenceBps, preferenceWeightsBps: base.preferenceWeightsBps, preferredSellerByGoodId: {} })),
    universities: template.universities.map((base) => ({ ...base, ...(legacy.universities?.find((item) => item.id === base.id) ?? {}) })),
    universityPrograms: template.universityPrograms.map((base) => ({ ...base, ...(legacy.universityPrograms?.find((item) => item.id === base.id) ?? {}), attendanceMode: (legacy.universityPrograms?.find((item) => item.id === base.id) as Partial<typeof base> | undefined)?.attendanceMode ?? base.attendanceMode })),
    companies: template.companies.map((base) => {
      const old = legacy.companies?.find((item) => item.id === base.id) as Partial<typeof base> | undefined;
      const quantity = old?.inventoryMilliUnits ?? base.inventoryMilliUnits;
      const good = template.goods.find((item) => item.id === (old?.goodId ?? base.goodId))!;
      const inventoryValue = old?.inventoryValueCents ?? Math.round(quantity * good.basePriceCents * 0.65 / 1_000);
      return { ...base, ...old, inventoryValueCents: inventoryValue, inputInventoryValueCents: old?.inputInventoryValueCents ?? Object.fromEntries(template.goods.map((item) => [item.id, 0])), productiveCapital: old?.productiveCapital ?? base.productiveCapital, retainedEarningsCents: old?.retainedEarningsCents ?? 0, financialReports: old?.financialReports ?? [] };
    }),
    banks: template.banks.map((base) => ({ ...base, ...(legacy.banks?.find((item) => item.id === base.id) ?? {}), minimumLiquidityRatioBps: base.minimumLiquidityRatioBps })),
    centralBank: { ...template.centralBank, ...legacy.centralBank, policyRateHistory: legacy.centralBank?.policyRateHistory ?? [{ elapsedMonth: legacy.clock?.elapsedMonths ?? 0, rateBps: legacy.centralBank?.policyRateBps ?? template.centralBank.policyRateBps }] },
    centralBanks: template.centralBanks.map((base) => ({ ...base, ...(legacy.centralBanks?.find((item) => item.id === base.id) ?? {}) })),
    brokers: template.brokers.map((base) => ({ ...base, ...(legacy.brokers?.find((item) => item.id === base.id) ?? {}), supportedCurrencyIds: base.supportedCurrencyIds, marginAvailable: base.marginAvailable })),
    bankFunding: legacy.bankFunding ?? [],
    nationalAccounts: legacy.nationalAccounts ?? template.nationalAccounts,
    occupations: legacy.occupations ?? template.occupations,
    player: { ...template.player, ...(legacy.player ?? {}) },
    nextFundingId: legacy.nextFundingId ?? 1,
    derivativeContracts: [],
    optionMarketSeries: [],
    nettingSets: [],
    clearingHouses: [],
    clearingMemberAccounts: [],
    clearedPositions: [],
    derivativeMarginCalls: [],
    derivativeExposureHistory: [],
    sovereignBonds: [],
    sovereignBondHoldings: [],
    sovereignAuctions: [],
    yieldCurveHistory: [],
    governmentBudgets: [],
    centralBankBalanceSheets: [],
    monetaryPolicyDecisions: [],
    depositInsuranceSchemes: [],
    countryMacroStates: [],
    macroHistory: [],
    nextDerivativeId: 1,
    nextDerivativeMarginCallId: 1,
    nextNettingSetId: 1,
    nextClearingPositionId: 1,
    nextSovereignBondId: 1,
    nextSovereignHoldingId: 1,
    nextSovereignAuctionId: 1,
    nextMonetaryDecisionId: 1,
  } as WorldState;
  world.diagnostics = { ...template.diagnostics, ...(legacy.diagnostics ?? {}) };
  world.history = { ...template.history, ...(legacy.history ?? {}), policy: { ...template.history.policy, ...(legacy.history?.policy ?? {}) } };
  for (const fund of world.funds) {
    fund.strategyProfileId ??= fund.type === "hedge" ? "HEDGE_MACRO" : fund.type === "pension" ? "PENSION_CONSERVATIVE" : fund.type === "etf" ? "INDEX_FUND" : "ACTIVE_LONG_ONLY";
    fund.primeBrokerIds ??= world.banks.filter((bank) => bank.countryId === world.assetManagers.find((manager) => manager.id === fund.managerId)?.countryId).slice(0, 2).map((bank) => bank.id);
  }
  world.centralBank = world.centralBanks.find((bank) => bank.id === world.centralBank.id) ?? world.centralBanks.find((bank) => bank.id === "central-bank-ru")!;
  const localBankId = (countryId: string, offset = 0): string => {
    const banks = world.banks.filter((bank) => bank.countryId === countryId);
    return banks[offset % Math.max(1, banks.length)]?.id ?? world.banks[0].id;
  };
  for (const oldCompany of legacy.companies ?? []) {
    if (world.companies.some((company) => company.id === oldCompany.id)) continue;
    const reference = template.companies.find((company) => company.goodId === oldCompany.goodId) ?? template.companies[0];
    world.companies.push({ ...structuredClone(reference), ...oldCompany });
  }
  for (const [index, household] of world.households.entries()) {
    const countryId = world.cities.find((city) => city.id === household.cityId)?.countryId ?? "ru";
    if (!world.banks.some((bank) => bank.id === household.bankId)) household.bankId = localBankId(countryId, index);
  }
  for (const [index, company] of world.companies.entries()) {
    const city = world.cities.find((item) => item.id === company.cityId) ?? world.cities[0];
    company.headquartersCityId = city.id;
    company.headquartersCountryId = city.countryId;
    if (!world.banks.some((bank) => bank.id === company.bankId)) company.bankId = localBankId(city.countryId, index);
  }
  for (const [index, cohort] of world.populationCohorts.entries()) {
    cohort.countryId = world.cities.find((city) => city.id === cohort.cityId)?.countryId ?? cohort.countryId ?? "ru";
    if (!world.banks.some((bank) => bank.id === cohort.bankId)) cohort.bankId = localBankId(cohort.countryId, index);
  }
  for (const [index, cohort] of world.firmCohorts.entries()) {
    cohort.countryId = world.cities.find((city) => city.id === cohort.cityId)?.countryId ?? cohort.countryId ?? "ru";
    if (!world.banks.some((bank) => bank.id === cohort.bankId)) cohort.bankId = localBankId(cohort.countryId, index);
  }
  for (const [index, university] of world.universities.entries()) {
    const countryId = world.cities.find((city) => city.id === university.cityId)?.countryId ?? "ru";
    if (!world.banks.some((bank) => bank.id === university.bankId)) university.bankId = localBankId(countryId, index);
  }
  for (const country of world.countries) {
    const base = template.countries.find((item) => item.id === country.id);
    country.companyIds = world.companies.filter((company) => company.headquartersCountryId === country.id).map((company) => company.id);
    country.bankIds = world.banks.filter((bank) => bank.countryId === country.id).map((bank) => bank.id);
    country.universityIds = world.universities.filter((university) => world.cities.find((city) => city.id === university.cityId)?.countryId === country.id).map((university) => university.id);
    country.governmentId = base?.governmentId ?? `government-${country.id}`;
    country.centralBankId = base?.centralBankId ?? `central-bank-${country.id}`;
    country.monetaryAreaId = base?.monetaryAreaId ?? `money-area-${country.currencyReference.toLowerCase()}`;
    country.exchangeIds = base?.exchangeIds ?? [`exchange-${country.id}`];
    country.industries = base?.industries ?? [];
  }
  world.metricsHistory = (legacy.metricsHistory ?? []).map((metric) => migrateMetric(metric, world));
  if (!legacy.bankAccounts?.length) {
    // V4 used the same RUB ledger namespace for the entire world. Keep its history
    // immutable under shadow account ids, then make the live accounts currency-aware.
    const historicalAccountIds = new Map<string, string>();
    for (const account of Object.values(world.ledger.accounts)) {
      const historicalId = `${account.id}:legacy-v4`;
      historicalAccountIds.set(account.id, historicalId);
      world.ledger.accounts[historicalId] = { ...account, id: historicalId };
      world.ledger.balances[historicalId] = 0;
    }
    for (const transaction of world.ledger.transactions) {
      for (const entry of transaction.entries) entry.accountId = historicalAccountIds.get(entry.accountId) ?? entry.accountId;
    }
    const ownerCurrency = new Map<string, string>();
    const currencyForCountry = (countryId: string): string => world.countries.find((country) => country.id === countryId)?.currencyReference ?? "RUB";
    for (const bank of world.banks) ownerCurrency.set(bank.id, bank.baseCurrency);
    for (const bank of world.centralBanks) ownerCurrency.set(bank.id, bank.currencyId);
    for (const government of world.governments) ownerCurrency.set(government.id, government.currencyId);
    for (const household of world.households) ownerCurrency.set(household.id, currencyForCountry(world.cities.find((city) => city.id === household.cityId)?.countryId ?? "ru"));
    for (const company of world.companies) ownerCurrency.set(company.id, currencyForCountry(company.headquartersCountryId));
    for (const cohort of world.populationCohorts) ownerCurrency.set(cohort.id, currencyForCountry(cohort.countryId));
    for (const cohort of world.firmCohorts) ownerCurrency.set(cohort.id, currencyForCountry(cohort.countryId));
    for (const university of world.universities) ownerCurrency.set(university.id, currencyForCountry(world.cities.find((city) => city.id === university.cityId)?.countryId ?? "ru"));
    for (const broker of world.brokers) ownerCurrency.set(broker.id, world.banks.find((bank) => bank.id === broker.bankId)?.baseCurrency ?? "RUB");
    for (const exchange of world.exchanges) ownerCurrency.set(exchange.id, world.banks.find((bank) => bank.id === exchange.bankId)?.baseCurrency ?? "RUB");
    for (const manager of world.assetManagers) {
      ownerCurrency.set(manager.id, currencyForCountry(manager.countryId));
      ownerCurrency.set(manager.ownerId, currencyForCountry(manager.countryId));
    }
    for (const fund of world.funds) ownerCurrency.set(fund.id, fund.currencyId);
    for (const scheme of legacy.depositInsuranceSchemes ?? []) ownerCurrency.set(scheme.id, scheme.currencyId);
    for (const ccp of legacy.clearingHouses ?? []) ownerCurrency.set(ccp.id, ccp.currencyId);
    for (const account of Object.values(world.ledger.accounts)) {
      if (!account.id.endsWith(":legacy-v4")) account.currency = ownerCurrency.get(account.ownerId) ?? account.currency;
    }
    world.bankAccounts = structuredClone(template.bankAccounts);
    for (const account of world.bankAccounts) {
      const legacyDeposit = world.ledger.accounts[account.ledgerDepositAccountId];
      if (legacyDeposit && legacyDeposit.currency !== account.currencyId) {
        const candidateId = accountIds.bankAccountDeposit(account.ownerId, account.bankId, account.currencyId);
        const replacementId = candidateId === account.ledgerDepositAccountId ? `${candidateId}:v5` : candidateId;
        ensureAccount(world.ledger, replacementId, account.ownerId, `Депозит ${account.currencyId}`, "asset", account.currencyId);
        world.ledger.balances[replacementId] = (world.ledger.balances[replacementId] ?? 0) + (world.ledger.balances[account.ledgerDepositAccountId] ?? 0);
        world.ledger.balances[account.ledgerDepositAccountId] = 0;
        account.ledgerDepositAccountId = replacementId;
      } else {
        ensureAccount(world.ledger, account.ledgerDepositAccountId, account.ownerId, `Депозит ${account.currencyId}`, "asset", account.currencyId);
      }
      const legacyLiability = world.ledger.accounts[account.ledgerBankLiabilityAccountId];
      if (legacyLiability && legacyLiability.currency !== account.currencyId) {
        const candidateId = accountIds.bankAccountLiability(account.bankId, account.id);
        const replacementId = candidateId === account.ledgerBankLiabilityAccountId ? `${candidateId}:v5` : candidateId;
        ensureAccount(world.ledger, replacementId, account.bankId, `Депозитный счёт ${account.ownerId}`, "liability", account.currencyId);
        world.ledger.balances[replacementId] = (world.ledger.balances[replacementId] ?? 0) + (world.ledger.balances[account.ledgerBankLiabilityAccountId] ?? 0);
        world.ledger.balances[account.ledgerBankLiabilityAccountId] = 0;
        account.ledgerBankLiabilityAccountId = replacementId;
      } else {
        ensureAccount(world.ledger, account.ledgerBankLiabilityAccountId, account.bankId, `Депозитный счёт ${account.ownerId}`, "liability", account.currencyId);
      }
    }
    for (const household of world.households) {
      const account = world.bankAccounts.find((item) => item.ownerId === household.id && item.bankId === household.bankId) ?? world.bankAccounts.find((item) => item.ownerId === household.id);
      household.primaryBankAccountId = account?.id ?? "";
      if (account) account.isPrimary = true;
    }
    world.player.bankAccountIds = world.bankAccounts.filter((account) => account.ownerId === world.player.householdId).map((account) => account.id);
  }
  for (const loan of world.loans) {
    const bank = world.banks.find((item) => item.id === loan.lenderBankId);
    loan.currencyId = loan.currencyId ?? bank?.baseCurrency ?? "RUB";
    loan.settlementBankAccountId = loan.settlementBankAccountId
      ?? world.bankAccounts.find((account) => account.ownerId === loan.borrowerId && account.bankId === loan.lenderBankId && account.currencyId === loan.currencyId)?.id
      ?? world.bankAccounts.find((account) => account.ownerId === loan.borrowerId && account.currencyId === loan.currencyId)?.id
      ?? "";
  }
  const dealer = world.fxDealers[0];
  if (dealer) {
    for (const currency of world.currencies) {
      const account = world.bankAccounts.find((item) => item.ownerId === dealer.id && item.currencyId === currency.id);
      if (account && (world.ledger.balances[account.ledgerDepositAccountId] ?? 0) === 0) seedDeposit(world, dealer.id, account.bankId, 50_000_000_00);
    }
  }
  for (const company of world.companies) {
    const currency = world.countries.find((country) => country.id === company.headquartersCountryId)?.currencyReference ?? "RUB";
    ensureEntityAccounts(world.ledger, company.id, currency);
    if (!world.ledger.accounts[accountIds.finishedInventory(company.id)] && company.inventoryValueCents > 0) seedNonCashAsset(world, company.id, accountIds.finishedInventory(company.id), "Готовая продукция", company.inventoryValueCents);
    for (const good of world.goods) {
      const inputValue = company.inputInventoryValueCents[good.id] ?? 0;
      if (!world.ledger.accounts[accountIds.inputInventory(company.id, good.id)] && inputValue > 0) seedNonCashAsset(world, company.id, accountIds.inputInventory(company.id, good.id), `Материалы · ${good.name}`, inputValue);
    }
    if (!world.ledger.accounts[accountIds.productiveCapital(company.id)] && company.productiveCapital.bookValueCents > 0) seedNonCashAsset(world, company.id, accountIds.productiveCapital(company.id), "Производственный капитал", company.productiveCapital.bookValueCents);
  }
  seedMacroeconomics(world);
  seedClearingHouses(world);
  seedDerivativeMarkets(world);
  return world;
}
