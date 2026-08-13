import { accountIds, balanceOf, ensureAccount, postTransaction, seedBankCapital, seedDeposit } from "../core/ledger.ts";
import { REAL_COUNTRY_PACKS } from "../data/real-world/country-packs.ts";
import type {
  BankingSectorCohort,
  CountryScaleReconciliation,
  LogisticsSectorState,
  RealWorldInitializationReport,
  SovereignHolderCohort,
  SovereignHolderType,
  SovereignMaturityBucket,
  TradeSectorState,
  WorldState,
} from "../domain/model.ts";
import { convertMinor } from "../finance/currencies.ts";

const MATURITY_MONTHS: Record<SovereignMaturityBucket, number> = { short: 12, "2y": 24, "5y": 60, "10y": 120, long: 240 };
const HOLDER_WEIGHTS: Array<[SovereignHolderType, number]> = [
  ["DOMESTIC_BANKS", 2_700], ["DOMESTIC_FUNDS", 2_000], ["HOUSEHOLDS", 1_200], ["FOREIGN_INVESTORS", 2_000], ["CENTRAL_BANK", 700], ["OTHER_INSTITUTIONS", 1_400],
];

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function targetMonthlyGdpMinor(world: WorldState, countryId: string): number {
  const profile = world.countryEconomicProfiles.find((item) => item.countryId === countryId);
  if (!profile) return 0;
  return Math.round(profile.baselineNominalGdpMinor / 12);
}

function scaleFirmCohorts(world: WorldState, countryId: string, targetMonthly: number): void {
  const cohorts = world.firmCohorts.filter((item) => item.countryId === countryId);
  const explicit = world.companies.filter((item) => item.active && item.headquartersCountryId === countryId);
  const publicOther = Math.round(targetMonthly * 1_400 / 10_000);
  const logistics = Math.round(targetMonthly * 350 / 10_000);
  const explicitValue = Math.round(targetMonthly * Math.min(1_800, Math.max(600, explicit.length * 180)) / 10_000);
  const cohortTarget = Math.max(0, targetMonthly - publicOther - logistics - explicitValue);
  const current = Math.max(1, cohorts.reduce((sum, cohort) => sum + Math.max(1, cohort.valueAddedMinor), 0));
  for (const cohort of cohorts) {
    const share = cohort.valueAddedMinor / current;
    cohort.valueAddedMinor = Math.max(1, Math.round(cohortTarget * share));
    cohort.intermediateConsumptionMinor = Math.max(1, Math.round(cohort.valueAddedMinor * 7_600 / 10_000));
    cohort.revenueCents = cohort.valueAddedMinor + cohort.intermediateConsumptionMinor;
    cohort.profitsCents = Math.round(cohort.valueAddedMinor * 1_100 / 10_000);
    cohort.capitalCents = Math.round(cohort.revenueCents * 18);
    cohort.debtCents = Math.round(cohort.capitalCents * 3_500 / 10_000);
    cohort.outputScaleBps = Math.round(cohort.valueAddedMinor * 10_000 / Math.max(1, targetMonthly));
    seedDeposit(world, cohort.id, cohort.bankId, Math.max(1, cohort.revenueCents * 8));
  }
    for (const company of explicit) {
    const companyTarget = Math.round(explicitValue / Math.max(1, explicit.length));
    const revenue = Math.round(companyTarget / 0.34);
    const profit = Math.round(revenue * (company.representationTier === "A" ? 1_700 : 900) / 10_000);
    company.baselineFinancials = {
      revenueMinor: revenue * 12, profitMinor: profit * 12, assetsMinor: revenue * 24, debtMinor: revenue * 7, cashMinor: revenue * 2,
      employees: Math.max(company.employees.length, Math.round(revenue / Math.max(1, company.wageCents) * 0.18)), marketCapMinor: company.corporateStatus === "public" ? revenue * 30 : null, sourceType: "CALIBRATED",
    };
    company.capacityMilliUnits = Math.max(company.capacityMilliUnits, Math.round(revenue * 1_000 / Math.max(1, company.priceCents)));
    company.productiveCapital.bookValueCents = company.baselineFinancials.assetsMinor;
    company.productiveCapital.acquisitionCostCents = company.baselineFinancials.assetsMinor;
    const productiveCapitalAccountId = accountIds.productiveCapital(company.id);
    const ledgerCapital = balanceOf(world, productiveCapitalAccountId);
    const capitalAdjustment = company.productiveCapital.bookValueCents - ledgerCapital;
    if (capitalAdjustment > 0) {
      const currencyId = world.banks.find((item) => item.id === company.bankId)?.baseCurrency ?? "USD";
      ensureAccount(world.ledger, productiveCapitalAccountId, company.id, "Производственный капитал", "asset", currencyId);
      ensureAccount(world.ledger, accountIds.openingEquity(company.id), company.id, "Начальный капитал", "equity", currencyId);
      postTransaction(world, "GENESIS", `Калибровка производственного капитала: ${company.name}`, [
        { accountId: productiveCapitalAccountId, side: "debit", amountCents: capitalAdjustment },
        { accountId: accountIds.openingEquity(company.id), side: "credit", amountCents: capitalAdjustment },
      ]);
    }
    seedDeposit(world, company.id, company.bankId, Math.max(1, company.baselineFinancials.cashMinor));
  }
}

