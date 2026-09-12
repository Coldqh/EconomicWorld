import type { FeatureAccessState, PlayerExperienceState, PlayerInterfacePreferences, PlayerReputationState, WorldState } from "../domain/model.ts";

export interface FeatureUnlockDefinition {
  featureId: string;
  label: string;
  minimumLevel: number;
  discoveryLevel: number;
  uiGroup: string;
  tutorialId: string;
  prerequisite?: "company" | "fund" | "corporate-or-fund";
}

export const MAX_PLAYER_LEVEL = 50;

export const FEATURE_UNLOCKS: FeatureUnlockDefinition[] = [
  { featureId: "life", label: "Моя жизнь", minimumLevel: 1, discoveryLevel: 1, uiGroup: "HOME", tutorialId: "life" },
  { featureId: "career", label: "Карьера", minimumLevel: 1, discoveryLevel: 1, uiGroup: "CAREER", tutorialId: "career" },
  { featureId: "finances", label: "Финансы", minimumLevel: 1, discoveryLevel: 1, uiGroup: "FINANCE", tutorialId: "finance" },
  { featureId: "world", label: "Мир", minimumLevel: 1, discoveryLevel: 1, uiGroup: "WORLD", tutorialId: "world" },
  { featureId: "progression", label: "Профиль", minimumLevel: 1, discoveryLevel: 1, uiGroup: "HOME", tutorialId: "progression" },
  { featureId: "education", label: "Институты", minimumLevel: 2, discoveryLevel: 1, uiGroup: "CAREER", tutorialId: "institutes" },
  { featureId: "portfolio", label: "Портфель", minimumLevel: 4, discoveryLevel: 3, uiGroup: "FINANCE", tutorialId: "portfolio" },
  { featureId: "markets", label: "Рынки", minimumLevel: 6, discoveryLevel: 5, uiGroup: "MARKETS", tutorialId: "markets" },
  { featureId: "economy", label: "Экономика", minimumLevel: 7, discoveryLevel: 5, uiGroup: "WORLD", tutorialId: "economy" },
  { featureId: "information", label: "Данные и оценки", minimumLevel: 8, discoveryLevel: 7, uiGroup: "ANALYTICS", tutorialId: "information" },
  { featureId: "global", label: "Мировая экономика", minimumLevel: 10, discoveryLevel: 9, uiGroup: "WORLD", tutorialId: "global" },
  { featureId: "banks", label: "Банки", minimumLevel: 11, discoveryLevel: 10, uiGroup: "FINANCE", tutorialId: "banks" },
  { featureId: "advanced-markets", label: "Профессиональные рынки", minimumLevel: 13, discoveryLevel: 11, uiGroup: "MARKETS", tutorialId: "advanced-markets" },
  { featureId: "companies", label: "Бизнес", minimumLevel: 16, discoveryLevel: 14, uiGroup: "BUSINESS", tutorialId: "business" },
  { featureId: "ledger", label: "Общий реестр", minimumLevel: 18, discoveryLevel: 16, uiGroup: "ANALYTICS", tutorialId: "ledger" },
  { featureId: "political-economy", label: "Институты и власть", minimumLevel: 22, discoveryLevel: 20, uiGroup: "WORLD", tutorialId: "institutions" },
  { featureId: "geoeconomics", label: "Геоэкономика", minimumLevel: 27, discoveryLevel: 25, uiGroup: "WORLD", tutorialId: "geoeconomics" },
  { featureId: "corporate-transactions", label: "Корпоративные сделки", minimumLevel: 28, discoveryLevel: 26, uiGroup: "CORPORATE TRANSACTIONS", tutorialId: "ma", prerequisite: "company" },
  { featureId: "capital-management", label: "Управление капиталом", minimumLevel: 32, discoveryLevel: 30, uiGroup: "CAPITAL MANAGEMENT", tutorialId: "funds", prerequisite: "corporate-or-fund" },
  { featureId: "private-equity", label: "Частный капитал", minimumLevel: 36, discoveryLevel: 34, uiGroup: "CAPITAL MANAGEMENT", tutorialId: "pe", prerequisite: "corporate-or-fund" },
  { featureId: "defense", label: "Стратегические оценки", minimumLevel: 41, discoveryLevel: 39, uiGroup: "WORLD", tutorialId: "defense" },
  { featureId: "lab", label: "Экономическая лаборатория", minimumLevel: 46, discoveryLevel: 43, uiGroup: "ANALYTICS", tutorialId: "lab" },
  { featureId: "control", label: "Диагностика", minimumLevel: 50, discoveryLevel: 48, uiGroup: "ANALYTICS", tutorialId: "diagnostics" },
  { featureId: "settings", label: "Настройки", minimumLevel: 1, discoveryLevel: 1, uiGroup: "SYSTEM", tutorialId: "settings" },
];

