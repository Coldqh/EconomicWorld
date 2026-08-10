import { currentDate } from "../core/clock.ts";
import { accountIds, balanceOf, depositOf, entityBook } from "../core/ledger.ts";
import { emitSimpleEvent } from "../core/events.ts";
import type { PlayerMonthlySnapshot, PlayerTimelineEvent, SkillId, WorldState } from "../domain/model.ts";
import { ACADEMY_COURSES } from "../education/catalog.ts";

export const SKILL_LABELS: Record<SkillId, string> = {
  economics: "Экономика",
  accounting: "Бухгалтерия",
  finance: "Финансы",
  statistics: "Статистика",
  programming: "Программирование",
  dataAnalysis: "Анализ данных",
  communication: "Коммуникация",
  management: "Управление",
};

export function playerPerson(world: WorldState) {
  const person = world.people.find((item) => item.id === world.player.personId);
  if (!person) throw new Error("Персонаж игрока не найден");
  return person;
}

export function playerHousehold(world: WorldState) {
  const household = world.households.find((item) => item.id === world.player.householdId);
  if (!household) throw new Error("Домохозяйство игрока не найдено");
  return household;
}

export function playerAge(world: WorldState): number {
  return playerPerson(world).ageAtStart + Math.floor(world.clock.elapsedMonths / 12);
}

export function playerDebtCents(world: WorldState): number {
  return world.loans
    .filter((loan) => loan.borrowerId === world.player.householdId && loan.status === "active")
    .reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
}

export function playerNetWorthCents(world: WorldState): number {
  const book = entityBook(world, world.player.householdId);
  return book.assets - book.liabilities;
}

export function playerMonthCashFlow(world: WorldState, elapsedMonth = world.clock.elapsedMonths): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (let index = world.ledger.transactions.length - 1; index >= 0; index -= 1) {
    const transaction = world.ledger.transactions[index];
    if (transaction.elapsedMonth < elapsedMonth) break;
    if (transaction.elapsedMonth > elapsedMonth) continue;
    const entry = transaction.entries.find((item) => item.accountId === accountIds.deposit(world.player.householdId));
    if (!entry) continue;
    if (entry.side === "debit" && transaction.kind !== "LOAN_ISSUED" && transaction.kind !== "GENESIS") income += entry.amountCents;
    if (entry.side === "credit" && transaction.kind !== "LOAN_PRINCIPAL") expenses += entry.amountCents;
  }
  return { income, expenses };
}

export function addPlayerTimeline(world: WorldState, type: PlayerTimelineEvent["type"], title: string, detail: string): void {
  world.player.timeline.push({
    id: `life-${String(world.player.nextTimelineId++).padStart(6, "0")}`,
    elapsedMonth: world.clock.elapsedMonths,
    type,
    title,
    detail,
  });
}

function improveWorkSkills(world: WorldState): void {
  const person = playerPerson(world);
  const household = playerHousehold(world);
  if (!household.employerId || !person.occupationId) return;
  const occupation = world.occupations.find((item) => item.id === person.occupationId);
  if (!occupation) return;
  for (const skill of Object.keys(occupation.requiredSkills) as SkillId[]) {
    person.practicalExperience[skill] = Math.min(10_000, person.practicalExperience[skill] + 18);
  }
  person.reputationBps = Math.min(10_000, person.reputationBps + 8);
}

function progressEducation(world: WorldState): void {
  const enrollment = world.player.activeEnrollment;
  if (!enrollment || enrollment.status !== "active") return;
  enrollment.completedMonths += 1;
  if (enrollment.completedMonths < enrollment.durationMonths) return;
  const course = ACADEMY_COURSES.find((item) => item.id === enrollment.courseId);
  if (!course) return;
  enrollment.status = "completed";
  world.player.completedCourseIds.push(course.id);
  world.player.completedLessonIds.push(...course.lessons.map((lesson) => lesson.id));
  const person = playerPerson(world);
  for (const [skill, gain] of Object.entries(course.skillGains) as Array<[SkillId, number]>) {
    person.skills[skill] = Math.min(10_000, person.skills[skill] + gain);
    person.practicalExperience[skill] = Math.min(10_000, person.practicalExperience[skill] + Math.round(gain * 0.2));
  }
  emitSimpleEvent(world, "CourseCompleted", "Курс завершён", `${person.displayName} завершил курс «${course.title}».`, [person.id, "academy-provider"], "positive", [], { courseId: course.id });
  addPlayerTimeline(world, "course", "Курс завершён", course.title);
  world.player.activeEnrollment = null;
}

export function recordPlayerMonth(world: WorldState): PlayerMonthlySnapshot {
  improveWorkSkills(world);
  progressEducation(world);
  const person = playerPerson(world);
  const household = playerHousehold(world);
  const cashFlow = playerMonthCashFlow(world);
  const snapshot: PlayerMonthlySnapshot = {
    elapsedMonth: world.clock.elapsedMonths,
    age: playerAge(world),
    employerId: household.employerId,
    occupationId: person.occupationId,
    netWorthCents: playerNetWorthCents(world),
    incomeCents: cashFlow.income,
    expensesCents: cashFlow.expenses,
    savingsCents: cashFlow.income - cashFlow.expenses,
    debtCents: playerDebtCents(world),
    skills: structuredClone(person.skills),
  };
  world.player.monthlyHistory.push(snapshot);
  return snapshot;
}

export function playerFinancialSummary(world: WorldState) {
  const current = world.player.monthlyHistory.at(-1);
  const cashFlow = current ?? { incomeCents: 0, expensesCents: 0, savingsCents: 0 };
  return {
    age: playerAge(world),
    depositsCents: depositOf(world, world.player.householdId),
    debtCents: playerDebtCents(world),
    netWorthCents: playerNetWorthCents(world),
    incomeCents: cashFlow.incomeCents,
    expensesCents: cashFlow.expensesCents,
    savingsCents: cashFlow.savingsCents,
    savingsRateBps: cashFlow.incomeCents > 0 ? Math.round((cashFlow.savingsCents * 10_000) / cashFlow.incomeCents) : 0,
    date: currentDate(world.clock),
  };
}

export function tracePlayerMoney(world: WorldState) {
  return world.ledger.transactions
    .filter((transaction) => transaction.entries.some((entry) => entry.accountId === accountIds.deposit(world.player.householdId)))
    .slice(-100)
    .reverse();
}

export function playerDepositBalance(world: WorldState): number {
  return balanceOf(world, accountIds.deposit(world.player.householdId));
}