function seedScaleSectors(world: WorldState): void {
  world.tradeSectors = [];
  world.logisticsSectors = [];
  world.bankingSectorCohorts = [];
  for (const country of world.countries) {
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === country.id);
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id)!;
    const targetMonthly = targetMonthlyGdpMinor(world, country.id);
    scaleFirmCohorts(world, country.id, targetMonthly);
    const primaryBank = world.banks.find((item) => item.countryId === country.id)!;
    const trade: TradeSectorState = {
      id: `trade-sector-${country.id}`, countryId: country.id, bankId: primaryBank.id,
      firmCountEquivalent: Math.max(100, Math.round(world.firmCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.firmCountEquivalent, 0) * 0.12)),
      exportCapacityUsdMinor: Math.round((pack?.exportsUsd ?? 0) * 100 / 12), importBudgetUsdMinor: Math.round((pack?.importsUsd ?? 0) * 100 / 12), reliabilityBps: 8_200,
      lastExportRevenueUsdMinor: 0, lastImportCostUsdMinor: 0, tradeFinanceLiabilityUsdMinor: 0, tradeCalibrationFactorBps: 10_000,
    };
    const logistics: LogisticsSectorState = {
      id: `logistics-sector-${country.id}`, countryId: country.id, bankId: primaryBank.id,
      capacityMilliUnits: Math.max(1_000_000, world.cities.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.logisticsCapacityMilliUnits, 0)),
      revenueUsdMinor: 0, profitUsdMinor: 0, employmentEquivalent: Math.round(profile.population * 420 / 10_000), fuelDemandMilliUnits: 0,
    };
    const bankTarget = Math.round(targetMonthly * 12 * (pack?.bankingAssetsToGdpBps ?? profile.bankingDepthBps) / 10_000);
    const explicitAssets = Math.round(bankTarget * 5_500 / 10_000);
    const bankShare = Math.round(explicitAssets / Math.max(1, country.bankIds.length));
    for (const bank of world.banks.filter((item) => item.countryId === country.id)) {
      const financials = { assetsMinor: bankShare, loansMinor: Math.round(bankShare * 5_600 / 10_000), depositsMinor: Math.round(bankShare * 6_800 / 10_000), capitalMinor: Math.round(bankShare * 900 / 10_000), liquidityMinor: Math.round(bankShare * 1_500 / 10_000), sourceType: "CALIBRATED" as const };
      bank.baselineFinancials = financials;
      seedBankCapital(world, bank.id, Math.max(1, financials.capitalMinor));
      const settlementBank = world.banks.find((item) => item.countryId === country.id && item.id !== bank.id) ?? bank;
      seedDeposit(world, bank.id, settlementBank.id, Math.max(1, financials.liquidityMinor));
    }
    const other: BankingSectorCohort = {
      id: `other-banks-${country.id}`, countryId: country.id, bankId: primaryBank.id, bankCountEquivalent: Math.max(5, Math.round(profile.population / 2_000_000)),
      assetsMinor: Math.max(0, bankTarget - explicitAssets), loansMinor: Math.round((bankTarget - explicitAssets) * 5_600 / 10_000), depositsMinor: Math.round((bankTarget - explicitAssets) * 6_800 / 10_000),
      capitalMinor: Math.round((bankTarget - explicitAssets) * 900 / 10_000), liquidityMinor: Math.round((bankTarget - explicitAssets) * 1_500 / 10_000),
    };
    world.tradeSectors.push(trade); world.logisticsSectors.push(logistics); world.bankingSectorCohorts.push(other);
    seedDeposit(world, trade.id, primaryBank.id, Math.max(1, convertMinor(world, trade.importBudgetUsdMinor * 2, "USD", country.currencyReference) ?? trade.importBudgetUsdMinor));
    seedDeposit(world, logistics.id, primaryBank.id, Math.max(1, convertMinor(world, Math.round(targetMonthly * 500 / 10_000), country.currencyReference, country.currencyReference) ?? 1));
    seedDeposit(world, other.id, primaryBank.id, Math.max(1, other.liquidityMinor));
    seedDeposit(world, country.governmentId, primaryBank.id, Math.max(1, Math.round(targetMonthly * profile.governmentSpendingShareBps / 10_000 * 8)));
    for (const fund of world.funds.filter((item) => world.assetManagers.find((manager) => manager.id === item.managerId)?.countryId === country.id)) {
      seedDeposit(world, fund.id, primaryBank.id, Math.max(1, Math.round(targetMonthly * 12 * profile.savingsRateBps / 10_000 / Math.max(1, world.funds.filter((item) => world.assetManagers.find((manager) => manager.id === item.managerId)?.countryId === country.id).length))));
    }
  }
  const worldMonthlyUsdMinor = REAL_COUNTRY_PACKS.reduce((sum, pack) => sum + Math.round(pack.nominalGdpUsd * 100 / 12), 0);
  const dealer = world.fxDealers[0];
  if (dealer) for (const currency of world.currencies) {
    const bank = world.banks.find((item) => item.baseCurrency === currency.id);
    const amount = bank ? convertMinor(world, Math.round(worldMonthlyUsdMinor * 0.45), "USD", currency.id) : null;
    if (bank && amount) {
      const seeded = Math.min(4_000_000_000_000_000, amount);
      seedDeposit(world, dealer.id, bank.id, seeded);
      dealer.targetInventoryByCurrency[currency.id] = Math.max(dealer.targetInventoryByCurrency[currency.id] ?? 0, seeded);
    }
  }
}

