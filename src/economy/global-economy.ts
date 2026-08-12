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
  return fund ? world.assetManagers.find((item) => item.id === fund.managerId)?.countryId ?? null : null;
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
      routes.push({ id: routeId(origin.id, destination.id), originCountryId: origin.id, destinationCountryId: destination.id, mode, capacityMilliUnits: mode === "sea" ? 1_500_000 : 850_000, usedCapacityMilliUnits: 0, costUsdMinorPerUnit: modeCost, transitDays: mode === "sea" ? 22 : mode === "rail" ? 9 : 5, active: true });
    }
  }
  return routes;
}

export function seedGlobalEconomy(world: WorldState): void {
  world.globalCommodities = structuredClone(GLOBAL_COMMODITIES);
  world.commodityMarkets = GLOBAL_COMMODITIES.map((commodity) => ({ commodityId: commodity.id, spotPriceUsdMinor: commodity.baseSpotPriceMinor, previousSpotPriceUsdMinor: commodity.baseSpotPriceMinor, globalProductionMilliUnits: 0, globalConsumptionMilliUnits: 0, globalInventoryMilliUnits: 0, monthlyVolumeMilliUnits: 0, shortageBps: 0 }));
  world.resourceDeposits = Object.entries(RESOURCE_ENDOWMENT_INDEX).flatMap(([countryId, endowments]) => Object.entries(endowments).map(([commodityId, indexBps]) => {
    const reserves = Math.round(12_000_000 * indexBps / 10_000);
    return { id: `deposit-${countryId}-${commodityId}`, countryId, commodityId, provenReservesMilliUnits: reserves, extractableReservesMilliUnits: Math.round(reserves * 0.82), monthlyCapacityMilliUnits: Math.max(1_500, Math.round(42_000 * indexBps / 10_000)), extractionCostUsdMinor: Math.max(25, Math.round(GLOBAL_COMMODITIES.find((commodity) => commodity.id === commodityId)!.baseSpotPriceMinor * (11_000 - indexBps / 2) / 20_000)), infrastructureBps: clamp(6_400 + Math.round(indexBps / 4), 6_000, 9_500), technologyBps: clamp(6_800 + Math.round(indexBps / 5), 6_500, 9_500), depletionBps: 0, active: true, sourceType: "ESTIMATED" as const };
  }));
  world.countryCommodityStates = world.countries.flatMap((country) => GLOBAL_COMMODITIES.map((commodity) => ({ countryId: country.id, commodityId: commodity.id, productionMilliUnits: 0, consumptionMilliUnits: 0, inventoryMilliUnits: commodity.storable ? 18_000 : 0, domesticDemandMilliUnits: 0, importDemandMilliUnits: 0, exportSupplyMilliUnits: 0, marginalCostUsdMinor: commodity.baseSpotPriceMinor })));
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
  world.fxRegimes = world.countries.map((country) => ({ countryId: country.id, regime: country.id === "nl" ? "PEG" as const : ["ru", "kr"].includes(country.id) ? "MANAGED_FLOAT" as const : "FLOATING" as const, anchorCurrencyId: country.currencyReference === "EUR" ? "EUR" : "USD", targetRatePpm: fxRatePpm(world, country.currencyReference, country.currencyReference === "EUR" ? "EUR" : "USD") ?? 1_000_000, bandBps: country.id === "nl" ? 50 : 500, defenseCapacityUsdMinor: 0, status: "stable" as const }));
  world.fxPressureHistory = [];
  seedReservePortfolios(world);
}

function seedReservePortfolios(world: WorldState): void {
  const weights: Record<string, number> = { USD: 5_500, EUR: 2_500, JPY: 700, GBP: 500, CAD: 400, KRW: 200, RUB: 200 };
  world.reservePortfolios = world.countries.map((country): ReservePortfolio => {
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === country.id);
    const desiredUsdMinor = Math.max(80_000_000, Math.round((pack?.reservesUsd ?? 50_000_000_000) / 1_000));
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
  return Math.round(firms * advantage / 1_000_000);
}

function demandFor(world: WorldState, countryId: string, commodityId: string): number {
  const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === countryId);
  const commodity = world.globalCommodities.find((item) => item.id === commodityId)!;
  const populationScale = Math.max(1_500, Math.round((pack?.population ?? 20_000_000) / 8_000));
  const categoryWeight = commodity.category === "energy" ? 130 : commodity.category === "agriculture" ? 95 : commodity.category === "metals" ? 55 : commodity.category === "industrial" ? 80 : 70;
  return Math.round(populationScale * categoryWeight / 100);
}

