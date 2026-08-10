import { emitSimpleEvent } from "../core/events.ts";
import { ensureEntityAccounts, transferDeposit } from "../core/ledger.ts";
import { ACADEMY_COURSES } from "../education/catalog.ts";
import type { Occupation, PlayerCommandRecord, SkillId, WorldState } from "../domain/model.ts";
import { addPlayerTimeline, playerHousehold, playerPerson } from "./system.ts";

function recordCommand(world: WorldState, type: PlayerCommandRecord["type"], payload: PlayerCommandRecord["payload"]): void {
  world.player.commandLog.push({
    id: `command-${String(world.player.nextCommandId++).padStart(7, "0")}`,
    elapsedMonth: world.clock.elapsedMonths,
    type,
    payload,
  });
}

function occupationScore(world: WorldState, occupation: Occupation): number {
  const person = playerPerson(world);
  const skills = Object.entries(occupation.requiredSkills) as Array<[SkillId, number]>;
  const fit = skills.length
    ? skills.reduce((sum, [skill, required]) => sum + Math.min(12_000, Math.round((person.skills[skill] * 10_000) / Math.max(1, required))), 0) / skills.length
    : 10_000;
  const practice = skills.length
    ? skills.reduce((sum, [skill]) => sum + person.practicalExperience[skill], 0) / skills.length
    : 0;
  return Math.round(fit * 0.72 + practice * 0.18 + person.reputationBps * 0.1);
}

export function setPlayerProfile(world: WorldState, name: string, profileId: string): void {
  const person = playerPerson(world);
  const household = playerHousehold(world);
  const profiles: Record<string, { age: number; education: typeof person.educationLevel; gains: Partial<Record<SkillId, number>> }> = {
    student: { age: 19, education: "secondary", gains: { economics: 450, statistics: 350 } },
    office: { age: 21, education: "secondary", gains: { communication: 550, accounting: 300 } },
    analyst: { age: 22, education: "bachelor", gains: { economics: 700, finance: 650, statistics: 600, dataAnalysis: 500 } },
    developer: { age: 21, education: "secondary", gains: { programming: 900, dataAnalysis: 500, statistics: 300 } },
  };
  const profile = profiles[profileId] ?? profiles.student;
  person.displayName = name.trim() || "Игрок";
  household.displayName = person.displayName;
  person.ageAtStart = profile.age;
  person.educationLevel = profile.education;
  for (const [skill, gain] of Object.entries(profile.gains) as Array<[SkillId, number]>) person.skills[skill] = Math.max(person.skills[skill], gain);
  world.player.profileId = profileId;
  recordCommand(world, "SET_PROFILE", { name: person.displayName, profileId });
  emitSimpleEvent(world, "PlayerCreated", "Игрок вошёл в экономику", `${person.displayName}, ${person.ageAtStart} лет. Банковский счёт и домохозяйство связаны с Global Ledger.`, [person.id, household.id, household.bankId], "positive");
  addPlayerTimeline(world, "identity", "Начало экономической жизни", `${person.displayName}, ${person.ageAtStart} лет`);
}

export function availableOccupations(world: WorldState, companyId: string): Occupation[] {
  const company = world.companies.find((item) => item.id === companyId);
  if (!company?.active) return [];
  const base = company.goodId === "services" ? ["admin", "analyst", "developer"] : ["worker", "analyst"];
  if (company.employees.length >= 8) base.push("manager");
  return world.occupations.filter((occupation) => base.includes(occupation.id));
}

export function applyForJob(world: WorldState, companyId: string, occupationId: string): { accepted: boolean; reason: string } {
  const household = playerHousehold(world);
  const company = world.companies.find((item) => item.id === companyId);
  const occupation = world.occupations.find((item) => item.id === occupationId);
  if (!company?.active || !occupation) return { accepted: false, reason: "Вакансия недоступна." };
  if (household.employerId) return { accepted: false, reason: "Сначала завершите текущий трудовой договор." };
  recordCommand(world, "APPLY_JOB", { companyId, occupationId });
  const score = occupationScore(world, occupation);
  const person = playerPerson(world);
  const averageSkill = Object.values(person.skills).reduce((sum, value) => sum + value, 0) / Object.values(person.skills).length;
  const playerMarketIndex = 17_000 + averageSkill * 2 + person.reputationBps * 0.2;
  const strongerApplicants = Math.min(3, world.households
    .filter((item) => !item.employerId && item.id !== household.id)
    .filter((item) => item.skillBps + item.productivityBps > playerMarketIndex)
    .length);
  const requirementsMet = Object.entries(occupation.requiredSkills).every(([skill, required]) => playerPerson(world).skills[skill as SkillId] >= Math.round((required ?? 0) * 0.72));
  const affordable = company.lastGrossRevenueCents === 0 || company.lastGrossRevenueCents > company.wageCents * Math.max(1, company.employees.length) * 0.45;
  const accepted = requirementsMet && affordable && strongerApplicants < 4 && company.distressMonths < 3;
  emitSimpleEvent(world, "JobApplied", accepted ? "Работодатель подготовил предложение" : "Работодатель отклонил заявку", accepted ? `${company.name} готова предложить должность «${occupation.name}».` : `Требования навыков, конкуренция или финансы ${company.name} не позволяют сделать предложение.`, [world.player.personId, company.id], accepted ? "positive" : "attention", [], { scoreBps: score, strongerApplicants, requirementsMet, affordable });
  if (!accepted) return { accepted, reason: `Соответствие ${Math.round(score / 100)}%; более сильных кандидатов: ${strongerApplicants}.` };
  const salaryCents = Math.round(company.wageCents * (0.88 + occupation.level * 0.11));
  world.player.pendingJobOffer = { companyId, occupationId, salaryCents, createdAtMonth: world.clock.elapsedMonths, expiresAtMonth: world.clock.elapsedMonths + 2, scoreBps: score };
  emitSimpleEvent(world, "JobOfferCreated", "Получено предложение о работе", `${company.name}: ${occupation.name}, ${(salaryCents / 100).toLocaleString("ru-RU")} ₽ в месяц.`, [world.player.personId, company.id], "positive", [], { salaryCents, scoreBps: score });
  return { accepted, reason: "Предложение готово." };
}