function bootstrapSovereignDebt(world: WorldState): void {
  world.sovereignHolderCohorts = [];
  for (const country of world.countries) {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id)!;
    const annualGdp = targetMonthlyGdpMinor(world, country.id) * 12;
    const targetDebt = Math.round(annualGdp * profile.governmentDebtToGdpBps / 10_000);
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === country.id)!;
    const primaryBank = world.banks.find((item) => item.countryId === country.id)!;
    const holders = HOLDER_WEIGHTS.map(([holderType, targetShareBps]): SovereignHolderCohort => ({ id: `sovereign-holder-${country.id}-${holderType.toLowerCase()}`, countryId: country.id, bankId: primaryBank.id, holderType, targetShareBps }));
    world.sovereignHolderCohorts.push(...holders);
    // Cohorts represent the whole investor sector, so their liquidity buffer
    // must be macro-scale as well. It finances rollover without pretending a
    // handful of explicit funds can absorb the national debt stock.
    for (const holder of holders) seedDeposit(world, holder.id, holder.bankId, Math.max(1, Math.round(targetDebt * holder.targetShareBps / 10_000 / 4)));
    const average = Math.max(12, profile.averageDebtMaturityMonths);
    const rawWeights = ([12, 24, 60, 120, 240] as const).map((months) => Math.exp(-Math.abs(Math.log(months / average))) * (months <= average * 2.5 ? 1 : 0.55));
    const weightTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);
    const maturityWeights = rawWeights.map((weight) => Math.round(weight * 10_000 / weightTotal));
    maturityWeights[maturityWeights.length - 1] += 10_000 - maturityWeights.reduce((sum, weight) => sum + weight, 0);
    for (const [bucketIndex, bucket] of (["short", "2y", "5y", "10y", "long"] as SovereignMaturityBucket[]).entries()) {
      const faceValue = Math.round(targetDebt * maturityWeights[bucketIndex] / 10_000);
      const yieldBps = clamp(pack.effectiveLegacyInterestRateBps + [-50, -25, 0, 25, 55][bucketIndex], 0, 3_000);
      const bondId = `sovereign-bond-${String(world.nextSovereignBondId++).padStart(8, "0")}`;
      world.sovereignBonds.push({ id: bondId, governmentId: country.governmentId, countryId: country.id, currencyId: country.currencyReference, maturityBucket: bucket, faceValueMinor: faceValue, outstandingFaceValueMinor: faceValue, couponBps: yieldBps, issuePriceMinor: faceValue, marketPriceMinor: faceValue, yieldBps, issuedAtMonth: world.clock.elapsedMonths, maturityMonth: world.clock.elapsedMonths + MATURITY_MONTHS[bucket], missedPayments: 0, legacy: true, arrearsPrincipalMinor: 0, arrearsCouponMinor: 0, status: "active" });
      const liabilityId = accountIds.sovereignBondLiability(country.governmentId, bondId);
      ensureAccount(world.ledger, liabilityId, country.governmentId, `Унаследованный государственный долг ${bondId}`, "liability", country.currencyReference);
      ensureAccount(world.ledger, accountIds.openingEquity(country.governmentId), country.governmentId, "Исторический собственный капитал", "equity", country.currencyReference);
      for (const holder of holders) {
        const amount = holder === holders.at(-1)
          ? faceValue - holders.slice(0, -1).reduce((sum, item) => sum + Math.round(faceValue * item.targetShareBps / 10_000), 0)
          : Math.round(faceValue * holder.targetShareBps / 10_000);
        const assetId = accountIds.sovereignBondAsset(holder.id, bondId);
        ensureAccount(world.ledger, assetId, holder.id, `Унаследованная государственная облигация ${bondId}`, "asset", country.currencyReference);
        ensureAccount(world.ledger, accountIds.openingEquity(holder.id), holder.id, "Исторический собственный капитал", "equity", country.currencyReference);
        postTransaction(world, "GENESIS", `Исторический долг ${country.id.toUpperCase()} · ${bucket}`, [
          { accountId: assetId, side: "debit", amountCents: amount },
          { accountId: accountIds.openingEquity(holder.id), side: "credit", amountCents: amount },
          { accountId: accountIds.openingEquity(country.governmentId), side: "debit", amountCents: amount },
          { accountId: liabilityId, side: "credit", amountCents: amount },
        ]);
        world.sovereignBondHoldings.push({ id: `sovereign-holding-${String(world.nextSovereignHoldingId++).padStart(8, "0")}`, bondId, holderId: holder.id, faceValueMinor: amount, bookValueMinor: amount, couponsReceivedMinor: 0 });
      }
    }
  }
}