function representativeCompany(world: WorldState, countryId: string, commodityId: string) {
  const linked = world.globalCommodities.find((item) => item.id === commodityId)?.linkedGoodId;
  return world.companies.find((company) => company.active && company.headquartersCountryId === countryId && company.goodId === linked)
    ?? world.companies.find((company) => company.active && company.headquartersCountryId === countryId)
    ?? null;
}

function settleTrade(world: WorldState, exporterCountryId: string, importerCountryId: string, commodityId: string, quantityMilliUnits: number, route: TradeRoute): TradeFlow | null {
  const exporter = representativeCompany(world, exporterCountryId, commodityId);
  const importer = representativeCompany(world, importerCountryId, commodityId);
  const market = world.commodityMarkets.find((item) => item.commodityId === commodityId)!;
  if (!exporter || !importer || quantityMilliUnits <= 0) return null;
  const invoiceCurrencyId = countryCurrency(world, exporterCountryId);
  const valueUsdMinor = Math.max(1, Math.round(quantityMilliUnits * market.spotPriceUsdMinor / 1_000));
  const invoiceValueMinor = convertMinor(world, valueUsdMinor, "USD", invoiceCurrencyId) ?? valueUsdMinor;
  const nativeCurrencyId = countryCurrency(world, importerCountryId);
  const nativeAccount = ensureCurrencyAccount(world, importer.id, nativeCurrencyId);
  const invoiceAccount = ensureCurrencyAccount(world, importer.id, invoiceCurrencyId);
  const exporterAccount = ensureCurrencyAccount(world, exporter.id, invoiceCurrencyId);
  let fxTradeId: string | null = null;
  if (!nativeAccount || !invoiceAccount || !exporterAccount) return null;
  if (invoiceCurrencyId !== nativeCurrencyId) {
    const requiredNative = convertMinor(world, Math.ceil(invoiceValueMinor * 1.01), invoiceCurrencyId, nativeCurrencyId) ?? 0;
    if (requiredNative <= 0 || bankAccountBalance(world, nativeAccount.id) < requiredNative) return null;
    const converted = executeFxConversion(world, importer.id, nativeAccount.id, invoiceAccount.id, requiredNative);
    if (!converted.ok || bankAccountBalance(world, invoiceAccount.id) < invoiceValueMinor) return null;
    fxTradeId = converted.tradeId ?? null;
  } else if (bankAccountBalance(world, invoiceAccount.id) < invoiceValueMinor) return null;
  const payment = settleFinancialPayment(world, importer.id, exporter.id, invoiceCurrencyId, invoiceValueMinor, "GOODS_CLEARING", `Международная поставка ${commodityId}`);
  if (!payment) return null;
  const transportCostUsdMinor = Math.round(quantityMilliUnits * route.costUsdMinorPerUnit / 1_000);
  route.usedCapacityMilliUnits += quantityMilliUnits;
  return {
    id: `trade-flow-${String(world.nextTradeFlowId++).padStart(9, "0")}`, elapsedMonth: world.clock.elapsedMonths, exporterCountryId, importerCountryId,
    exporterId: exporter.id, importerId: importer.id, commodityId, quantityMilliUnits, unitPriceUsdMinor: market.spotPriceUsdMinor, invoiceCurrencyId, invoiceValueMinor,
    routeId: route.id, transportCostUsdMinor, tariffUsdMinor: 0, paymentTransactionIds: [payment], fxTradeId, status: "settled",
  };
}

