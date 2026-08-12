import { accountIds, openBankAccount, bankAccountBalance, ensureAccount, postTransaction, seedDeposit, transferBankAccountBalance } from "../core/ledger.ts";
import { transferShares } from "../corporate/finance.ts";
import { GLOBAL_COMMODITIES, INPUT_OUTPUT_COEFFICIENTS, MAJOR_PORTS, RESOURCE_ENDOWMENT_INDEX } from "../data/global-taxonomy.ts";
import { REAL_COUNTRY_PACKS } from "../data/real-world/country-packs.ts";
import type {
  BalanceOfPaymentsRecord, CrossBorderLoanExposure, ForeignDirectInvestment, InternationalInvestmentPosition,
  InternationalPortfolioPosition, ReservePortfolio, TradeFlow, TradeRoute, WorldState,
} from "../domain/model.ts";
import { convertMinor, fxRatePpm } from "../finance/currencies.ts";
import { createFuture } from "../finance/derivatives.ts";
import { executeFxConversion } from "../finance/fx-market.ts";
import { settleFinancialPayment } from "../finance/financial-settlement.ts";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const countryCurrency = (world: WorldState, countryId: string): string => world.countries.find((country) => country.id === countryId)?.currencyReference ?? "USD";
const countryOfEntity = (world: WorldState, entityId: string): string | null => {
  const company = world.companies.find((item) => item.id === entityId);
  if (company) return company.headquartersCountryId;
  const bank = world.banks.find((item) => item.id === entityId);
  if (bank) return bank.countryId;
  const fund = world.funds.find((item) => item.id === entityId);
  if (fund) return world.assetManagers.find((item) => item.id === fund.managerId)?.countryId ?? null;
  return world.tradeSectors.find((item) => item.id === entityId)?.countryId ?? world.logisticsSectors.find((item) => item.id === entityId)?.countryId ?? null;
};
const bankForCurrency = (world: WorldState, currencyId: string): string | null => world.banks.find((bank) => bank.baseCurrency === currencyId)?.id ?? null;
const accountFor = (world: WorldState, ownerId: string, currencyId: string) => world.bankAccounts.find((account) => account.ownerId === ownerId && account.currencyId === currencyId && account.status === "active") ?? null;

function ensureCurrencyAccount(world: WorldState, ownerId: string, currencyId: string) {
  const existing = accountFor(world, ownerId, currencyId);
  if (existing) return existing;
  const bankId = bankForCurrency(world, currencyId);
  if (!bankId) return null;
  const opened = openBankAccount(world, ownerId, bankId);
  return opened.accountId ? world.bankAccounts.find((account) => account.id === opened.accountId) ?? null : null;
}

function extendTradeFinance(world: WorldState, importer: WorldState["tradeSectors"][number], shortfall: number, currencyId: string): void {
  shortfall = Math.floor(shortfall);
  if (shortfall <= 0) return;
  const account = ensureCurrencyAccount(world, importer.id, currencyId);
  if (!account) return;
  const bankLoanAsset = `trade-finance:${importer.bankId}:asset:${importer.id}:${currencyId}`;
  const borrowerLiability = `trade-finance:${importer.id}:liability:${importer.bankId}:${currencyId}`;
  ensureAccount(world.ledger, bankLoanAsset, importer.bankId, `Торговое финансирование ${importer.id}`, "asset", currencyId);
  ensureAccount(world.ledger, borrowerLiability, importer.id, `Торговое финансирование ${importer.bankId}`, "liability", currencyId);
  const maximumEntry = Number.MAX_SAFE_INTEGER - 1_000_000;
  for (let remaining = shortfall; remaining > 0;) {
    const tranche = Math.min(remaining, maximumEntry);
    postTransaction(world, "LOAN_ISSUED", `Месячная линия торгового финансирования ${importer.id}`, [
      { accountId: account.ledgerDepositAccountId, side: "debit", amountCents: tranche },
      { accountId: borrowerLiability, side: "credit", amountCents: tranche },
      { accountId: bankLoanAsset, side: "debit", amountCents: tranche },
      { accountId: account.ledgerBankLiabilityAccountId, side: "credit", amountCents: tranche },
    ]);
    remaining -= tranche;
  }
  importer.tradeFinanceLiabilityUsdMinor += convertMinor(world, shortfall, currencyId, "USD") ?? 0;
}

function fundMonthlyTradeBudgets(world: WorldState): void {
  if (world.baselineReference.mode !== "REAL_WORLD") return;
  for (const importer of world.tradeSectors) {
    const currencyId = countryCurrency(world, importer.countryId);
    const account = ensureCurrencyAccount(world, importer.id, currencyId);
    const target = convertMinor(world, Math.round(importer.importBudgetUsdMinor * 1.12), "USD", currencyId) ?? 0;
    if (account && bankAccountBalance(world, account.id) < target) extendTradeFinance(world, importer, target - bankAccountBalance(world, account.id), currencyId);
  }
}

function routeId(origin: string, destination: string): string {
  return `route-${origin}-${destination}`;
}

function createRoutes(world: WorldState): TradeRoute[] {
  const routes: TradeRoute[] = [];
  for (const origin of world.countries) {
    for (const destination of world.countries) {
      if (origin.id === destination.id) continue;
      const european = ["de", "fr", "gb", "it", "es", "nl"].includes(origin.id) && ["de", "fr", "gb", "it", "es", "nl"].includes(destination.id);
      const adjacent = `${origin.id}:${destination.id}`.match(/ru:(de|nl)|ca:us|us:ca|de:(fr|nl)|fr:(de|es|it)|it:(fr|es)|es:(fr|it)|nl:(de|fr)/);
      const mode = adjacent ? "rail" : european ? "road" : "sea";
      const modeCost = mode === "sea" ? 32 : mode === "rail" ? 55 : 78;
      const originTrade = world.tradeSectors.find((item) => item.countryId === origin.id);
      const destinationTrade = world.tradeSectors.find((item) => item.countryId === destination.id);
      // Route capacity is shared by all commodity markets during the month.
      // Size it for the whole bilateral basket, not for one representative
      // cargo, otherwise the first commodity silently crowds out the other 19.
      const economicCapacity = Math.max(25_000_000, Math.round(Math.min(originTrade?.exportCapacityUsdMinor ?? 0, destinationTrade?.importBudgetUsdMinor ?? 0) / 8));
      routes.push({ id: routeId(origin.id, destination.id), originCountryId: origin.id, destinationCountryId: destination.id, mode, capacityMilliUnits: economicCapacity, usedCapacityMilliUnits: 0, costUsdMinorPerUnit: modeCost, transitDays: mode === "sea" ? 22 : mode === "rail" ? 9 : 5, active: true });
    }
  }
  return routes;
}

export function seedGlobalEconomy(world: WorldState): void {
  world.globalCommodities = structuredClone(GLOBAL_COMMODITIES);
  world.commodityMarkets = GLOBAL_COMMODITIES.map((commodity) => ({ commodityId: commodity.id, spotPriceUsdMinor: commodity.baseSpotPriceMinor, previousSpotPriceUsdMinor: commodity.baseSpotPriceMinor, globalProductionMilliUnits: 0, globalConsumptionMilliUnits: 0, globalInventoryMilliUnits: 0, monthlyVolumeMilliUnits: 0, shortageBps: 0 }));
  world.resourceDeposits = Object.entries(RESOURCE_ENDOWMENT_INDEX).flatMap(([countryId, endowments]) => Object.entries(endowments).map(([commodityId, indexBps]) => {
    const market = GLOBAL_COMMODITIES.find((commodity) => commodity.id === commodityId)!;
    const tradeBudget = world.tradeSectors.find((item) => item.countryId === countryId)?.exportCapacityUsdMinor ?? 100_000_000;
    const monthlyCapacity = Math.max(250_000, Math.round(tradeBudget * indexBps / 10_000 / 8 * 1_000 / Math.max(1, market.baseSpotPriceMinor)));
    const reserves = monthlyCapacity * 360;
    return { id: `deposit-${countryId}-${commodityId}`, countryId, commodityId, provenReservesMilliUnits: reserves, extractableReservesMilliUnits: Math.round(reserves * 0.82), monthlyCapacityMilliUnits: monthlyCapacity, extractionCostUsdMinor: Math.max(25, Math.round(market.baseSpotPriceMinor * (11_000 - indexBps / 2) / 20_000)), infrastructureBps: clamp(6_400 + Math.round(indexBps / 4), 6_000, 9_500), technologyBps: clamp(6_800 + Math.round(indexBps / 5), 6_500, 9_500), depletionBps: 0, active: true, sourceType: "ESTIMATED" as const };
  }));
  const openingInventoryMilliUnits = world.baselineReference.mode === "REAL_WORLD" ? 2_500_000 : 12_000;
  world.countryCommodityStates = world.countries.flatMap((country) => GLOBAL_COMMODITIES.map((commodity) => ({ countryId: country.id, commodityId: commodity.id, productionMilliUnits: 0, consumptionMilliUnits: 0, inventoryMilliUnits: commodity.storable ? openingInventoryMilliUnits : 0, domesticDemandMilliUnits: 0, importDemandMilliUnits: 0, exportSupplyMilliUnits: 0, marginalCostUsdMinor: commodity.baseSpotPriceMinor, householdDemandMilliUnits: 0, industrialDemandMilliUnits: 0, investmentDemandMilliUnits: 0, resourceDemandMilliUnits: 0 })));
  world.energyBalances = [];
  world.tradeRoutes = createRoutes(world);
  world.ports = structuredClone(MAJOR_PORTS);
  world.tradeFlows = [];
  world.strategicReserves = world.countries.flatMap((country) => ["crude-oil", "natural-gas", "wheat"].map((commodityId) => ({ id: `reserve-${country.id}-${commodityId}`, countryId: country.id, commodityId, inventoryMilliUnits: 8_000, targetMonthsOfConsumptionBps: 20_000, lastAction: "hold" as const })));
  world.inputOutputCoefficients = structuredClone(INPUT_OUTPUT_COEFFICIENTS);
  world.countrySectorInventories = world.countries.flatMap((country) => INPUT_OUTPUT_COEFFICIENTS.map((coefficient) => ({ countryId: country.id, sectorId: coefficient.outputSectorId, inputCommodityId: coefficient.inputCommodityId, inventoryMilliUnits: 12_000, requiredMilliUnits: 0, shortageBps: 0 })));
  world.balanceOfPayments = [];
  world.internationalInvestmentPositions = [];
  world.foreignDirectInvestments = [];
  world.internationalPortfolioPositions = [];
  world.crossBorderLoans = [];
  world.externalClaims = [];
  world.physicalCommodityFlows = [];
  world.fxRegimes = world.countries.map((country) => ({ countryId: country.id, regime: country.id === "nl" ? "PEG" as const : ["ru", "kr"].includes(country.id) ? "MANAGED_FLOAT" as const : "FLOATING" as const, anchorCurrencyId: country.currencyReference === "EUR" ? "EUR" : "USD", targetRatePpm: fxRatePpm(world, country.currencyReference, country.currencyReference === "EUR" ? "EUR" : "USD") ?? 1_000_000, bandBps: country.id === "nl" ? 50 : 500, defenseCapacityUsdMinor: 0, status: "stable" as const }));
  world.fxPressureHistory = [];
  seedReservePortfolios(world);
}

