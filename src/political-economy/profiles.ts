export type InstitutionDataStatus = "OBSERVED" | "ESTIMATED" | "CALIBRATED";
export interface CountryInstitutionProfile {
  countryId: string; status: InstitutionDataStatus;
  taxAdministrationBps: number; regulatoryCapacityBps: number; contractEnforcementBps: number; statisticalCapacityBps: number;
  procurementIntegrityBps: number; corruptionEnforcementBps: number; policyStabilityBps: number; centralBankIndependenceBps: number;
}

export const REAL_WORLD_INSTITUTION_PROFILES: Record<string, CountryInstitutionProfile> = {
  us: { countryId: "us", status: "ESTIMATED", taxAdministrationBps: 8_000, regulatoryCapacityBps: 8_200, contractEnforcementBps: 8_400, statisticalCapacityBps: 9_000, procurementIntegrityBps: 7_800, corruptionEnforcementBps: 7_700, policyStabilityBps: 7_400, centralBankIndependenceBps: 8_800 },
  ru: { countryId: "ru", status: "ESTIMATED", taxAdministrationBps: 7_400, regulatoryCapacityBps: 6_100, contractEnforcementBps: 5_300, statisticalCapacityBps: 7_100, procurementIntegrityBps: 4_500, corruptionEnforcementBps: 4_300, policyStabilityBps: 6_500, centralBankIndependenceBps: 6_300 },
  de: { countryId: "de", status: "ESTIMATED", taxAdministrationBps: 8_700, regulatoryCapacityBps: 8_900, contractEnforcementBps: 8_800, statisticalCapacityBps: 9_200, procurementIntegrityBps: 8_600, corruptionEnforcementBps: 8_700, policyStabilityBps: 8_300, centralBankIndependenceBps: 9_000 },
  jp: { countryId: "jp", status: "ESTIMATED", taxAdministrationBps: 8_500, regulatoryCapacityBps: 8_400, contractEnforcementBps: 8_700, statisticalCapacityBps: 9_000, procurementIntegrityBps: 8_300, corruptionEnforcementBps: 8_500, policyStabilityBps: 8_100, centralBankIndependenceBps: 8_600 },
  kr: { countryId: "kr", status: "ESTIMATED", taxAdministrationBps: 8_600, regulatoryCapacityBps: 8_300, contractEnforcementBps: 8_200, statisticalCapacityBps: 8_900, procurementIntegrityBps: 7_800, corruptionEnforcementBps: 7_900, policyStabilityBps: 7_600, centralBankIndependenceBps: 8_200 },
};
