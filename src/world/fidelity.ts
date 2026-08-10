import { emitSimpleEvent } from "../core/events.ts";
import { depositOf, reallocateDepositOwnership } from "../core/ledger.ts";
import type { ConsumptionCategory, Household, Person, PopulationCohort, SkillId, WorldState } from "../domain/model.ts";

const SKILLS: SkillId[] = ["economics", "accounting", "finance", "statistics", "programming", "dataAnalysis", "communication", "management"];
const CATEGORIES: ConsumptionCategory[] = ["food", "housing", "energy", "transport", "services", "goods", "education", "entertainment", "luxury"];

function materializedSkills(cohort: PopulationCohort, salt: number): Record<SkillId, number> {
  return Object.fromEntries(SKILLS.map((skill, index) => {
    const distribution = cohort.skillDistribution[skill];
    const offset = ((salt * 193 + index * 317) % (distribution.spread * 2 + 1)) - distribution.spread;
    return [skill, Math.max(0, Math.min(10_000, distribution.mean + offset))];
  })) as Record<SkillId, number>;
}

export function materializePerson(world: WorldState, cohortId: string, important = false): Person | null {
  const cohort = world.populationCohorts.find((item) => item.id === cohortId);
  if (!cohort || cohort.populationCount <= 0 || world.fidelity.materializedPersonIds.length >= world.fidelity.budgets.maxActivePersons) return null;
  const number = world.nextMaterializedPersonId++;
  const personId = `person-materialized-${String(number).padStart(6, "0")}`;
  const householdId = `household-materialized-${String(number).padStart(6, "0")}`;
  const ageAtStart = cohort.ageBand === "18-24" ? 21 : cohort.ageBand === "25-34" ? 29 : cohort.ageBand === "35-49" ? 42 : cohort.ageBand === "50-64" ? 56 : 69;
  const person: Person = {
    id: personId,
    householdId,
    displayName: `Житель ${number}`,
    ageAtStart,
    educationLevel: cohort.education,
    skills: materializedSkills(cohort, number),
    practicalExperience: Object.fromEntries(SKILLS.map((skill) => [skill, 0])) as Record<SkillId, number>,
    reputationBps: 4_000 + (number * 137) % 2_000,
    occupationId: null,
    cityId: cohort.cityId,
    fidelityTier: important ? 2 : 1,
    sourceCohortId: cohort.id,
    important,
  };
  const household: Household = {
    id: householdId,
    displayName: person.displayName,
    personIds: [personId],
    bankId: cohort.bankId,
    employerId: null,
    skillBps: Math.round(Object.values(person.skills).reduce((sum, value) => sum + value, 0) / SKILLS.length),
    productivityBps: 8_000,
    consumptionPropensityBps: cohort.incomeBand === "low" ? 8_800 : cohort.incomeBand === "middle" ? 7_900 : 6_900,
    savingsPreferenceBps: cohort.incomeBand === "high" ? 3_200 : 1_800,
    liquidityPreferenceBps: 1_500,
    essentialBudgetBps: 5_000,
    priceSensitivityBps: 8_500,
    preferenceWeightsBps: {},
    preferredSellerByGoodId: {},
    reservationWageCents: Math.round(cohort.averageMonthlyIncomeCents * 0.82),
    monthsUnemployed: 0,
    expectedInflationBps: 400,
    consumptionMilliUnits: Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    foundedCompanyIds: [],
    cityId: cohort.cityId,
    utilityPreferencesBps: structuredClone(cohort.consumptionPreferencesBps),
    lastDisposableIncomeCents: 0,
    lastSpendingByCategoryCents: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<ConsumptionCategory, number>,
  };
  world.people.push(person);
  world.households.push(household);
  cohort.populationCount -= 1;
  if (cohort.employedCount > 0) cohort.employedCount -= 1;
  const allocatedDeposit = Math.min(depositOf(world, cohort.id), Math.max(1, Math.round(cohort.wealthDistribution.medianCents / 20)));
  reallocateDepositOwnership(world, cohort.id, householdId, allocatedDeposit, "MATERIALIZATION", `Материализация ${person.displayName}`);
  world.fidelity.materializedPersonIds.push(personId);
  world.fidelity.tierByEntityId[personId] = person.fidelityTier;
  world.fidelity.relevanceByEntityId[personId] = important ? 10_000 : 5_500;
  emitSimpleEvent(world, "PersonMaterialized", "Персона материализована", `${person.displayName} · ${cohort.cityId}`, [personId, cohort.id], "info", [], { allocatedDeposit });
  return person;
}

export function dematerializePerson(world: WorldState, personId: string): boolean {
  const person = world.people.find((item) => item.id === personId);
  if (!person || person.important || person.id === world.player.personId || !person.sourceCohortId) return false;
  const cohort = world.populationCohorts.find((item) => item.id === person.sourceCohortId);
  const household = world.households.find((item) => item.id === person.householdId);
  if (!cohort || !household || household.employerId || household.foundedCompanyIds.length) return false;
  const remainingDeposit = depositOf(world, household.id);
  if (remainingDeposit > 0) reallocateDepositOwnership(world, household.id, cohort.id, remainingDeposit, "DEMATERIALIZATION", `Дематериализация ${person.displayName}`);
  cohort.populationCount += 1;
  world.people = world.people.filter((item) => item.id !== personId);
  world.households = world.households.filter((item) => item.id !== household.id);
  world.fidelity.materializedPersonIds = world.fidelity.materializedPersonIds.filter((id) => id !== personId);
  delete world.fidelity.tierByEntityId[personId];
  delete world.fidelity.relevanceByEntityId[personId];
  emitSimpleEvent(world, "PersonDematerialized", "Персона возвращена в когорту", `${person.displayName} · ${cohort.cityId}`, [personId, cohort.id], "info");
  return true;
}

export function enforceFidelityBudgets(world: WorldState): void {
  const candidates = world.fidelity.materializedPersonIds
    .map((id) => world.people.find((person) => person.id === id))
    .filter((person): person is Person => Boolean(person && !person.important))
    .sort((left, right) => (world.fidelity.relevanceByEntityId[left.id] ?? 0) - (world.fidelity.relevanceByEntityId[right.id] ?? 0));
  while (world.fidelity.materializedPersonIds.length > world.fidelity.budgets.maxActivePersons && candidates.length) {
    dematerializePerson(world, candidates.shift()!.id);
  }
}