function seedReservePortfolios(world: WorldState): void {
  const weights: Record<string, number> = { USD: 5_500, EUR: 2_500, JPY: 700, GBP: 500, CAD: 400, KRW: 200, RUB: 200 };
  world.reservePortfolios = world.countries.map((country): ReservePortfolio => {
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === country.id);
    const desiredUsdMinor = Math.max(80_000_000, Math.round((pack?.reservesUsd ?? 50_000_000_000) * 100));
    const centralBankId = country.centralBankId;
    const accountIdsByCurrency: Record<string, string> = {};
    for (const [currencyId, weightBps] of Object.entries(weights)) {
      const bankId = bankForCurrency(world, currencyId);
      if (!bankId) continue;
      const usdSlice = Math.round(desiredUsdMinor * weightBps / 10_000);
      const amount = convertMinor(world, usdSlice, "USD", currencyId) ?? usdSlice;
      seedDeposit(world, centralBankId, bankId, Math.max(1, amount));
      const account = accountFor(world, centralBankId, currencyId);
      if (account) accountIdsByCurrency[currencyId] = account.id;
    }
    const portfolio = { centralBankId, countryId: country.id, accountIdsByCurrency, targetWeightsBps: weights, goldUsdMinor: Math.round(desiredUsdMinor * 1_200 / 10_000), sdrUsdMinor: Math.round(desiredUsdMinor * 300 / 10_000), totalUsdMinor: desiredUsdMinor };
    const regime = world.fxRegimes.find((item) => item.countryId === country.id);
    if (regime) regime.defenseCapacityUsdMinor = desiredUsdMinor;
    return portfolio;
  });
}

function productionCapacity(world: WorldState, countryId: string, commodityId: string): number {
  const commodity = world.globalCommodities.find((item) => item.id === commodityId)!;
  const deposits = world.resourceDeposits.filter((deposit) => deposit.countryId === countryId && deposit.commodityId === commodityId && deposit.active);
  if (deposits.length) return deposits.reduce((sum, deposit) => {
    const output = Math.min(deposit.extractableReservesMilliUnits, Math.round(deposit.monthlyCapacityMilliUnits * deposit.infrastructureBps * deposit.technologyBps / 100_000_000));
    deposit.extractableReservesMilliUnits -= output;
    deposit.depletionBps = Math.round((deposit.provenReservesMilliUnits - deposit.extractableReservesMilliUnits) * 10_000 / Math.max(1, deposit.provenReservesMilliUnits));
    if (deposit.extractableReservesMilliUnits <= 0) deposit.active = false;
    return sum + output;
  }, 0);
  const companies = world.companies.filter((company) => company.active && company.headquartersCountryId === countryId && (!commodity.linkedGoodId || company.goodId === commodity.linkedGoodId));
  const firms = companies.reduce((sum, company) => sum + Math.max(0, company.lastProductionMilliUnits || Math.round(company.capacityMilliUnits * 0.35)), 0);
  const advantage = commodity.category === "industrial" || commodity.category === "final" ? Math.max(2_000, companies.reduce((sum, company) => sum + company.productivityBps, 0) / Math.max(1, companies.length)) : 5_000;
  const tradeSector = world.tradeSectors.find((item) => item.countryId === countryId);
  if (world.baselineReference.mode === "REAL_WORLD") {
    const expectedDemand = economicDemandFor(world, countryId, commodityId).total;
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === countryId);
    const specializationSeed = [...`${countryId}:${commodityId}`].reduce((sum, character, index) => sum + character.charCodeAt(0) * (index + 17), 0);
    const specializationBps = 6_500 + specializationSeed % 9_000;
    const tradeBalanceBps = pack ? clamp(Math.round((pack.exportsUsd - pack.importsUsd) * 2_000 / Math.max(1, pack.exportsUsd + pack.importsUsd)), -1_000, 1_000) : 0;
    return Math.max(1, Math.round(expectedDemand * clamp(specializationBps + tradeBalanceBps, 5_500, 15_500) / 10_000));
  }
  const syntheticCapacity = tradeSector && (commodity.category === "industrial" || commodity.category === "final") ? Math.round(tradeSector.exportCapacityUsdMinor * 1_000 / Math.max(1, commodity.baseSpotPriceMinor * 8)) : 0;
  const syntheticBaseline = world.baselineReference.mode === "SYNTHETIC" ? Math.max(0, Math.round(firms * Math.max(2_000, advantage) / 20_000)) : 0;
  return Math.max(Math.round(firms * advantage / 1_000_000), syntheticCapacity, syntheticBaseline);
}

function representativeCompany(world: WorldState, countryId: string, commodityId: string) {
  const linked = world.globalCommodities.find((item) => item.id === commodityId)?.linkedGoodId;
  return world.companies.find((company) => company.active && company.headquartersCountryId === countryId && company.goodId === linked)
    ?? world.companies.find((company) => company.active && company.headquartersCountryId === countryId)
    ?? null;
}

function economicDemandFor(world: WorldState, countryId: string, commodityId: string): { household: number; industrial: number; investment: number; resource: number; total: number } {
  const commodity = world.globalCommodities.find((item) => item.id === commodityId)!;
  const market = world.commodityMarkets.find((item) => item.commodityId === commodityId)!;
  if (world.baselineReference.mode === "SYNTHETIC") {
    const population = world.countryEconomicProfiles.find((item) => item.countryId === countryId)?.population ?? 1_000_000;
    const categoryWeight = commodity.category === "agriculture" ? 120 : commodity.category === "final" ? 95 : commodity.category === "energy" ? 70 : commodity.category === "metals" ? 35 : 55;
    const total = Math.max(1_500, Math.round(population / 8_000)) * categoryWeight / 100;
    const householdShareBps = commodity.category === "agriculture" || commodity.category === "final" ? 6_800 : 1_200;
    const investmentShareBps = ["steel", "copper", "semiconductors", "machinery", "vehicles", "business-services"].includes(commodityId) ? 2_500 : 300;
    const household = Math.round(total * householdShareBps / 10_000);
    const investment = Math.round(total * investmentShareBps / 10_000);
    const resource = commodity.category === "energy" ? Math.round(total * 1_500 / 10_000) : 0;
    const industrial = Math.max(0, Math.round(total) - household - investment - resource);
    return { household, industrial, investment, resource, total: household + industrial + investment + resource };
  }
  const cohorts = world.populationCohorts.filter((item) => item.countryId === countryId);
  const firms = world.firmCohorts.filter((item) => item.countryId === countryId);
  const reconciliation = world.countryScaleReconciliations.find((item) => item.countryId === countryId);
  const disposableIncome = reconciliation?.householdConsumptionMinor ?? cohorts.reduce((sum, item) => sum + item.employedCount * item.averageMonthlyIncomeCents * (10_000 - item.savingsRateBps) / 10_000, 0);
  const householdShareBps = commodity.category === "agriculture" ? 180 : commodity.category === "final" ? 450 : commodity.category === "energy" ? 120 : commodity.id === "business-services" ? 220 : 30;
  const householdUsd = convertMinor(world, Math.round(disposableIncome * householdShareBps / 10_000), countryCurrency(world, countryId), "USD") ?? 0;
  const household = Math.round(householdUsd * 1_000 / Math.max(1, market.spotPriceUsdMinor));
  const industrialWeightBps = commodity.category === "metals" ? 280 : commodity.category === "industrial" ? 400 : commodity.category === "energy" ? 350 : commodity.id === "business-services" ? 250 : 80;
  const industrialValue = (reconciliation?.productionApproachMinor ?? firms.reduce((sum, item) => sum + item.revenueCents + item.valueAddedMinor, 0)) * industrialWeightBps / 10_000;
  const industrialUsd = convertMinor(world, Math.round(industrialValue), countryCurrency(world, countryId), "USD") ?? 0;
  const industrial = Math.round(industrialUsd * 1_000 / Math.max(1, market.spotPriceUsdMinor));
  const investmentEligible = ["steel", "copper", "semiconductors", "machinery", "vehicles", "business-services"].includes(commodityId);
  const investmentBase = reconciliation?.investmentMinor ?? firms.reduce((sum, item) => sum + Math.max(0, item.profitsCents), 0);
  const investmentUsd = investmentEligible ? convertMinor(world, Math.round(investmentBase * 400 / 10_000), countryCurrency(world, countryId), "USD") ?? 0 : 0;
  const investment = Math.round(investmentUsd * 1_000 / Math.max(1, market.spotPriceUsdMinor));
  const logistics = world.logisticsSectors.find((item) => item.countryId === countryId);
  const resource = commodity.category === "energy" ? Math.round(firms.reduce((sum, item) => sum + item.productionMilliUnits, 0) * 0.16 + (logistics?.fuelDemandMilliUnits ?? 0)) : 0;
  return { household, industrial, investment, resource, total: household + industrial + investment + resource };
}

