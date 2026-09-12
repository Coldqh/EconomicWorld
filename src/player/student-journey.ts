import type { UniversityProgram, WorldState } from "../domain/model.ts";

export interface StudentJourneyStep {
  id: string;
  title: string;
  detail: string;
  complete: boolean;
  current: boolean;
}

function programFor(world: WorldState, programId: string | undefined): UniversityProgram | undefined {
  return programId ? world.universityPrograms.find((program) => program.id === programId) : undefined;
}

export function hasHigherEducation(world: WorldState): boolean {
  return world.player.completedProgramIds.some((id) => {
    const program = programFor(world, id);
    return program?.degree === "bachelor" || program?.degree === "master" || program?.degree === "doctorate";
  });
}

export function isStateFundedFirstDegree(world: WorldState, program: UniversityProgram): boolean {
  if (world.player.profileId !== "student" || program.degree !== "bachelor" || hasHigherEducation(world)) return false;
  const university = world.universities.find((item) => item.id === program.universityId);
  const universityCountry = world.cities.find((city) => city.id === university?.cityId)?.countryId;
  const homeCityId = world.player.residenceHistory[0]?.cityId ?? "moscow";
  const homeCountry = world.cities.find((city) => city.id === homeCityId)?.countryId;
  return Boolean(universityCountry && universityCountry === homeCountry);
}

export function studentMonthlySupportCents(world: WorldState): number {
  const enrollment = world.player.activeUniversityEnrollment;
  const program = programFor(world, enrollment?.programId);
  if (enrollment?.status !== "active" || !program || !isStateFundedFirstDegree(world, program)) return 0;
  const city = world.cities.find((item) => item.id === world.player.currentCityId);
  return Math.max(12_000_00, Math.min(25_000_00, Math.round((city?.costOfLivingCents ?? 40_000_00) * 0.35)));
}

export function studentJourney(world: WorldState): StudentJourneyStep[] {
  const application = world.player.universityApplications.some((item) => item.status !== "rejected");
  const enrollment = world.player.activeUniversityEnrollment;
  const completedMonths = enrollment?.completedMonths
    ?? Math.max(0, ...world.player.educationHistory.filter((item) => item.completedAtMonth !== null).map((item) => {
      const program = programFor(world, item.programId);
      return program?.durationMonths ?? 0;
    }));
  const diploma = hasHigherEducation(world);
  const employed = Boolean(world.households.find((item) => item.id === world.player.householdId)?.employerId);
  const raw = [
    { id: "application", title: "Выбрать институт", detail: "Сравните программу, срок, конкурс и будущие профессии.", complete: application },
    { id: "enrollment", title: "Поступить", detail: "Подайте документы и зачислитесь на программу.", complete: Boolean(enrollment) || diploma },
    { id: "first-year", title: "Завершить первый курс", detail: "Навыки растут по мере обучения; обучение идёт вместе с ходами мира.", complete: completedMonths >= 12 || diploma },
    { id: "diploma", title: "Получить диплом", detail: "Диплом откроет профессии по выбранной специальности.", complete: diploma },
    { id: "career", title: "Начать карьеру", detail: "После выпуска работодатели оценят специальность, навыки и вуз.", complete: employed },
  ];
  const firstIncomplete = raw.findIndex((item) => !item.complete);
  return raw.map((item, index) => ({ ...item, current: index === firstIncomplete }));
}
