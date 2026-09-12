import type { DefenseCapabilityDomain } from "../domain/model.ts";

export type CalibrationStatus = "OBSERVED" | "ESTIMATED" | "CALIBRATED";
export interface CalibratedValue { value: number; status: CalibrationStatus }
export interface CountryDefenseProfile {
  countryId: string;
  defenseSpendingToGdpBps: CalibratedValue;
  activePersonnel: CalibratedValue;
  reservePersonnel: CalibratedValue;
  personnelCostShareBps: CalibratedValue;
  procurementShareBps: CalibratedValue;
  operationsMaintenanceShareBps: CalibratedValue;
  defenseIndustryScaleBps: CalibratedValue;
  importDependencyBps: CalibratedValue;
  readinessEstimateBps: CalibratedValue;
  stockpileAdequacyBps: CalibratedValue;
  domainWeightsBps: Record<DefenseCapabilityDomain, number>;
}

const estimated = (value: number): CalibratedValue => ({ value, status: "ESTIMATED" });
const observed = (value: number): CalibratedValue => ({ value, status: "OBSERVED" });

export const REAL_WORLD_DEFENSE_PROFILES: Record<string, CountryDefenseProfile> = {
  us: { countryId: "us", defenseSpendingToGdpBps: observed(340), activePersonnel: observed(1_328_000), reservePersonnel: observed(799_500), personnelCostShareBps: estimated(2_400), procurementShareBps: estimated(2_800), operationsMaintenanceShareBps: estimated(3_100), defenseIndustryScaleBps: estimated(9_500), importDependencyBps: estimated(1_300), readinessEstimateBps: estimated(7_900), stockpileAdequacyBps: estimated(7_200), domainWeightsBps: { land: 1_750, air: 2_250, naval: 2_150, airDefense: 1_100, logistics: 1_500, cyberCommunications: 1_250 } },
  ru: { countryId: "ru", defenseSpendingToGdpBps: estimated(590), activePersonnel: estimated(1_150_000), reservePersonnel: estimated(1_500_000), personnelCostShareBps: estimated(2_700), procurementShareBps: estimated(3_000), operationsMaintenanceShareBps: estimated(2_600), defenseIndustryScaleBps: estimated(8_200), importDependencyBps: estimated(2_100), readinessEstimateBps: estimated(7_100), stockpileAdequacyBps: estimated(7_800), domainWeightsBps: { land: 2_700, air: 1_650, naval: 850, airDefense: 1_850, logistics: 1_500, cyberCommunications: 1_450 } },
  de: { countryId: "de", defenseSpendingToGdpBps: observed(200), activePersonnel: observed(181_000), reservePersonnel: estimated(34_000), personnelCostShareBps: estimated(3_500), procurementShareBps: estimated(2_400), operationsMaintenanceShareBps: estimated(2_900), defenseIndustryScaleBps: estimated(6_900), importDependencyBps: estimated(3_100), readinessEstimateBps: estimated(6_400), stockpileAdequacyBps: estimated(5_000), domainWeightsBps: { land: 2_100, air: 1_950, naval: 1_150, airDefense: 1_150, logistics: 1_850, cyberCommunications: 1_800 } },
  jp: { countryId: "jp", defenseSpendingToGdpBps: estimated(160), activePersonnel: observed(247_000), reservePersonnel: observed(56_000), personnelCostShareBps: estimated(3_800), procurementShareBps: estimated(2_300), operationsMaintenanceShareBps: estimated(2_600), defenseIndustryScaleBps: estimated(6_500), importDependencyBps: estimated(3_900), readinessEstimateBps: estimated(7_000), stockpileAdequacyBps: estimated(5_700), domainWeightsBps: { land: 1_650, air: 2_150, naval: 2_350, airDefense: 1_450, logistics: 1_300, cyberCommunications: 1_100 } },
  kr: { countryId: "kr", defenseSpendingToGdpBps: observed(270), activePersonnel: observed(500_000), reservePersonnel: estimated(2_750_000), personnelCostShareBps: estimated(3_100), procurementShareBps: estimated(2_700), operationsMaintenanceShareBps: estimated(2_700), defenseIndustryScaleBps: estimated(7_700), importDependencyBps: estimated(2_600), readinessEstimateBps: estimated(7_500), stockpileAdequacyBps: estimated(7_300), domainWeightsBps: { land: 2_550, air: 1_750, naval: 1_400, airDefense: 1_700, logistics: 1_400, cyberCommunications: 1_200 } },
};