function calibratedTradeQuantity(world: WorldState, countryId: string, commodityId: string, side: "export" | "import"): number {
  if (world.baselineReference.mode !== "REAL_WORLD") return 0;
  const sector = world.tradeSectors.find((item) => item.countryId === countryId);
  const market = world.commodityMarkets.find((item) => item.commodityId === commodityId);
  if (!sector || !market) return 0;
  const weights = Object.fromEntries(world.globalCommodities.map((commodity, index) => [commodity.id, 300 + (index * 1_103 + countryId.charCodeAt(0) * 31 + countryId.charCodeAt(1) * 17) % 900]));
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const monthlyValue = side === "export" ? sector.exportCapacityUsdMinor : sector.importBudgetUsdMinor;
  return Math.max(1, Math.round(monthlyValue * sector.tradeCalibrationFactorBps / 10_000 * weights[commodityId] / Math.max(1, weightTotal) * 1_000 / Math.max(1, market.spotPriceUsdMinor)));
}

function updateTradeCalibrationFactors(world: WorldState): void {
  if (world.baselineReference.mode !== "REAL_WORLD") return;
  for (const sector of world.tradeSectors) {
    const target = sector.exportCapacityUsdMinor + sector.importBudgetUsdMinor;
    const actual = sector.lastExportRevenueUsdMinor + sector.lastImportCostUsdMinor;
    if (world.clock.elapsedMonths > 0 && actual > 0) {
      const correctionBps = clamp(Math.round(target * 10_000 / actual), 7_500, 20_000);
      sector.tradeCalibrationFactorBps = clamp(Math.round(sector.tradeCalibrationFactorBps * correctionBps / 10_000), 5_000, 80_000);
    }
    sector.lastExportRevenueUsdMinor = 0;
    sector.lastImportCostUsdMinor = 0;
  }
}

function normalizeCalibratedTradeQuotas(world: WorldState, commodityId: string, states: WorldState["countryCommodityStates"]): void {
  if (world.baselineReference.mode !== "REAL_WORLD") return;
  const supply = states.reduce((sum, state) => sum + state.exportSupplyMilliUnits, 0);
  const demand = states.reduce((sum, state) => sum + state.importDemandMilliUnits, 0);
  if (supply <= 0 || demand <= 0) return;
  if (supply < demand) {
    for (const state of states) state.exportSupplyMilliUnits = Math.min(state.inventoryMilliUnits, Math.round(state.exportSupplyMilliUnits * demand / supply));
  } else if (demand < supply) {
    for (const state of states) state.importDemandMilliUnits = Math.round(state.importDemandMilliUnits * supply / demand);
  }
  // Preserve the commodity-level calibrated value when quantities are rounded.
  const market = world.commodityMarkets.find((item) => item.commodityId === commodityId);
  if (market) market.monthlyVolumeMilliUnits = 0;
}

function resetRealWorldRouteCapacity(world: WorldState): void {
  for (const route of world.tradeRoutes) {
    const originTrade = world.tradeSectors.find((item) => item.countryId === route.originCountryId);
    const destinationTrade = world.tradeSectors.find((item) => item.countryId === route.destinationCountryId);
    if (!originTrade || !destinationTrade) continue;
    const target = Math.round(Math.min(originTrade.exportCapacityUsdMinor, destinationTrade.importBudgetUsdMinor) / 8);
    // Route infrastructure adapts gradually to structural trade demand while
    // current-month congestion still constrains supplier choice.
    route.capacityMilliUnits = Math.max(25_000_000, Math.round(route.capacityMilliUnits * 0.92 + target * 0.08));
  }
}

function createClearedTradeFlow(world: WorldState, exporterCountryId: string, importerCountryId: string, commodityId: string, quantityMilliUnits: number, route: TradeRoute): TradeFlow | null {
  const exporter = world.tradeSectors.find((item) => item.countryId === exporterCountryId);
  const importer = world.tradeSectors.find((item) => item.countryId === importerCountryId);
  const exporterEntity = exporter ?? representativeCompany(world, exporterCountryId, commodityId);
  const importerEntity = importer ?? representativeCompany(world, importerCountryId, commodityId);
  const market = world.commodityMarkets.find((item) => item.commodityId === commodityId)!;
  if (!exporterEntity || !importerEntity || quantityMilliUnits <= 0) return null;
  const invoiceCurrencyId = countryCurrency(world, exporterCountryId);
  const valueUsdMinor = Math.max(1, Math.round(quantityMilliUnits * market.spotPriceUsdMinor / 1_000));
  const transportCostUsdMinor = Math.max(1, Math.round(quantityMilliUnits * route.costUsdMinorPerUnit / 1_000));
  const tradeCostUsdMinor = Math.round(valueUsdMinor * 35 / 10_000);
  const invoiceValueMinor = convertMinor(world, valueUsdMinor, "USD", invoiceCurrencyId) ?? valueUsdMinor;
  const logistics = world.logisticsSectors.find((item) => item.countryId === exporterCountryId) ?? world.logisticsSectors.find((item) => item.countryId === importerCountryId);
  const id = `trade-flow-${String(world.nextTradeFlowId++).padStart(9, "0")}`;
  if (world.baselineReference.mode === "SYNTHETIC") {
    const nativeCurrencyId = countryCurrency(world, importerCountryId);
    const nativeAccount = ensureCurrencyAccount(world, importerEntity.id, nativeCurrencyId);
    const invoiceAccount = ensureCurrencyAccount(world, importerEntity.id, invoiceCurrencyId);
    const exporterAccount = ensureCurrencyAccount(world, exporterEntity.id, invoiceCurrencyId);
    if (!nativeAccount || !invoiceAccount || !exporterAccount) return null;
    let fxTradeId: string | null = null;
    if (nativeCurrencyId !== invoiceCurrencyId) {
      const requiredNative = convertMinor(world, Math.ceil(invoiceValueMinor * 1.02), invoiceCurrencyId, nativeCurrencyId) ?? 0;
      if (requiredNative <= 0 || bankAccountBalance(world, nativeAccount.id) < requiredNative) return null;
      const converted = executeFxConversion(world, importerEntity.id, nativeAccount.id, invoiceAccount.id, requiredNative);
      if (!converted.ok) return null;
      fxTradeId = converted.tradeId ?? null;
    }
    const goodsPayment = settleFinancialPayment(world, importerEntity.id, exporterEntity.id, invoiceCurrencyId, invoiceValueMinor, "GOODS_CLEARING", `Международная поставка ${commodityId}`);
    if (!goodsPayment) return null;
    world.externalClaims.push({ id: `external-claim-${id}`, creditorCountryId: exporterCountryId, debtorCountryId: importerCountryId, ownerId: exporterEntity.id, obligorId: importerEntity.id, currencyId: invoiceCurrencyId, valueUsdMinor, sourceFlowId: id, createdAtMonth: world.clock.elapsedMonths, kind: "DEPOSIT" });
    return { id, elapsedMonth: world.clock.elapsedMonths, exporterCountryId, importerCountryId, exporterId: exporterEntity.id, importerId: importerEntity.id, commodityId, quantityMilliUnits, unitPriceUsdMinor: market.spotPriceUsdMinor, invoiceCurrencyId, invoiceValueMinor, routeId: route.id, transportCostUsdMinor, tradeCostUsdMinor, landedUnitCostUsdMinor: market.spotPriceUsdMinor + route.costUsdMinorPerUnit + Math.round(market.spotPriceUsdMinor * 35 / 10_000), logisticsProviderId: "", logisticsPaymentTransactionId: null, tariffUsdMinor: 0, paymentTransactionIds: [goodsPayment], fxTradeId, status: "settled" };
  }
  return { id, elapsedMonth: world.clock.elapsedMonths, exporterCountryId, importerCountryId, exporterId: exporterEntity.id, importerId: importerEntity.id, commodityId, quantityMilliUnits, unitPriceUsdMinor: market.spotPriceUsdMinor, invoiceCurrencyId, invoiceValueMinor, routeId: route.id, transportCostUsdMinor, tradeCostUsdMinor, landedUnitCostUsdMinor: market.spotPriceUsdMinor + route.costUsdMinorPerUnit + Math.round(market.spotPriceUsdMinor * 35 / 10_000), logisticsProviderId: logistics?.id ?? "", logisticsPaymentTransactionId: null, tariffUsdMinor: 0, paymentTransactionIds: [], fxTradeId: null, status: "unpaid" };
}

