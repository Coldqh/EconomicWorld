import { useEffect, useRef, useState } from "react";
import type { ConflictStatus, WorldState } from "../../domain/model.ts";
import { formatCompactMoney } from "../../finance/currencies.ts";

const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const CONFLICT_STATUS: Record<ConflictStatus, string> = {
  proposed: "Предложен",
  approved: "Одобрен",
  rejected: "Отклонён",
  mobilizing: "Мобилизация",
  active: "Активен",
  ceasefire: "Перемирие",
  negotiation: "Переговоры",
  settled: "Урегулирован",
  terminated: "Завершён",
};

export default function DefenseConflictPanel({ world }: { world: WorldState }) {
  const [countryId, setCountryId] = useState(world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? "ru");
  const [showWhy, setShowWhy] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const state = world.defenseEconomy.countries.find((item) => item.countryId === countryId)!;
  const country = world.countries.find((item) => item.id === countryId)!;
  const conflicts = world.conflicts.conflicts.filter((item) => item.participantCountryIds.includes(countryId));
  const trueStateVisible = world.player.interfacePreferences.developerTrueState;
  const restricted = trueStateVisible ? (value: string) => value : () => "НЕТ ДОСТУПА";
  const why = state.lastCauseCodes.length
    ? state.lastCauseCodes.map((code) => ({
      "maintenance-shortage": "нехватка обслуживания",
      "restricted-inputs": "ограничение комплектующих",
      "fuel-shortage": "нехватка топлива",
      "funding-or-capacity-shortage": "нехватка финансирования или мощности",
    }[code] ?? code)).join(", ")
    : "Критических ограничений нет.";

  useEffect(() => {
    if (!showWhy) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setShowWhy(false); };
    window.addEventListener("keydown", onKeyDown);
    closeButton.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showWhy]);

  return <>
    <header className="section-heading">
      <h1>Оборона и конфликты</h1>
      <select aria-label="Страна" value={countryId} onChange={(event) => setCountryId(event.target.value)}>
        {world.countries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </header>
    <section className="kpi-grid four">
      <article className="kpi"><span>Бюджет</span><strong>{formatCompactMoney(state.personnelSpendingMinor + state.procurementSpendingMinor + state.operationsMaintenanceMinor + state.researchSpendingMinor + state.infrastructureSpendingMinor, country.currencyReference)}</strong></article>
      <article className="kpi"><span>Готовность</span><strong>{restricted(percent(state.readinessBps))}</strong><small>{trueStateVisible ? "ИСТИННОЕ · ДИАГНОСТИКА" : "КОНФИДЕНЦИАЛЬНО"}</small></article>
      <article className="kpi"><span>Личный состав</span><strong>{state.activePersonnel.toLocaleString("ru-RU")}</strong></article>
      <article className="kpi"><span>Зависимость от импорта</span><strong>{percent(state.importDependencyBps)}</strong></article>
    </section>
    <section className="two-column">
      <article className="panel">
        <header className="panel-title"><h2>Расходы</h2><span>{country.name}</span></header>
        <dl className="metric-list">
          <div><dt>Персонал</dt><dd>{formatCompactMoney(state.personnelSpendingMinor, country.currencyReference)}</dd></div>
          <div><dt>Закупки</dt><dd>{formatCompactMoney(state.procurementSpendingMinor, country.currencyReference)}</dd></div>
          <div><dt>Эксплуатация</dt><dd>{formatCompactMoney(state.operationsMaintenanceMinor, country.currencyReference)}</dd></div>
          <div><dt>НИОКР</dt><dd>{formatCompactMoney(state.researchSpendingMinor, country.currencyReference)}</dd></div>
        </dl>
      </article>
      <article className="panel">
        <header className="panel-title"><h2>Запасы</h2><button onClick={() => setShowWhy(true)}>Почему?</button></header>
        <dl className="metric-list">
          <div><dt>Оснащение</dt><dd>{restricted(formatCompactMoney(state.equipmentStockMinor, country.currencyReference))}</dd></div>
          <div><dt>Боеприпасы</dt><dd>{restricted(formatCompactMoney(state.munitionsStockMinor, country.currencyReference))}</dd></div>
          <div><dt>Топливо</dt><dd>{restricted(formatCompactMoney(state.fuelStockMinor, country.currencyReference))}</dd></div>
          <div><dt>Запчасти</dt><dd>{restricted(formatCompactMoney(state.sparePartsStockMinor, country.currencyReference))}</dd></div>
        </dl>
      </article>
    </section>
    <article className="panel">
      <header className="panel-title"><h2>Конфликты</h2><span>{conflicts.length}</span></header>
      <div className="phase-list">{conflicts.map((conflict) => (
        <div key={conflict.id}>
          <b>{conflict.participantCountryIds.map((id) => id.toUpperCase()).join(" / ")}</b>
          <span>{CONFLICT_STATUS[conflict.status]} · интенсивность {percent(conflict.intensityBps)}</span>
          <strong>{formatCompactMoney(conflict.fiscalCostMinorByCountry[countryId] ?? 0, country.currencyReference)}</strong>
        </div>
      ))}{!conflicts.length && <p className="empty">Активных конфликтов нет.</p>}</div>
    </article>
    {showWhy && (
      <div className="modal-layer" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setShowWhy(false); }}>
        <section className="why-modal" role="dialog" aria-modal="true" aria-labelledby="defense-why-title" aria-describedby="defense-why-description">
          <header><h2 id="defense-why-title">Причины готовности</h2><button ref={closeButton} onClick={() => setShowWhy(false)} aria-label="Закрыть">×</button></header>
          <p id="defense-why-description">{why}</p>
          <button className="primary" onClick={() => setShowWhy(false)}>Понятно</button>
        </section>
      </div>
    )}
  </>;
}