export function refreshScaleReconciliation(world: WorldState): CountryScaleReconciliation[] {
  const reports = world.countries.map((country): CountryScaleReconciliation => {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id)!;
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === country.id);
    const targetMonthly = targetMonthlyGdpMinor(world, country.id);
    const explicit = Math.round(targetMonthly * Math.min(1_800, Math.max(600, world.companies.filter((item) => item.active && item.headquartersCountryId === country.id).length * 180)) / 10_000);
    const sector = world.firmCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.valueAddedMinor, 0);
    const publicOther = Math.round(targetMonthly * 1_400 / 10_000);
    const logistics = Math.round(targetMonthly * 350 / 10_000);
    const production = explicit + sector + publicOther + logistics;
    const householdConsumption = Math.round(production * (10_000 - profile.savingsRateBps - 2_000) / 10_000);
    const investment = Math.round(production * 2_000 / 10_000);
    const governmentConsumption = Math.round(production * profile.governmentSpendingShareBps * 0.4 / 10_000);
    const netExportsUsdMinor = Math.round(((pack?.exportsUsd ?? 0) - (pack?.importsUsd ?? 0)) * 100 / 12);
    const netExports = convertMinor(world, netExportsUsdMinor, "USD", country.currencyReference) ?? netExportsUsdMinor;
    const inventory = production - householdConsumption - investment - governmentConsumption - netExports;
    const expenditure = householdConsumption + investment + governmentConsumption + inventory + netExports;
    const income = production;
    const debt = world.sovereignBonds.filter((item) => item.countryId === country.id && item.status === "active").reduce((sum, item) => sum + item.outstandingFaceValueMinor, 0);
    const bankAssets = world.banks.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + (item.baselineFinancials?.assetsMinor ?? 0), 0) + (world.bankingSectorCohorts.find((item) => item.countryId === country.id)?.assetsMinor ?? 0);
    const credit = world.banks.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + (item.baselineFinancials?.loansMinor ?? 0), 0) + (world.bankingSectorCohorts.find((item) => item.countryId === country.id)?.loansMinor ?? 0);
    const annual = Math.max(1, targetMonthly * 12);
    const actualDebtToGdpBps = Math.round(debt * 10_000 / annual);
    const tradeUsdMinor = pack ? Math.round((pack.exportsUsd + pack.importsUsd) * 100) : 0;
    const tradeLocalMinor = convertMinor(world, tradeUsdMinor, "USD", country.currencyReference) ?? tradeUsdMinor;
    const actualTradeToGdpBps = pack ? Math.round(tradeLocalMinor * 10_000 / annual) : 0;
    const errorBps = Math.round(Math.abs(production - targetMonthly) * 10_000 / Math.max(1, targetMonthly));
    return {
      countryId: country.id, targetAnnualNominalGdpMinor: annual, targetMonthlyNominalGdpMinor: targetMonthly, explicitCompanyValueAddedMinor: explicit, sectorCohortValueAddedMinor: sector, publicOtherValueAddedMinor: publicOther, logisticsValueAddedMinor: logistics,
      productionApproachMinor: production, incomeApproachMinor: income, expenditureApproachMinor: expenditure, householdConsumptionMinor: householdConsumption, investmentMinor: investment, governmentConsumptionMinor: governmentConsumption, inventoryChangeMinor: inventory, netExportsMinor: netExports,
      reconciliationGapMinor: Math.max(Math.abs(production - income), Math.abs(production - expenditure)), targetUnemploymentBps: profile.unemploymentBps, currentUnemploymentBps: profile.unemploymentBps,
      targetTradeToGdpBps: pack?.tradeOpennessBps ?? 0, actualTradeToGdpBps, targetDebtToGdpBps: profile.governmentDebtToGdpBps, actualDebtToGdpBps,
      bankAssetsToGdpBps: Math.round(bankAssets * 10_000 / annual), creditToGdpBps: Math.round(credit * 10_000 / annual), initializedAtMonth: world.clock.elapsedMonths,
      withinTolerance: errorBps <= 1_000 && Math.abs(actualDebtToGdpBps - profile.governmentDebtToGdpBps) <= 100,
      warning: errorBps > 1_000 ? `Ошибка масштаба ВВП ${Math.round(errorBps / 100)}%` : null,
      coverage: { gdp: "OBSERVED", population: "OBSERVED", inflation: "OBSERVED", unemployment: "OBSERVED", trade: "OBSERVED", reserves: "OBSERVED", publicDebt: "CALIBRATED", banks: "CALIBRATED", companies: "CALIBRATED" },
    };
  });
  world.countryScaleReconciliations = reports;
  return reports;
}

export function initializeRealWorldReconciliation(world: WorldState): void {
  if (world.baselineReference.mode !== "REAL_WORLD") return;
  seedScaleSectors(world);
  bootstrapSovereignDebt(world);
  const reports = refreshScaleReconciliation(world);
  world.realWorldInitializationReports = reports.map((report): RealWorldInitializationReport => ({ ...report, baselineYear: world.baselineReference.referenceYear, sourceDate: world.baselineReference.baselineDate }));
}