export function xpRequiredForLevel(level: number): number {
  const bounded = Math.max(1, Math.min(MAX_PLAYER_LEVEL - 1, Math.floor(level)));
  if (bounded <= 10) return 80 + bounded * 30;
  if (bounded <= 20) return 420 + (bounded - 10) * 70;
  if (bounded <= 35) return 1_200 + (bounded - 20) * 140;
  if (bounded <= 45) return 3_500 + (bounded - 35) * 260;
  return 6_500 + (bounded - 45) * 500;
}

export function createExperienceState(): PlayerExperienceState {
  return { level: 1, currentXp: 0, lifetimeXp: 0, xpEvents: [], unlockedFeatures: [], discoveredFeatures: [], actionCounts: {}, completedMilestones: [], pendingLevelUp: null };
}

export function createReputationState(): PlayerReputationState { return { score: 0, history: [] }; }

export function awardExperience(world: WorldState, actionId: string, baseXp: number, reason: string): number {
  const state = world.player.experience;
  const count = state.actionCounts[actionId] ?? 0;
  const factor = count === 0 ? 1 : count === 1 ? 0.35 : count === 2 ? 0.15 : 0;
  const granted = Math.max(0, Math.round(baseXp * factor));
  state.actionCounts[actionId] = count + 1;
  if (!granted || state.level >= MAX_PLAYER_LEVEL) return 0;
  state.currentXp += granted;
  state.lifetimeXp += granted;
  state.xpEvents.push({ id: `xp-${world.clock.elapsedMonths}-${state.xpEvents.length + 1}`, elapsedMonth: world.clock.elapsedMonths, actionId, xp: granted, reason });
  if (state.xpEvents.length > 40) state.xpEvents.splice(0, state.xpEvents.length - 40);
  while (state.level < MAX_PLAYER_LEVEL && state.currentXp >= xpRequiredForLevel(state.level)) {
    state.currentXp -= xpRequiredForLevel(state.level);
    state.level += 1;
    state.pendingLevelUp = state.level;
  }
  refreshFeatureDiscovery(world);
  return granted;
}

export function changeReputation(world: WorldState, delta: number, event: string, reason: string): number {
  if (!delta) return world.player.reputation.score;
  const state = world.player.reputation;
  const before = state.score;
  state.score = Math.max(-1_000, Math.min(1_000, state.score + Math.round(delta)));
  const applied = state.score - before;
  if (applied) state.history.push({ id: `rep-${world.clock.elapsedMonths}-${state.history.length + 1}`, elapsedMonth: world.clock.elapsedMonths, delta: applied, event, reason });
  if (state.history.length > 30) state.history.splice(0, state.history.length - 30);
  return state.score;
}

export function reputationTier(score: number): string {
  if (score <= -600) return "ТОКСИЧНАЯ";
  if (score <= -200) return "ПЛОХАЯ";
  if (score < 200) return "НЕИЗВЕСТНАЯ";
  if (score < 500) return "НАДЁЖНАЯ";
  if (score < 750) return "УСТОЙЧИВАЯ";
  if (score < 900) return "ЭЛИТНАЯ";
  return "ЛЕГЕНДАРНАЯ";
}

function prerequisiteMet(world: WorldState, prerequisite?: FeatureUnlockDefinition["prerequisite"]): boolean {
  if (!prerequisite) return true;
  const ownsCompany = world.companies.some((company) => company.ownerHouseholdId === world.player.householdId);
  const ownsFund = world.assetManagers.some((manager) => manager.ownerId === world.player.householdId) || world.privateEquityFunds.some((fund) => fund.gpId === world.player.householdId);
  if (prerequisite === "company") return ownsCompany;
  if (prerequisite === "fund") return ownsFund;
  return ownsCompany || ownsFund;
}

export function featureAccess(world: WorldState, featureId: string): FeatureAccessState {
  const definition = FEATURE_UNLOCKS.find((item) => item.featureId === featureId);
  if (!definition) return "UNDISCOVERED";
  const level = world.player.experience.level;
  if (level < definition.discoveryLevel) return "UNDISCOVERED";
  if (level < definition.minimumLevel) return "DISCOVERED_LOCKED";
  return prerequisiteMet(world, definition.prerequisite) ? "ACTIONABLE" : "VISIBLE";
}