function clearGlobalCommodityMarkets(world: WorldState): void {
  // The model rotates covered markets and keeps one aggregated bilateral
  // shipment per selected market. Every commodity is reached within 3 months.
  let remainingFlowBudget = 8;
  const selectedMarkets = new Set(Array.from({ length: 8 }, (_, offset) => world.commodityMarkets[(world.clock.elapsedMonths * 8 + offset) % world.commodityMarkets.length].commodityId));
  for (const route of world.tradeRoutes) route.usedCapacityMilliUnits = 0;
  for (const market of world.commodityMarkets) {
    const commodity = world.globalCommodities.find((item) => item.id === market.commodityId)!;
    const states = world.countryCommodityStates.filter((state) => state.commodityId === commodity.id);
    for (const state of states) {
      state.productionMilliUnits = productionCapacity(world, state.countryId, commodity.id);
      state.domesticDemandMilliUnits = demandFor(world, state.countryId, commodity.id);
      state.consumptionMilliUnits = Math.min(state.domesticDemandMilliUnits, state.productionMilliUnits + state.inventoryMilliUnits);
      const physicalAvailable = state.productionMilliUnits + state.inventoryMilliUnits - state.consumptionMilliUnits;
      state.exportSupplyMilliUnits = Math.max(0, Math.round(physicalAvailable * 0.72));
      state.importDemandMilliUnits = Math.max(0, state.domesticDemandMilliUnits - state.consumptionMilliUnits);
      state.inventoryMilliUnits = Math.max(0, physicalAvailable);
    }
    const exporters = states.filter((state) => state.exportSupplyMilliUnits > 0).sort((a, b) => b.exportSupplyMilliUnits - a.exportSupplyMilliUnits);
    const importers = states.filter((state) => state.importDemandMilliUnits > 0).sort((a, b) => b.importDemandMilliUnits - a.importDemandMilliUnits);
    market.monthlyVolumeMilliUnits = 0;
    let marketMatched = false;
    for (const importer of importers) {
      if (remainingFlowBudget <= 0 || marketMatched || !selectedMarkets.has(commodity.id)) break;
      for (const exporter of exporters) {
        if (exporter.countryId === importer.countryId || importer.importDemandMilliUnits <= 0 || exporter.exportSupplyMilliUnits <= 0) continue;
        const route = world.tradeRoutes.find((item) => item.originCountryId === exporter.countryId && item.destinationCountryId === importer.countryId && item.active);
        if (!route) continue;
        const routeCapacity = route.capacityMilliUnits - route.usedCapacityMilliUnits;
        const quantity = Math.min(importer.importDemandMilliUnits, exporter.exportSupplyMilliUnits, routeCapacity, 12_000);
        const flow = settleTrade(world, exporter.countryId, importer.countryId, commodity.id, quantity, route);
        if (!flow) continue;
        world.tradeFlows.push(flow);
        remainingFlowBudget -= 1;
        marketMatched = true;
        exporter.exportSupplyMilliUnits -= quantity;
        exporter.inventoryMilliUnits -= quantity;
        importer.importDemandMilliUnits -= quantity;
        importer.inventoryMilliUnits += quantity;
        market.monthlyVolumeMilliUnits += quantity;
        break;
      }
    }
    market.globalProductionMilliUnits = states.reduce((sum, state) => sum + state.productionMilliUnits, 0);
    market.globalConsumptionMilliUnits = states.reduce((sum, state) => sum + state.consumptionMilliUnits, 0);
    market.globalInventoryMilliUnits = states.reduce((sum, state) => sum + state.inventoryMilliUnits, 0);
    const unmet = states.reduce((sum, state) => sum + state.importDemandMilliUnits, 0);
    market.shortageBps = clamp(Math.round(unmet * 10_000 / Math.max(1, states.reduce((sum, state) => sum + state.domesticDemandMilliUnits, 0))), 0, 10_000);
    market.previousSpotPriceUsdMinor = market.spotPriceUsdMinor;
    const inventoryCover = market.globalInventoryMilliUnits * 10_000 / Math.max(1, market.globalConsumptionMilliUnits);
    market.spotPriceUsdMinor = clamp(Math.round(market.spotPriceUsdMinor * (10_000 + Math.round(market.shortageBps / 15) - Math.round((inventoryCover - 4_000) / 80)) / 10_000), Math.round(commodity.baseSpotPriceMinor * 0.35), Math.round(commodity.baseSpotPriceMinor * 4));
  }
}