/**
 * Physical clearing remains commodity- and route-level, while cash settlement
 * is netted into one bilateral monthly basket.  This is the same economic
 * activity with far fewer FX and ledger legs; it avoids turning storage detail
 * into an artificial limit on world trade.
 */
function settleClearedTradeBaskets(world: WorldState): void {
  const current = world.tradeFlows.filter((flow) => flow.elapsedMonth === world.clock.elapsedMonths && flow.status === "unpaid");
  const baskets = new Map<string, TradeFlow[]>();
  for (const flow of current) {
    const key = `${flow.exporterCountryId}:${flow.importerCountryId}:${flow.invoiceCurrencyId}:${flow.exporterId}:${flow.importerId}:${flow.logisticsProviderId}`;
    (baskets.get(key) ?? (baskets.set(key, []), baskets.get(key)!)).push(flow);
  }
  for (const flows of baskets.values()) {
    const first = flows[0];
    const exporter = world.tradeSectors.find((item) => item.countryId === first.exporterCountryId);
    const importer = world.tradeSectors.find((item) => item.countryId === first.importerCountryId);
    const logistics = world.logisticsSectors.find((item) => item.id === first.logisticsProviderId);
    const nativeCurrencyId = countryCurrency(world, first.importerCountryId);
    const invoiceCurrencyId = first.invoiceCurrencyId;
    const goodsInvoiceMinor = flows.reduce((sum, flow) => sum + flow.invoiceValueMinor, 0);
    const logisticsUsdMinor = flows.reduce((sum, flow) => sum + flow.transportCostUsdMinor, 0);
    const logisticsInvoiceMinor = convertMinor(world, logisticsUsdMinor, "USD", invoiceCurrencyId) ?? logisticsUsdMinor;
    const invoiceRequiredMinor = goodsInvoiceMinor + logisticsInvoiceMinor;
    const nativeAccount = ensureCurrencyAccount(world, first.importerId, nativeCurrencyId);
    const invoiceAccount = ensureCurrencyAccount(world, first.importerId, invoiceCurrencyId);
    const exporterAccount = ensureCurrencyAccount(world, first.exporterId, invoiceCurrencyId);
    if (!nativeAccount || !invoiceAccount || !exporterAccount) throw new Error(`Не удалось открыть счета для торговой корзины ${first.importerCountryId} → ${first.exporterCountryId}`);
    let fxTradeId: string | null = null;
    if (nativeCurrencyId !== invoiceCurrencyId) {
      const requiredNative = convertMinor(world, Math.ceil(invoiceRequiredMinor * 1.025), invoiceCurrencyId, nativeCurrencyId) ?? 0;
      if (requiredNative <= 0) throw new Error(`Не удалось оценить FX для торговой корзины ${first.id}`);
      if (bankAccountBalance(world, nativeAccount.id) < requiredNative && importer) extendTradeFinance(world, importer, requiredNative - bankAccountBalance(world, nativeAccount.id), nativeCurrencyId);
      const converted = bankAccountBalance(world, nativeAccount.id) >= requiredNative
        ? executeFxConversion(world, first.importerId, nativeAccount.id, invoiceAccount.id, requiredNative)
        : { ok: false, message: "Недостаточно торгового финансирования" };
      if (!converted.ok) throw new Error(`FX settlement торговой корзины отклонён: ${converted.message}`);
      fxTradeId = converted.tradeId ?? null;
    }
    if (bankAccountBalance(world, invoiceAccount.id) < invoiceRequiredMinor) throw new Error(`Неполное валютное покрытие торговой корзины ${first.id}`);
    const flowIds = flows.map((flow) => flow.id);
    const goodsPayment = settleFinancialPayment(world, first.importerId, first.exporterId, invoiceCurrencyId, goodsInvoiceMinor, "GOODS_CLEARING", `Международная торговая корзина ${first.importerCountryId} → ${first.exporterCountryId}`, flowIds);
    const logisticsPayment = logistics && logisticsInvoiceMinor > 0
      ? settleFinancialPayment(world, first.importerId, logistics.id, invoiceCurrencyId, logisticsInvoiceMinor, "LOGISTICS", `Логистическая корзина ${first.importerCountryId} → ${first.exporterCountryId}`, flowIds)
      : null;
    if (!goodsPayment || (logistics && !logisticsPayment)) throw new Error(`Денежное settlement торговой корзины ${first.id} не завершено`);
    for (const flow of flows) {
      const valueUsdMinor = Math.round(flow.quantityMilliUnits * flow.unitPriceUsdMinor / 1_000);
      flow.paymentTransactionIds = [goodsPayment, ...(logisticsPayment ? [logisticsPayment] : [])];
      flow.logisticsPaymentTransactionId = logisticsPayment;
      flow.fxTradeId = fxTradeId;
      flow.status = "settled";
      if (exporter) exporter.lastExportRevenueUsdMinor += valueUsdMinor;
      if (importer) importer.lastImportCostUsdMinor += valueUsdMinor + flow.transportCostUsdMinor + flow.tradeCostUsdMinor;
      if (logistics) {
        logistics.revenueUsdMinor += flow.transportCostUsdMinor;
        logistics.profitUsdMinor += Math.round(flow.transportCostUsdMinor * 1_800 / 10_000);
        logistics.fuelDemandMilliUnits += Math.round(flow.quantityMilliUnits * 45 / 10_000);
      }
      world.externalClaims.push({ id: `external-claim-${flow.id}`, creditorCountryId: flow.exporterCountryId, debtorCountryId: flow.importerCountryId, ownerId: flow.exporterId, obligorId: flow.importerId, currencyId: flow.invoiceCurrencyId, valueUsdMinor, sourceFlowId: flow.id, createdAtMonth: world.clock.elapsedMonths, kind: "DEPOSIT" });
    }
  }
}

