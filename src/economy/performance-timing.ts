export type SimulationTimingPhase =
  | "Market Makers"
  | "Heterogeneous Market Agents"
  | "Cross-Venue Arbitrage"
  | "Triangular FX Arbitrage"
  | "ETF Arbitrage"
  | "Cash-and-Carry"
  | "Order Matching"
  | "Settlement"
  | "Fund Rebalancing"
  | "Banks"
  | "Corporate Decisions"
  | "Trade"
  | "FX"
  | "Government"
  | "Sovereign Debt"
  | "Insurance"
  | "PE/M&A/IPO"
  | "Accounting Close"
  | "Ledger Indexing"
  | "History Compaction"
  | "Serialization/save preparation";

export interface SimulationMonthTiming {
  elapsedMonth: number;
  phasesMs: Partial<Record<SimulationTimingPhase, number>>;
  totalMs: number;
}

let enabled = false;
let activeMonth: SimulationMonthTiming | null = null;
const completedMonths: SimulationMonthTiming[] = [];

export function setSimulationTimingEnabled(value: boolean): void {
  enabled = value;
  activeMonth = null;
  completedMonths.length = 0;
}

export function simulationTimingEnabled(): boolean {
  return enabled;
}

export function beginSimulationMonthTiming(elapsedMonth: number): number {
  if (!enabled) return 0;
  activeMonth = { elapsedMonth, phasesMs: {}, totalMs: 0 };
  return performance.now();
}

export function finishSimulationMonthTiming(startedAt: number): void {
  if (!enabled || !activeMonth) return;
  activeMonth.totalMs = performance.now() - startedAt;
  completedMonths.push(activeMonth);
  activeMonth = null;
}

export function startSimulationPhaseTiming(): number {
  return enabled ? performance.now() : 0;
}

export function finishSimulationPhaseTiming(phase: SimulationTimingPhase, startedAt: number): void {
  if (!enabled || !activeMonth) return;
  activeMonth.phasesMs[phase] = (activeMonth.phasesMs[phase] ?? 0) + performance.now() - startedAt;
}

export function simulationTimingBreakdown(): readonly SimulationMonthTiming[] {
  return completedMonths;
}