function updateSupplyChains(world: WorldState): void {
  for (const inventory of world.countrySectorInventories) {
    const commodity = world.countryCommodityStates.find((state) => state.countryId === inventory.countryId && state.commodityId === inventory.inputCommodityId);
    const coefficient = world.inputOutputCoefficients.find((item) => item.outputSectorId === inventory.sectorId && item.inputCommodityId === inventory.inputCommodityId)!;
    const output = world.companies.filter((company) => company.active && company.headquartersCountryId === inventory.countryId && company.goodId === inventory.sectorId).reduce((sum, company) => sum + Math.max(company.lastProductionMilliUnits, Math.round(company.capacityMilliUnits * 0.25)), 0);
    inventory.inventoryMilliUnits += Math.round((commodity?.inventoryMilliUnits ?? 0) * 0.12);
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
  record = { countryId, elapsedMonth: world.clock.elapsedMonths, goodsExportsUsdMinor: 0, goodsImportsUsdMinor: 0, servicesBalanceUsdMinor: 0, primaryIncomeBalanceUsdMinor: 0, secondaryIncomeBalanceUsdMinor: 0, currentAccountUsdMinor: 0, capitalAccountUsdMinor: 0, directInvestmentNetInflowUsdMinor: 0, portfolioNetInflowUsdMinor: 0, otherInvestmentNetInflowUsdMinor: 0, financialAccountUsdMinor: 0, reserveChangeUsdMinor: 0, errorsAndOmissionsUsdMinor: 0, reconciliationGapUsdMinor: 0, causeFlowIds: [] };
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
    bop.financialAccountUsdMinor = bop.directInvestmentNetInflowUsdMinor + bop.portfolioNetInflowUsdMinor + bop.otherInvestmentNetInflowUsdMinor;
    bop.errorsAndOmissionsUsdMinor = -(bop.currentAccountUsdMinor + bop.capitalAccountUsdMinor + bop.financialAccountUsdMinor + bop.reserveChangeUsdMinor);
    bop.reconciliationGapUsdMinor = bop.currentAccountUsdMinor + bop.capitalAccountUsdMinor + bop.financialAccountUsdMinor + bop.reserveChangeUsdMinor + bop.errorsAndOmissionsUsdMinor;
    const reserve = world.reservePortfolios.find((item) => item.countryId === country.id);
    const fdiAssets = world.foreignDirectInvestments.filter((item) => item.investorCountryId === country.id && item.status === "active").reduce((sum, item) => sum + (convertMinor(world, item.investedAmountMinor, item.currencyId, "USD") ?? 0), 0);
    const fdiLiabilities = world.foreignDirectInvestments.filter((item) => item.destinationCountryId === country.id && item.status === "active").reduce((sum, item) => sum + (convertMinor(world, item.investedAmountMinor, item.currencyId, "USD") ?? 0), 0);
    const portfolioAssets = world.internationalPortfolioPositions.filter((item) => item.ownerCountryId === country.id).reduce((sum, item) => sum + (convertMinor(world, item.acquisitionValueMinor, item.currencyId, "USD") ?? 0), 0);
    const portfolioLiabilities = world.internationalPortfolioPositions.filter((item) => item.issuerCountryId === country.id).reduce((sum, item) => sum + (convertMinor(world, item.acquisitionValueMinor, item.currencyId, "USD") ?? 0), 0);
    const otherAssets = world.crossBorderLoans.filter((loan) => loan.lenderCountryId === country.id && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0);
    const otherLiabilities = world.crossBorderLoans.filter((loan) => loan.borrowerCountryId === country.id && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0);
    const point: InternationalInvestmentPosition = { countryId: country.id, elapsedMonth: world.clock.elapsedMonths, directInvestmentAssetsUsdMinor: fdiAssets, directInvestmentLiabilitiesUsdMinor: fdiLiabilities, portfolioAssetsUsdMinor: portfolioAssets, portfolioLiabilitiesUsdMinor: portfolioLiabilities, otherInvestmentAssetsUsdMinor: otherAssets, otherInvestmentLiabilitiesUsdMinor: otherLiabilities, reserveAssetsUsdMinor: reserve?.totalUsdMinor ?? 0, netInternationalInvestmentPositionUsdMinor: fdiAssets + portfolioAssets + otherAssets + (reserve?.totalUsdMinor ?? 0) - fdiLiabilities - portfolioLiabilities - otherLiabilities, publicExternalDebtUsdMinor: world.crossBorderLoans.filter((loan) => loan.borrowerCountryId === country.id && loan.borrowerId.startsWith("government-") && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0), privateExternalDebtUsdMinor: otherLiabilities, shortTermExternalDebtUsdMinor: world.crossBorderLoans.filter((loan) => loan.borrowerCountryId === country.id && loan.maturityMonth - world.clock.elapsedMonths <= 12 && loan.status === "active").reduce((sum, loan) => sum + loan.reportingValueUsdMinor, 0) };
    world.internationalInvestmentPositions.push(point);
    const tradePressure = bop.goodsExportsUsdMinor - bop.goodsImportsUsdMinor;
    const capitalPressure = bop.financialAccountUsdMinor;
    const homeRate = world.centralBanks.find((bank) => bank.id === country.centralBankId)?.policyRateBps ?? 0;
    const usdRate = world.centralBanks.find((bank) => bank.currencyId === "USD")?.policyRateBps ?? 0;
    world.fxPressureHistory.push({ countryId: country.id, elapsedMonth: world.clock.elapsedMonths, tradePressureUsdMinor: tradePressure, capitalFlowPressureUsdMinor: capitalPressure, rateDifferentialBps: homeRate - usdRate, interventionUsdMinor: -bop.reserveChangeUsdMinor, netPressureUsdMinor: tradePressure + capitalPressure, causeIds: bop.causeFlowIds });
  }
  world.balanceOfPayments = world.balanceOfPayments.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 60);
  world.internationalInvestmentPositions = world.internationalInvestmentPositions.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 60);
  world.fxPressureHistory = world.fxPressureHistory.filter((point) => point.elapsedMonth >= world.clock.elapsedMonths - 60);
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
}

export function runGlobalEconomyMonth(world: WorldState): void {
  clearGlobalCommodityMarkets(world);
  updateSupplyChains(world);
  updateEnergyBalances(world);
  repriceCrossBorderLoans(world);
  updateExternalAccounts(world);
  compactTradeFlows(world);
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