export function clearMultilateralCommodityMarkets(world: WorldState): void {
  updateTradeCalibrationFactors(world);
  fundMonthlyTradeBudgets(world);
  if (world.baselineReference.mode === "REAL_WORLD") resetRealWorldRouteCapacity(world);
  for (const route of world.tradeRoutes) route.usedCapacityMilliUnits = 0;
  const syntheticAgriculture = world.globalCommodities.filter((commodity) => commodity.category === "agriculture");
  const syntheticMarkets = new Set([syntheticAgriculture[world.clock.elapsedMonths % syntheticAgriculture.length]?.id]);
  for (const market of world.commodityMarkets) {
    const commodity = world.globalCommodities.find((item) => item.id === market.commodityId)!;
    const states = world.countryCommodityStates.filter((item) => item.commodityId === commodity.id);
    const opening = new Map(states.map((state) => [state.countryId, state.inventoryMilliUnits]));
    for (const state of states) {
      state.productionMilliUnits = productionCapacity(world, state.countryId, commodity.id);
      const demand = economicDemandFor(world, state.countryId, commodity.id);
      state.householdDemandMilliUnits = demand.household; state.industrialDemandMilliUnits = demand.industrial; state.investmentDemandMilliUnits = demand.investment; state.resourceDemandMilliUnits = demand.resource; state.domesticDemandMilliUnits = demand.total;
      const calibratedImport = calibratedTradeQuantity(world, state.countryId, commodity.id, "import");
      const calibratedExport = calibratedTradeQuantity(world, state.countryId, commodity.id, "export");
      // Trade openness is a structural use of the same physical commodity,
      // not a decorative target. Imports augment domestic final/intermediate
      // demand; export orders augment production and are cleared multilaterally.
      state.domesticDemandMilliUnits += calibratedImport;
      const domesticCapacity = Math.max(1, state.productionMilliUnits);
      state.productionMilliUnits += calibratedExport;
      state.consumptionMilliUnits = Math.min(demand.total, domesticCapacity + state.inventoryMilliUnits);
      const available = state.productionMilliUnits + state.inventoryMilliUnits - state.consumptionMilliUnits;
      state.exportSupplyMilliUnits = world.baselineReference.mode === "REAL_WORLD"
        ? Math.max(0, Math.min(available, Math.round(calibratedExport * 1.15)))
        : Math.max(0, Math.round(available * 0.82));
      state.importDemandMilliUnits = world.baselineReference.mode === "REAL_WORLD" ? Math.max(0, calibratedImport) : Math.max(0, demand.total - state.consumptionMilliUnits);
      state.inventoryMilliUnits = available;
    }
    normalizeCalibratedTradeQuotas(world, commodity.id, states);
    const clearThisMarket = world.baselineReference.mode === "REAL_WORLD" || world.clock.elapsedMonths % 3 === 0 && syntheticMarkets.has(commodity.id);
    const exporters = clearThisMarket ? states.filter((item) => item.exportSupplyMilliUnits > 0) : [];
    const importers = clearThisMarket ? states.filter((item) => item.importDemandMilliUnits > 0).sort((a, b) => b.importDemandMilliUnits - a.importDemandMilliUnits) : [];
    market.monthlyVolumeMilliUnits = 0;
    for (const importer of importers) {
      const offers = exporters.map((exporter) => {
        const route = world.tradeRoutes.find((item) => item.originCountryId === exporter.countryId && item.destinationCountryId === importer.countryId && item.active);
        const reliability = world.tradeSectors.find((item) => item.countryId === exporter.countryId)?.reliabilityBps ?? 7_000;
        return { exporter, route, landed: route ? exporter.marginalCostUsdMinor + route.costUsdMinorPerUnit + Math.round((10_000 - reliability) / 50) : Infinity };
      }).filter((item): item is { exporter: typeof exporters[number]; route: TradeRoute; landed: number } => Boolean(item.route)).sort((a, b) => a.landed - b.landed || a.exporter.countryId.localeCompare(b.exporter.countryId));
      for (const offer of offers) {
        if (offer.exporter.countryId === importer.countryId || importer.importDemandMilliUnits <= 0 || offer.exporter.exportSupplyMilliUnits <= 0) continue;
        const quantity = Math.min(importer.importDemandMilliUnits, offer.exporter.exportSupplyMilliUnits, offer.route.capacityMilliUnits - offer.route.usedCapacityMilliUnits, Math.max(1, Math.round(importer.importDemandMilliUnits * (world.baselineReference.mode === "REAL_WORLD" ? 1 : 0.36))), Math.max(1, Math.round(offer.exporter.exportSupplyMilliUnits * (world.baselineReference.mode === "REAL_WORLD" ? 1 : 0.82))));
        const flow = createClearedTradeFlow(world, offer.exporter.countryId, importer.countryId, commodity.id, quantity, offer.route);
        if (!flow) continue;
        world.tradeFlows.push(flow); offer.route.usedCapacityMilliUnits += quantity; offer.exporter.exportSupplyMilliUnits -= quantity; offer.exporter.inventoryMilliUnits -= quantity; importer.importDemandMilliUnits -= quantity; importer.inventoryMilliUnits += quantity; market.monthlyVolumeMilliUnits += quantity;
      }
    }
    market.globalProductionMilliUnits = states.reduce((sum, item) => sum + item.productionMilliUnits, 0); market.globalConsumptionMilliUnits = states.reduce((sum, item) => sum + item.consumptionMilliUnits, 0); market.globalInventoryMilliUnits = states.reduce((sum, item) => sum + item.inventoryMilliUnits, 0);
    const unmet = states.reduce((sum, item) => sum + item.importDemandMilliUnits, 0); market.shortageBps = clamp(Math.round(unmet * 10_000 / Math.max(1, states.reduce((sum, item) => sum + item.domesticDemandMilliUnits, 0))), 0, 10_000);
    market.previousSpotPriceUsdMinor = market.spotPriceUsdMinor; market.spotPriceUsdMinor = clamp(Math.round(market.spotPriceUsdMinor * (10_000 + market.shortageBps / 20) / 10_000), Math.round(commodity.baseSpotPriceMinor * 0.35), Math.round(commodity.baseSpotPriceMinor * 4));
    for (const state of states) {
      const flows = world.tradeFlows.filter((flow) => flow.elapsedMonth === world.clock.elapsedMonths && flow.commodityId === commodity.id && (flow.exporterCountryId === state.countryId || flow.importerCountryId === state.countryId));
      const imports = flows.filter((flow) => flow.importerCountryId === state.countryId).reduce((sum, flow) => sum + flow.quantityMilliUnits, 0); const exports = flows.filter((flow) => flow.exporterCountryId === state.countryId).reduce((sum, flow) => sum + flow.quantityMilliUnits, 0);
      const householdUse = Math.min(state.consumptionMilliUnits, state.householdDemandMilliUnits); const industrialUse = state.consumptionMilliUnits - householdUse;
      world.physicalCommodityFlows.push({ countryId: state.countryId, commodityId: commodity.id, elapsedMonth: world.clock.elapsedMonths, openingStockMilliUnits: opening.get(state.countryId) ?? 0, productionMilliUnits: state.productionMilliUnits, importsMilliUnits: imports, householdConsumptionMilliUnits: householdUse, industrialUseMilliUnits: industrialUse, exportsMilliUnits: exports, closingStockMilliUnits: state.inventoryMilliUnits, conservationGapMilliUnits: (opening.get(state.countryId) ?? 0) + state.productionMilliUnits + imports - householdUse - industrialUse - exports - state.inventoryMilliUnits });
    }
  }
  const physicalRetentionMonths = world.baselineReference.mode === "REAL_WORLD" ? 12 : 6;
  world.physicalCommodityFlows = world.physicalCommodityFlows.filter((item) => item.elapsedMonth >= world.clock.elapsedMonths - physicalRetentionMonths);
  settleClearedTradeBaskets(world);
}

export function updateSupplyChains(world: WorldState): void {
  for (const inventory of world.countrySectorInventories) {
    const commodity = world.countryCommodityStates.find((state) => state.countryId === inventory.countryId && state.commodityId === inventory.inputCommodityId);
    const coefficient = world.inputOutputCoefficients.find((item) => item.outputSectorId === inventory.sectorId && item.inputCommodityId === inventory.inputCommodityId)!;
    const output = world.companies.filter((company) => company.active && company.headquartersCountryId === inventory.countryId && company.goodId === inventory.sectorId).reduce((sum, company) => sum + Math.max(company.lastProductionMilliUnits, Math.round(company.capacityMilliUnits * 0.25)), 0);
    const transferred = Math.min(commodity?.inventoryMilliUnits ?? 0, Math.round((commodity?.inventoryMilliUnits ?? 0) * 0.12));
    inventory.inventoryMilliUnits += transferred;
    if (commodity) commodity.inventoryMilliUnits -= transferred;
    inventory.requiredMilliUnits = Math.round(output * coefficient.requiredMilliUnitsPerOutputUnit / 1_000);
    const used = Math.min(inventory.inventoryMilliUnits, inventory.requiredMilliUnits);
    inventory.inventoryMilliUnits -= used;
    inventory.shortageBps = inventory.requiredMilliUnits ? Math.round((inventory.requiredMilliUnits - used) * 10_000 / inventory.requiredMilliUnits) : 0;
  }
  for (const company of world.companies) {
    const relevant = world.countrySectorInventories.filter((item) => item.countryId === company.headquartersCountryId && item.sectorId === company.goodId);
    company.globalInputConstraintBps = relevant.length ? clamp(10_000 - Math.max(...relevant.map((item) => item.shortageBps)), 1_500, 10_000) : 10_000;
  }
}

function updateEnergyBalances(world: WorldState): void {
  world.energyBalances = world.energyBalances.filter((item) => item.elapsedMonth >= world.clock.elapsedMonths - 24);
  for (const country of world.countries) {
    const sourceIds = ["crude-oil", "natural-gas", "thermal-coal", "uranium", "electricity"];
    const productionBySourceMilliUnits = Object.fromEntries(sourceIds.map((id) => [id, world.countryCommodityStates.find((state) => state.countryId === country.id && state.commodityId === id)?.productionMilliUnits ?? 0]));
    const consumptionBySourceMilliUnits = Object.fromEntries(sourceIds.map((id) => [id, world.countryCommodityStates.find((state) => state.countryId === country.id && state.commodityId === id)?.consumptionMilliUnits ?? 0]));
    const flows = world.tradeFlows.filter((flow) => flow.elapsedMonth === world.clock.elapsedMonths && sourceIds.includes(flow.commodityId));
    world.energyBalances.push({ countryId: country.id, elapsedMonth: world.clock.elapsedMonths, productionBySourceMilliUnits, consumptionBySourceMilliUnits, importsMilliUnits: flows.filter((flow) => flow.importerCountryId === country.id).reduce((sum, flow) => sum + flow.quantityMilliUnits, 0), exportsMilliUnits: flows.filter((flow) => flow.exporterCountryId === country.id).reduce((sum, flow) => sum + flow.quantityMilliUnits, 0), strategicReserveMilliUnits: world.strategicReserves.filter((reserve) => reserve.countryId === country.id && sourceIds.includes(reserve.commodityId)).reduce((sum, reserve) => sum + reserve.inventoryMilliUnits, 0), unmetDemandMilliUnits: sourceIds.reduce((sum, id) => sum + (world.countryCommodityStates.find((state) => state.countryId === country.id && state.commodityId === id)?.importDemandMilliUnits ?? 0), 0) });
  }
}

function currentBopRecord(world: WorldState, countryId: string): BalanceOfPaymentsRecord {
  let record = world.balanceOfPayments.find((item) => item.countryId === countryId && item.elapsedMonth === world.clock.elapsedMonths);
  if (record) return record;
  record = { countryId, elapsedMonth: world.clock.elapsedMonths, goodsExportsUsdMinor: 0, goodsImportsUsdMinor: 0, servicesBalanceUsdMinor: 0, primaryIncomeBalanceUsdMinor: 0, secondaryIncomeBalanceUsdMinor: 0, currentAccountUsdMinor: 0, capitalAccountUsdMinor: 0, directInvestmentNetInflowUsdMinor: 0, portfolioNetInflowUsdMinor: 0, otherInvestmentNetInflowUsdMinor: 0, tradeFinanceNetInflowUsdMinor: 0, financialAccountUsdMinor: 0, reserveChangeUsdMinor: 0, errorsAndOmissionsUsdMinor: 0, reconciliationGapUsdMinor: 0, reconciliationWarning: false, causeFlowIds: [] };
  world.balanceOfPayments.push(record);
  return record;
}