export function isFeatureVisible(world: WorldState, featureId: string): boolean {
  if (featureId === "settings" || world.player.interfacePreferences.fullInterface || !world.player.interfacePreferences.progressiveInterface) return true;
  const access = featureAccess(world, featureId);
  return access === "VISIBLE" || access === "ACTIONABLE" || (world.player.interfacePreferences.showLockedSections && access === "DISCOVERED_LOCKED");
}

export function isFeatureActionable(world: WorldState, featureId: string): boolean { return featureAccess(world, featureId) === "ACTIONABLE"; }

export function setInterfacePreference<K extends keyof PlayerInterfacePreferences>(
  world: WorldState,
  key: K,
  value: PlayerInterfacePreferences[K],
): void {
  world.player.interfacePreferences[key] = value;
}

export function refreshFeatureDiscovery(world: WorldState): void {
  const state = world.player.experience;
  for (const feature of FEATURE_UNLOCKS) {
    if (state.level >= feature.discoveryLevel && !state.discoveredFeatures.includes(feature.featureId)) state.discoveredFeatures.push(feature.featureId);
    if (state.level >= feature.minimumLevel && !state.unlockedFeatures.includes(feature.featureId)) state.unlockedFeatures.push(feature.featureId);
  }
}

function milestone(world: WorldState, id: string, present: boolean, xp: number, reason: string): void {
  if (!present || world.player.experience.completedMilestones.includes(id)) return;
  world.player.experience.completedMilestones.push(id);
  awardExperience(world, `milestone:${id}`, xp, reason);
}

export function syncPlayerProgression(world: WorldState): void {
  const household = world.households.find((item) => item.id === world.player.householdId);
  milestone(world, "first-job", Boolean(household?.employerId), 180, "Первая работа");
  milestone(world, "first-bank", world.bankAccounts.some((item) => item.ownerId === world.player.householdId), 90, "Первый банковский счёт");
  milestone(world, "first-education", world.player.completedCourseIds.length + world.player.completedProgramIds.length > 0, 240, "Образовательный этап");
  milestone(world, "first-brokerage", world.brokerageAccounts.some((item) => item.ownerId === world.player.householdId), 220, "Первый брокерский счёт");
  milestone(world, "first-investment", world.equityHoldings.some((item) => item.ownerId === world.player.householdId && item.shares > 0), 300, "Первая инвестиция");
  milestone(world, "first-company", world.companies.some((item) => item.ownerHouseholdId === world.player.householdId), 850, "Первая компания");
  milestone(world, "first-loan", world.loans.some((item) => item.borrowerId === world.player.householdId), 260, "Первый кредит");
  milestone(world, "first-fund", world.assetManagers.some((item) => item.ownerId === world.player.householdId), 1_500, "Создание фонда");
  milestone(world, "first-ma", world.mAndADeals.some((item) => world.companies.find((company) => company.id === item.buyerId)?.ownerHouseholdId === world.player.householdId), 1_800, "Первое слияние или поглощение");
  milestone(world, "first-pe", world.privateEquityDeals.some((item) => world.privateEquityFunds.find((fund) => fund.fundId === item.fundId)?.gpId === world.player.householdId), 2_200, "Первая сделка прямых инвестиций");
  for (const loan of world.loans.filter((item) => item.borrowerId === world.player.householdId && item.status === "defaulted")) {
    const id = `default:${loan.id}`;
    if (!world.player.experience.completedMilestones.includes(id)) {
      world.player.experience.completedMilestones.push(id);
      changeReputation(world, -90, "Дефолт", "Кредитор понёс убыток по обязательству игрока");
      awardExperience(world, `milestone:${id}`, 180, "Опыт реструктуризации после дефолта");
    }
  }
  refreshFeatureDiscovery(world);
}

export function inferProgressionFromWorld(world: WorldState): void {
  syncPlayerProgression(world);
  const complexity = (world.companies.some((item) => item.ownerHouseholdId === world.player.householdId) ? 16 : 0)
    + (world.mAndADeals.length ? 10 : 0) + (world.assetManagers.some((item) => item.ownerId === world.player.householdId) ? 15 : 0)
    + (world.privateEquityDeals.length ? 8 : 0) + (world.player.completedProgramIds.length ? 3 : 0);
  if (complexity > world.player.experience.level) world.player.experience.level = Math.min(45, complexity);
  refreshFeatureDiscovery(world);
}

export function nextUnlocks(world: WorldState, limit = 4): FeatureUnlockDefinition[] {
  return FEATURE_UNLOCKS.filter((item) => item.minimumLevel > world.player.experience.level).sort((a, b) => a.minimumLevel - b.minimumLevel).slice(0, limit);
}
