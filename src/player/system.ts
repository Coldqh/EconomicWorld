import { currentDate } from "../core/clock.ts";
import { bankAccountsForOwner } from "../core/ledger.ts";
import { emitSimpleEvent } from "../core/events.ts";
import type { PlayerMonthlySnapshot, PlayerTimelineEvent, SkillId, WorldState } from "../domain/model.ts";
import { ACADEMY_COURSES } from "../education/catalog.ts";
import { convertMinor } from "../finance/currencies.ts";
import { valueOwnerBalanceSheet } from "../finance/owner-valuation.ts";

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
  return valueOwnerBalanceSheet(world, world.player.householdId, world.player.reportingCurrencyId).totalMinor;
}

export function playerMonthCashFlow(world: WorldState, elapsedMonth = world.clock.elapsedMonths): { income: number; expenses: number; investing: number; financing: number; taxes: number; transfers: number; netCashChange: number } {
  let income = 0;
  let expenses = 0;
  let investing = 0;
  let financing = 0;
  let taxes = 0;
  let transfers = 0;
  let netCashChange = 0;
  const accounts = bankAccountsForOwner(world, world.player.householdId);
  const byLedgerId = new Map(accounts.map((account) => [account.ledgerDepositAccountId, account.currencyId]));
  const investmentKinds = new Set(["FUND_SUBSCRIPTION", "FUND_REDEMPTION", "MARKET_TRADE", "EQUITY_ISSUE", "EQUITY_SECONDARY", "BOND_ISSUE", "SOVEREIGN_ISSUE", "ETF_CREATION", "ETF_REDEMPTION", "PROPERTY_PURCHASE", "USED_ASSET", "CAPITAL_CONTRIBUTION", "BROKER_DEPOSIT"]);
  const financingKinds = new Set(["LOAN_ISSUED", "LOAN_PRINCIPAL", "MARGIN_FINANCE", "MARGIN_REPAYMENT", "REPO_OPEN", "REPO_REPAYMENT"]);
  const taxKinds = new Set(["INCOME_TAX", "SALES_TAX", "PROPERTY_TAX"]);
  for (let index = world.ledger.transactions.length - 1; index >= 0; index -= 1) {
    const transaction = world.ledger.transactions[index];
    if (transaction.elapsedMonth < elapsedMonth) break;
    if (transaction.elapsedMonth > elapsedMonth || transaction.kind === "GENESIS") continue;
    let cashDelta = 0;
    for (const entry of transaction.entries) {
      const currencyId = byLedgerId.get(entry.accountId);
      if (!currencyId) continue;
      const signed = entry.side === "debit" ? entry.amountCents : -entry.amountCents;
      cashDelta += convertMinor(world, signed, currencyId, world.player.reportingCurrencyId) ?? 0;
    }
    if (!cashDelta) continue;
    netCashChange += cashDelta;
    if (transaction.kind === "FX_TRADE" || transaction.kind === "TRANSFER" && transaction.causeIds.some((id) => id.startsWith("own-account:"))) { transfers += cashDelta; continue; }
    if (investmentKinds.has(transaction.kind)) { investing += cashDelta; continue; }
    if (financingKinds.has(transaction.kind)) { financing += cashDelta; continue; }
    if (taxKinds.has(transaction.kind)) { if (cashDelta < 0) { taxes += -cashDelta; expenses += -cashDelta; } else income += cashDelta; continue; }
    if (cashDelta > 0) income += cashDelta;
    else expenses += -cashDelta;
  }
  return { income, expenses, investing, financing, taxes, transfers, netCashChange };
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
    depositsCents: valueOwnerBalanceSheet(world, world.player.householdId, world.player.reportingCurrencyId).components.cash ?? 0,
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
  const accountIds = new Set(bankAccountsForOwner(world, world.player.householdId).map((item) => item.ledgerDepositAccountId));
  return world.ledger.transactions
    .filter((transaction) => transaction.entries.some((entry) => accountIds.has(entry.accountId)))
    .slice(-100)
    .reverse();
}

export function playerDepositBalance(world: WorldState): number {
  return valueOwnerBalanceSheet(world, world.player.householdId, world.player.reportingCurrencyId).components.cash ?? 0;
}