function updateExternalAccounts(world: WorldState): void {
  for (const country of world.countries) {
    const bop = currentBopRecord(world, country.id);
    const flows = world.tradeFlows.filter((flow) => flow.elapsedMonth === world.clock.elapsedMonths && (flow.exporterCountryId === country.id || flow.importerCountryId === country.id));
    bop.goodsExportsUsdMinor = flows.filter((flow) => flow.exporterCountryId === country.id).reduce((sum, flow) => sum + Math.round(flow.quantityMilliUnits * flow.unitPriceUsdMinor / 1_000), 0);
    bop.goodsImportsUsdMinor = flows.filter((flow) => flow.importerCountryId === country.id).reduce((sum, flow) => sum + Math.round(flow.quantityMilliUnits * flow.unitPriceUsdMinor / 1_000), 0);
    bop.causeFlowIds = flows.map((flow) => flow.id);
    bop.currentAccountUsdMinor = bop.goodsExportsUsdMinor - bop.goodsImportsUsdMinor + bop.servicesBalanceUsdMinor + bop.primaryIncomeBalanceUsdMinor + bop.secondaryIncomeBalanceUsdMinor;
    // Every settled cross-border transaction has a second financial leg.  Goods
    // create trade credit/deposit claims; autonomous capital transactions draw
    // down or build those same cross-border settlement claims.  Recording that
    // leg explicitly keeps E&O diagnostic instead of using it as a plug.
    bop.tradeFinanceNetInflowUsdMinor = bop.goodsImportsUsdMinor - bop.goodsExportsUsdMinor
      - bop.directInvestmentNetInflowUsdMinor - bop.portfolioNetInflowUsdMinor
      - bop.otherInvestmentNetInflowUsdMinor - bop.reserveChangeUsdMinor;
    bop.financialAccountUsdMinor = bop.directInvestmentNetInflowUsdMinor + bop.portfolioNetInflowUsdMinor + bop.otherInvestmentNetInflowUsdMinor + bop.tradeFinanceNetInflowUsdMinor;
    const preResidual = bop.currentAccountUsdMinor + bop.capitalAccountUsdMinor + bop.financialAccountUsdMinor + bop.reserveChangeUsdMinor;
    const residualLimit = Math.max(10_000, Math.round(Math.max(Math.abs(bop.currentAccountUsdMinor), bop.goodsExportsUsdMinor + bop.goodsImportsUsdMinor) * 100 / 10_000));
    bop.errorsAndOmissionsUsdMinor = clamp(-preResidual, -residualLimit, residualLimit);
    bop.reconciliationGapUsdMinor = bop.currentAccountUsdMinor + bop.capitalAccountUsdMinor + bop.financialAccountUsdMinor + bop.reserveChangeUsdMinor + bop.errorsAndOmissionsUsdMinor;
    bop.reconciliationWarning = Math.abs(bop.reconciliationGapUsdMinor) > residualLimit;
    const reserve = world.reservePortfolios.find((item) => item.countryId === country.id);
    const fdiAssets = world.foreignDirectInvestments.filter((item) => item.investorCountryId === country.id && item.status === "active").reduce((sum, item) => sum + (convertMinor(world, item.investedAmountMinor, item.currencyId, "USD") ?? 0), 0);
    const fdiLiabilities = world.foreignDirectInvestments.filter((item) => item.destinationCountryId === country.id && item.status === "active").reduce((sum, item) => sum + (convertMinor(world, item.investedAmountMinor, item.currencyId, "USD") ?? 0), 0);
    const portfolioAssets = world.internationalPortfolioPositions.filter((item) => item.ownerCountryId === country.id).reduce((sum, item) => sum + (convertMinor(world, item.acquisitionValueMinor, item.currencyId, "USD") ?? 0), 0);
    const portfolioLiabilities = world.internationalPortfolioPositions.filter((item) => item.issuerCountryId === country.id).reduce((sum, item) => sum + (convertMinor(world, item.acquisitionValueMinor, item.currencyId, "USD") ?? 0), 0);
    const otherAssets = world.crossBorderLoans.filter((loan) => loan.lenderCountryId === country.id && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0);
    const otherLiabilities = world.crossBorderLoans.filter((loan) => loan.borrowerCountryId === country.id && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0) + (world.tradeSectors.find((item) => item.countryId === country.id)?.tradeFinanceLiabilityUsdMinor ?? 0);
    const point: InternationalInvestmentPosition = { countryId: country.id, elapsedMonth: world.clock.elapsedMonths, directInvestmentAssetsUsdMinor: fdiAssets, directInvestmentLiabilitiesUsdMinor: fdiLiabilities, portfolioAssetsUsdMinor: portfolioAssets, portfolioLiabilitiesUsdMinor: portfolioLiabilities, otherInvestmentAssetsUsdMinor: otherAssets, otherInvestmentLiabilitiesUsdMinor: otherLiabilities, reserveAssetsUsdMinor: reserve?.totalUsdMinor ?? 0, netInternationalInvestmentPositionUsdMinor: fdiAssets + portfolioAssets + otherAssets + (reserve?.totalUsdMinor ?? 0) - fdiLiabilities - portfolioLiabilities - otherLiabilities, publicExternalDebtUsdMinor: world.crossBorderLoans.filter((loan) => loan.borrowerCountryId === country.id && loan.borrowerId.startsWith("government-") && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0), privateExternalDebtUsdMinor: otherLiabilities, shortTermExternalDebtUsdMinor: world.crossBorderLoans.filter((loan) => loan.borrowerCountryId === country.id && loan.maturityMonth - world.clock.elapsedMonths <= 12 && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0) };
    world.internationalInvestmentPositions.push(point);
    const tradePressure = bop.goodsExportsUsdMinor - bop.goodsImportsUsdMinor;
    // Settlement/trade finance is the accounting counterpart of trade and
    // must not erase the market pressure that caused it. Only autonomous
    // capital allocation offsets trade pressure in the FX reaction function.
    const capitalPressure = bop.directInvestmentNetInflowUsdMinor + bop.portfolioNetInflowUsdMinor + bop.otherInvestmentNetInflowUsdMinor;
    const homeRate = world.centralBanks.find((bank) => bank.id === country.centralBankId)?.policyRateBps ?? 0;
    const usdRate = world.centralBanks.find((bank) => bank.currencyId === "USD")?.policyRateBps ?? 0;
    world.fxPressureHistory.push({ countryId: country.id, elapsedMonth: world.clock.elapsedMonths, tradePressureUsdMinor: tradePressure, capitalFlowPressureUsdMinor: capitalPressure, rateDifferentialBps: homeRate - usdRate, interventionUsdMinor: -bop.reserveChangeUsdMinor, netPressureUsdMinor: tradePressure + capitalPressure, causeIds: bop.causeFlowIds });
  }
  world.balanceOfPayments = world.balanceOfPayments.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 24);
  world.internationalInvestmentPositions = world.internationalInvestmentPositions.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 24);
  world.fxPressureHistory = world.fxPressureHistory.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 24);
  world.fxTrades = world.fxTrades.filter((trade) => trade.elapsedMonth >= world.clock.elapsedMonths - 24 || trade.buyerId === world.player.householdId || trade.sellerId === world.player.householdId);
  const claimCutoff = world.clock.elapsedMonths - 24;
  const oldClaims = world.externalClaims.filter((claim) => claim.createdAtMonth < claimCutoff);
  if (oldClaims.length) {
    const aggregated = new Map<string, typeof oldClaims[number]>();
    for (const claim of oldClaims) {
      const key = `${claim.creditorCountryId}:${claim.debtorCountryId}:${claim.currencyId}:${claim.kind}`;
      const current = aggregated.get(key) ?? { ...claim, id: `external-claim-aggregate-${key}`, sourceFlowId: "compacted-trade-claims", valueUsdMinor: 0, createdAtMonth: claimCutoff };
      current.valueUsdMinor += claim.valueUsdMinor;
      aggregated.set(key, current);
    }
    world.externalClaims = [...world.externalClaims.filter((claim) => claim.createdAtMonth >= claimCutoff), ...aggregated.values()];
  }
}

function compactTradeFlows(world: WorldState): void {
  const cutoff = world.clock.elapsedMonths - world.history.policy.tradeDetailMonths;
  const old = world.tradeFlows.filter((flow) => flow.elapsedMonth < cutoff);
  const grouped = new Map<string, typeof world.history.compactedTradeRecords[number]>();
  for (const flow of old) {
    const key = `${flow.elapsedMonth}:${flow.exporterCountryId}:${flow.importerCountryId}:${flow.commodityId}`;
    const valueUsdMinor = Math.round(flow.quantityMilliUnits * flow.unitPriceUsdMinor / 1_000);
    const record = grouped.get(key) ?? { elapsedMonth: flow.elapsedMonth, exporterCountryId: flow.exporterCountryId, importerCountryId: flow.importerCountryId, commodityId: flow.commodityId, quantityMilliUnits: 0, valueUsdMinor: 0, flowCount: 0 };
    record.quantityMilliUnits += flow.quantityMilliUnits; record.valueUsdMinor += valueUsdMinor; record.flowCount += 1; grouped.set(key, record);
  }
  if (old.length) {
    world.history.compactedTradeRecords.push(...grouped.values());
    world.tradeFlows = world.tradeFlows.filter((flow) => flow.elapsedMonth >= cutoff);
  }
  const quarterlyCutoff = world.clock.elapsedMonths - 24;
  const quarterly = new Map<string, typeof world.history.compactedTradeRecords[number]>();
  const recent = world.history.compactedTradeRecords.filter((record) => record.elapsedMonth >= quarterlyCutoff);
  for (const record of world.history.compactedTradeRecords.filter((item) => item.elapsedMonth < quarterlyCutoff)) {
    const quarterMonth = Math.floor(record.elapsedMonth / 3) * 3;
    const key = `${quarterMonth}:${record.exporterCountryId}:${record.importerCountryId}:${record.commodityId}`;
    const aggregate = quarterly.get(key) ?? { ...record, elapsedMonth: quarterMonth, quantityMilliUnits: 0, valueUsdMinor: 0, flowCount: 0 };
    aggregate.quantityMilliUnits += record.quantityMilliUnits;
    aggregate.valueUsdMinor += record.valueUsdMinor;
    aggregate.flowCount += record.flowCount;
    quarterly.set(key, aggregate);
  }
  world.history.compactedTradeRecords = [...quarterly.values(), ...recent];
}

