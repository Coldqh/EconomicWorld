import type { SimulationClock } from "../domain/model.ts";

export interface SimulationDate {
  year: number;
  month: number;
  quarter: number;
}

export function currentDate(clock: SimulationClock): SimulationDate {
  const absoluteMonth = clock.startMonth - 1 + clock.elapsedMonths;
  const month = (absoluteMonth % 12) + 1;
  return {
    year: clock.startYear + Math.floor(absoluteMonth / 12),
    month,
    quarter: Math.ceil(month / 3),
  };
}

export function formatSimulationDate(clock: SimulationClock): string {
  const { year, month } = currentDate(clock);
  const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(
    new Date(Date.UTC(2024, month - 1, 1)),
  );
  return `${monthName[0].toUpperCase()}${monthName.slice(1)} ${year}`;
}

export function isQuarterEnd(clock: SimulationClock): boolean {
  return currentDate(clock).month % 3 === 0;
}

export function isYearEnd(clock: SimulationClock): boolean {
  return currentDate(clock).month === 12;
}