export function acceptJobOffer(world: WorldState): boolean {
  const offer = world.player.pendingJobOffer;
  if (!offer || offer.expiresAtMonth < world.clock.elapsedMonths) return false;
  const company = world.companies.find((item) => item.id === offer.companyId);
  const occupation = world.occupations.find((item) => item.id === offer.occupationId);
  const household = playerHousehold(world);
  if (!company?.active || !occupation || household.employerId) return false;
  household.employerId = company.id;
  household.monthsUnemployed = 0;
  company.employees.push(household.id);
  household.reservationWageCents = Math.round(offer.salaryCents * 0.9);
  company.wageCents = Math.max(company.wageCents, offer.salaryCents);
  playerPerson(world).occupationId = occupation.id;
  recordCommand(world, "ACCEPT_JOB", { companyId: company.id, occupationId: occupation.id, salaryCents: offer.salaryCents });
  emitSimpleEvent(world, "JobStarted", "Трудовой договор заключён", `${playerPerson(world).displayName} начал работать в ${company.name}.`, [world.player.personId, company.id], "positive", [], { salaryCents: offer.salaryCents });
  addPlayerTimeline(world, "job", "Новая работа", `${occupation.name} · ${company.name}`);
  world.player.pendingJobOffer = null;
  return true;
}

export function resignPlayerJob(world: WorldState): boolean {
  const household = playerHousehold(world);
  if (!household.employerId) return false;
  const company = world.companies.find((item) => item.id === household.employerId);
  const employerId = household.employerId;
  if (company) company.employees = company.employees.filter((id) => id !== household.id);
  household.employerId = null;
  household.monthsUnemployed = 0;
  playerPerson(world).occupationId = null;
  recordCommand(world, "RESIGN_JOB", { companyId: employerId });
  emitSimpleEvent(world, "JobEnded", "Трудовой договор завершён", `${playerPerson(world).displayName} ушёл из ${company?.name ?? employerId}.`, [world.player.personId, employerId], "attention");
  addPlayerTimeline(world, "job", "Работа завершена", company?.name ?? employerId);
  return true;
}

export function enrollPlayerCourse(world: WorldState, courseId: string): { ok: boolean; reason: string } {
  const course = ACADEMY_COURSES.find((item) => item.id === courseId);
  if (!course) return { ok: false, reason: "Курс не найден." };
  if (world.player.activeEnrollment) return { ok: false, reason: "Сначала завершите активный курс." };
  if (course.prerequisiteCourseIds.some((id) => !world.player.completedCourseIds.includes(id))) return { ok: false, reason: "Не выполнены предварительные курсы." };
  ensureEntityAccounts(world.ledger, "academy-provider");
  const payment = transferDeposit(world, world.player.householdId, "academy-provider", course.costCents, "EDUCATION", `Оплата курса «${course.title}»`);
  if (!payment) return { ok: false, reason: "Недостаточно средств для оплаты." };
  world.player.activeEnrollment = { courseId, enrolledAtMonth: world.clock.elapsedMonths, completedMonths: 0, durationMonths: course.durationMonths, status: "active" };
  recordCommand(world, "ENROLL_COURSE", { courseId, costCents: course.costCents });
  emitSimpleEvent(world, "CourseEnrolled", "Обучение начато", `${playerPerson(world).displayName} начал курс «${course.title}» продолжительностью ${course.durationMonths} мес.`, [world.player.personId, "academy-provider"], "info", payment ? [payment] : [], { courseId, durationMonths: course.durationMonths, costCents: course.costCents });
  addPlayerTimeline(world, "course", "Начат курс", course.title);
  return { ok: true, reason: "Курс начат." };
}

export function setPlayerSavingsTarget(world: WorldState, savingsTargetBps: number): void {
  const target = Math.max(500, Math.min(8_000, Math.round(savingsTargetBps)));
  world.player.savingsTargetBps = target;
  const household = playerHousehold(world);
  household.savingsPreferenceBps = target;
  household.consumptionPropensityBps = Math.max(2_000, 10_000 - target);
  recordCommand(world, "SET_SAVINGS", { savingsTargetBps: target });
}