export function runGlobalEconomyMonth(world: WorldState): void {
  clearMultilateralCommodityMarkets(world);
  updateSupplyChains(world);
  updateEnergyBalances(world);
  runAutonomousInternationalCapital(world);
  repriceCrossBorderLoans(world);
  updateExternalAccounts(world);
  compactTradeFlows(world);
}

function runAutonomousInternationalCapital(world: WorldState): void {
  if (world.baselineReference.mode !== "REAL_WORLD") return;
  if (world.clock.elapsedMonths % 3 !== 0) return;
  const countryScores = world.countries.map((country) => {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id)!;
    const rate = world.centralBanks.find((item) => item.id === country.centralBankId)?.policyRateBps ?? 0;
    const tradeGap = (world.tradeSectors.find((item) => item.countryId === country.id)?.importBudgetUsdMinor ?? 0) - (world.tradeSectors.find((item) => item.countryId === country.id)?.exportCapacityUsdMinor ?? 0);
    const openness = REAL_COUNTRY_PACKS.find((item) => item.countryId === country.id)?.tradeOpennessBps ?? 5_000;
    return { country, profile, rate, score: profile.productivityIndexBps + rate * 2 + openness / 4 - Math.max(0, tradeGap) / 10_000_000 };
  });
  const destination = [...countryScores].sort((a, b) => b.score - a.score || a.country.id.localeCompare(b.country.id))[world.clock.elapsedMonths / 3 % Math.min(4, countryScores.length)];
  const source = [...countryScores].sort((a, b) => a.score - b.score || a.country.id.localeCompare(b.country.id))[(world.clock.elapsedMonths / 3 + 1) % Math.min(4, countryScores.length)];
  if (destination && source && destination.country.id !== source.country.id) {
    const parent = world.companies.filter((item) => item.active && item.headquartersCountryId === source.country.id && item.representationTier === "A").sort((a, b) => (b.baselineFinancials?.cashMinor ?? 0) - (a.baselineFinancials?.cashMinor ?? 0))[0];
    const targetCurrency = countryCurrency(world, destination.country.id);
    const macroAmount = Math.max(1, Math.round((world.countryScaleReconciliations.find((item) => item.countryId === destination.country.id)?.targetMonthlyNominalGdpMinor ?? 1) * 25 / 10_000));
    if (parent && !world.foreignDirectInvestments.some((item) => item.parentCompanyId === parent.id && item.destinationCountryId === destination.country.id && item.openedAtMonth === world.clock.elapsedMonths)) createForeignDirectInvestment(world, parent.id, destination.country.id, Math.max(1, Math.round(macroAmount * 10 ** 2 / Math.max(1, targetCurrency === "JPY" || targetCurrency === "KRW" ? 100 : 1))));
  }
  for (const [fundIndex, fund] of world.funds.filter((item) => item.status === "active").entries()) {
    const home = countryOfEntity(world, fund.id);
    const candidates = countryScores.filter((item) => item.country.id !== home).sort((a, b) => b.score - a.score || a.country.id.localeCompare(b.country.id));
    const candidate = candidates[(world.clock.elapsedMonths / 3 + fundIndex) % Math.min(5, candidates.length)];
    const securities = candidate && world.equitySecurities.filter((item) => world.companies.find((company) => company.id === item.companyId)?.headquartersCountryId === candidate.country.id);
    const security = securities?.[(world.clock.elapsedMonths / 3 + fundIndex) % Math.max(1, securities.length)];
    const listing = security && world.listings.find((item) => item.securityId === security.id);
    const cash = bankAccountBalance(world, fund.bankAccountId);
    const existing = security && world.internationalPortfolioPositions.filter((item) => item.ownerId === fund.id && item.instrumentId === security.id).length;
    if (security && listing && cash > listing.lastPriceCents * 20 && existing < 3) purchaseForeignEquity(world, fund.id, security.id, Math.max(1, Math.min(100, Math.floor(cash * 40 / 10_000 / Math.max(1, listing.lastPriceCents)))));
  }
  const highRateCandidates = [...countryScores].sort((a, b) => b.rate - a.rate || b.score - a.score);
  const lowRateCandidates = [...countryScores].sort((a, b) => a.rate - b.rate || a.score - b.score);
  const highRate = highRateCandidates[world.clock.elapsedMonths / 3 % Math.min(4, highRateCandidates.length)];
  const lowRate = lowRateCandidates[(world.clock.elapsedMonths / 3 + 1) % Math.min(4, lowRateCandidates.length)];
  if (highRate && lowRate && highRate.country.id !== lowRate.country.id && highRate.rate - lowRate.rate >= 150) {
    const bank = world.banks.find((item) => item.countryId === lowRate.country.id);
    const borrower = world.tradeSectors.find((item) => item.countryId === highRate.country.id);
    const amount = Math.max(1, Math.round((world.countryScaleReconciliations.find((item) => item.countryId === highRate.country.id)?.targetMonthlyNominalGdpMinor ?? 1) * 8 / 10_000));
    const activePairLoans = world.crossBorderLoans.filter((item) => item.lenderCountryId === lowRate.country.id && item.borrowerCountryId === highRate.country.id && item.status === "active").length;
    if (bank && borrower && activePairLoans < 2) issueCrossBorderLoan(world, bank.id, borrower.id, amount, 36);
  }
  for (const regime of world.fxRegimes.filter((item) => item.regime !== "FLOATING")) {
    const pressure = [...world.fxPressureHistory].reverse().find((item) => item.countryId === regime.countryId)?.netPressureUsdMinor ?? 0;
    const portfolio = world.reservePortfolios.find((item) => item.countryId === regime.countryId);
    const local = countryCurrency(world, regime.countryId);
    if (!portfolio || Math.abs(pressure) < portfolio.totalUsdMinor * 20 / 10_000) continue;
    const amountUsd = Math.min(Math.abs(pressure), Math.round(portfolio.totalUsdMinor * 50 / 10_000));
    const sell = pressure < 0 ? regime.anchorCurrencyId : local;
    const buy = pressure < 0 ? local : regime.anchorCurrencyId;
    const amount = convertMinor(world, amountUsd, "USD", sell) ?? 0;
    if (amount > 0) interveneFx(world, regime.countryId, sell, buy, amount);
  }
}

export function createForeignDirectInvestment(world: WorldState, parentCompanyId: string, destinationCountryId: string, amountMinor: number): ForeignDirectInvestment | null {
  const parent = world.companies.find((company) => company.id === parentCompanyId && company.active);
  const target = world.companies.find((company) => company.headquartersCountryId === destinationCountryId && company.active);
  if (!parent || !target || parent.headquartersCountryId === destinationCountryId || amountMinor <= 0) return null;
  const targetCurrency = countryCurrency(world, destinationCountryId);
  const sourceCurrency = countryCurrency(world, parent.headquartersCountryId);
  const source = ensureCurrencyAccount(world, parent.id, sourceCurrency);
  const targetCurrencyAccount = ensureCurrencyAccount(world, parent.id, targetCurrency);
  const recipient = ensureCurrencyAccount(world, target.id, targetCurrency);
  if (!source || !targetCurrencyAccount || !recipient) return null;
  let fxTradeId: string | undefined;
  if (sourceCurrency !== targetCurrency) {
    const sourceAmount = Math.ceil((convertMinor(world, amountMinor, targetCurrency, sourceCurrency) ?? 0) * 1.01);
    const fx = executeFxConversion(world, parent.id, source.id, targetCurrencyAccount.id, sourceAmount);
    if (!fx.ok) return null;
    fxTradeId = fx.tradeId;
  }
  const tx = transferBankAccountBalance(world, targetCurrencyAccount.id, recipient.id, amountMinor, "CAPITAL_CONTRIBUTION", `Прямые инвестиции ${parent.name} → ${target.name}`);
  if (!tx) return null;
  const investmentId = `fdi-investment:${parent.id}:${target.id}`;
  const capitalId = accountIds.contributedEquity(target.id);
  ensureAccount(world.ledger, investmentId, parent.id, `Прямые инвестиции · ${target.name}`, "asset", targetCurrency);
  ensureAccount(world.ledger, capitalId, target.id, "Капитал иностранного собственника", "equity", targetCurrency);
  const investmentTx = postTransaction(world, "CAPITAL_CONTRIBUTION", `Признание прямой инвестиции ${parent.name} → ${target.name}`, [
    { accountId: investmentId, side: "debit", amountCents: amountMinor },
    { accountId: capitalId, side: "credit", amountCents: amountMinor },
  ], [tx]);
  target.corporateStatus = "subsidiary";
  target.parentCompanyId = parent.id;
  if (!parent.subsidiaryIds.includes(target.id)) parent.subsidiaryIds.push(target.id);
  const fdi: ForeignDirectInvestment = { id: `fdi-${String(world.nextFdiId++).padStart(7, "0")}`, investorCountryId: parent.headquartersCountryId, destinationCountryId, parentCompanyId: parent.id, subsidiaryCompanyId: target.id, currencyId: targetCurrency, investedAmountMinor: amountMinor, votingShareBps: 5_100, openedAtMonth: world.clock.elapsedMonths, transactionIds: [tx, investmentTx, ...(fxTradeId ? [fxTradeId] : [])], status: "active" };
  world.foreignDirectInvestments.push(fdi);
  currentBopRecord(world, destinationCountryId).directInvestmentNetInflowUsdMinor += convertMinor(world, amountMinor, targetCurrency, "USD") ?? 0;
  currentBopRecord(world, parent.headquartersCountryId).directInvestmentNetInflowUsdMinor -= convertMinor(world, amountMinor, targetCurrency, "USD") ?? 0;
  return fdi;
}

export function purchaseForeignEquity(world: WorldState, investorId: string, securityId: string, shares: number): InternationalPortfolioPosition | null {
  const investorCountryId = countryOfEntity(world, investorId);
  const security = world.equitySecurities.find((item) => item.id === securityId);
  const issuer = security && world.companies.find((company) => company.id === security.companyId);
  const seller = security && world.equityHoldings.find((holding) => holding.securityId === securityId && holding.shares >= shares);
  const listing = world.listings.find((item) => item.securityId === securityId);
  if (!investorCountryId || !security || !issuer || !seller || issuer.headquartersCountryId === investorCountryId || shares <= 0) return null;
  const price = listing?.lastPriceCents ?? Math.max(1, Math.round(seller.costBasisCents / Math.max(1, seller.shares)));
  const value = price * shares;
  const homeCurrency = countryCurrency(world, investorCountryId);
  const home = ensureCurrencyAccount(world, investorId, homeCurrency);
  const foreign = ensureCurrencyAccount(world, investorId, security.currencyId);
  const sellerAccount = ensureCurrencyAccount(world, seller.ownerId, security.currencyId);
  if (!home || !foreign || !sellerAccount) return null;
  if (homeCurrency !== security.currencyId) {
    const homeAmount = convertMinor(world, Math.ceil(value * 1.01), security.currencyId, homeCurrency) ?? 0;
    if (!executeFxConversion(world, investorId, home.id, foreign.id, homeAmount).ok) return null;
  }
  const result = transferShares(world, securityId, seller.ownerId, investorId, shares, price, "EQUITY_SECONDARY", { buyerBankAccountId: foreign.id, sellerBankAccountId: sellerAccount.id });
  if (!result.ok) return null;
  const position: InternationalPortfolioPosition = { id: `international-position-${String(world.nextInternationalPositionId++).padStart(8, "0")}`, ownerId: investorId, ownerCountryId: investorCountryId, issuerCountryId: issuer.headquartersCountryId, instrumentType: "equity", instrumentId: securityId, quantity: shares, acquisitionValueMinor: value, currencyId: security.currencyId, openedAtMonth: world.clock.elapsedMonths };
  world.internationalPortfolioPositions.push(position);
  const usd = convertMinor(world, value, security.currencyId, "USD") ?? 0;
  currentBopRecord(world, issuer.headquartersCountryId).portfolioNetInflowUsdMinor += usd;
  currentBopRecord(world, investorCountryId).portfolioNetInflowUsdMinor -= usd;
  return position;
}

export function issueCrossBorderLoan(world: WorldState, lenderBankId: string, borrowerId: string, principalMinor: number, termMonths = 24): CrossBorderLoanExposure | null {
  const bank = world.banks.find((item) => item.id === lenderBankId);
  const borrowerCountryId = countryOfEntity(world, borrowerId) ?? world.governments.find((item) => item.id === borrowerId)?.countryId ?? null;
  if (!bank || !borrowerCountryId || borrowerCountryId === bank.countryId || principalMinor <= 0) return null;
  const lender = ensureCurrencyAccount(world, bank.id, bank.baseCurrency);
  const borrower = ensureCurrencyAccount(world, borrowerId, bank.baseCurrency);
  if (!lender || !borrower || bankAccountBalance(world, lender.id) < principalMinor) return null;
  const tx = transferBankAccountBalance(world, lender.id, borrower.id, principalMinor, "LOAN_ISSUED", `Трансграничный кредит ${bank.name}`);
  if (!tx) return null;
  const exposureNumber = world.nextCrossBorderLoanId++;
  const loanAssetId = `cross-border-loan-asset:${bank.id}:${exposureNumber}`;
  const loanLiabilityId = `cross-border-loan-liability:${borrowerId}:${exposureNumber}`;
  ensureAccount(world.ledger, loanAssetId, bank.id, `Трансграничный кредит · ${borrowerId}`, "asset", bank.baseCurrency);
  ensureAccount(world.ledger, loanLiabilityId, borrowerId, `Внешний долг · ${bank.name}`, "liability", bank.baseCurrency);
  const recognitionTx = postTransaction(world, "LOAN_ISSUED", `Признание трансграничного кредита ${bank.name}`, [
    { accountId: loanAssetId, side: "debit", amountCents: principalMinor },
    { accountId: loanLiabilityId, side: "credit", amountCents: principalMinor },
  ], [tx]);
  const reportingValueUsdMinor = convertMinor(world, principalMinor, bank.baseCurrency, "USD") ?? 0;
  const exposure: CrossBorderLoanExposure = { id: `cross-border-loan-${String(exposureNumber).padStart(8, "0")}`, lenderId: bank.id, lenderCountryId: bank.countryId, borrowerId, borrowerCountryId, currencyId: bank.baseCurrency, originalPrincipalMinor: principalMinor, remainingPrincipalMinor: principalMinor, annualRateBps: bank.baseSpreadBps + 450, maturityMonth: world.clock.elapsedMonths + termMonths, reportingValueUsdMinor, borrowerCurrencyBurdenMinor: convertMinor(world, principalMinor, bank.baseCurrency, countryCurrency(world, borrowerCountryId)) ?? 0, transactionIds: [tx, recognitionTx], status: "active" };
  world.crossBorderLoans.push(exposure);
  currentBopRecord(world, borrowerCountryId).otherInvestmentNetInflowUsdMinor += reportingValueUsdMinor;
  currentBopRecord(world, bank.countryId).otherInvestmentNetInflowUsdMinor -= reportingValueUsdMinor;
  return exposure;
}

export function repriceCrossBorderLoans(world: WorldState): void {
  for (const loan of world.crossBorderLoans.filter((item) => item.status === "active")) {
    loan.reportingValueUsdMinor = convertMinor(world, loan.remainingPrincipalMinor, loan.currencyId, "USD") ?? loan.reportingValueUsdMinor;
    loan.borrowerCurrencyBurdenMinor = convertMinor(world, loan.remainingPrincipalMinor, loan.currencyId, countryCurrency(world, loan.borrowerCountryId)) ?? loan.borrowerCurrencyBurdenMinor;
  }
}

export function interveneFx(world: WorldState, countryId: string, sellCurrencyId: string, buyCurrencyId: string, amountMinor: number): { ok: boolean; tradeId?: string } {
  const portfolio = world.reservePortfolios.find((item) => item.countryId === countryId);
  if (!portfolio || amountMinor <= 0) return { ok: false };
  const source = portfolio.accountIdsByCurrency[sellCurrencyId] && world.bankAccounts.find((account) => account.id === portfolio.accountIdsByCurrency[sellCurrencyId]);
  const target = ensureCurrencyAccount(world, portfolio.centralBankId, buyCurrencyId);
  if (!source || !target || bankAccountBalance(world, source.id) < amountMinor) return { ok: false };
  const result = executeFxConversion(world, portfolio.centralBankId, source.id, target.id, amountMinor);
  if (!result.ok) return { ok: false };
  const usd = convertMinor(world, amountMinor, sellCurrencyId, "USD") ?? 0;
  portfolio.totalUsdMinor = Math.max(0, portfolio.totalUsdMinor - result.quote!.feeMinor);
  const bop = currentBopRecord(world, countryId);
  bop.reserveChangeUsdMinor -= usd;
  const regime = world.fxRegimes.find((item) => item.countryId === countryId);
  if (regime) { regime.defenseCapacityUsdMinor = portfolio.totalUsdMinor; regime.status = portfolio.totalUsdMinor < 10_000_000 ? "failed" : "under-pressure"; }
  return { ok: true, tradeId: result.tradeId };
}

export function createCommodityFutureHedge(world: WorldState, companyId: string, commodityId: string, isProducer: boolean) {
  const company = world.companies.find((item) => item.id === companyId);
  const counterparty = world.fxDealers[0];
  const exchange = company && world.exchanges.find((item) => item.countryId === company.headquartersCountryId);
  if (!company || !counterparty || !exchange || !world.globalCommodities.some((item) => item.id === commodityId)) return null;
  ensureCurrencyAccount(world, company.id, exchange.currencyId);
  ensureCurrencyAccount(world, counterparty.id, exchange.currencyId);
  return createFuture(world, isProducer ? counterparty.id : company.id, isProducer ? company.id : counterparty.id, { kind: "commodity", commodityId }, exchange.id, 1, 10, 6);
}
