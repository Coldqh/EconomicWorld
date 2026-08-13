import { useState } from "react";
import type { WorldState } from "../../domain/model.ts";
import { createHistoricalValidationWorld, runEconomicLab, type EconomicLabResult } from "../../economy/economic-lab.ts";
import { loadHistoricalSeries } from "../../data/real-world/historical-series.ts";
import { alignReferenceSeriesToWorld, compareCalibrationSeries, simulatedMetricSeries, type CalibrationResult } from "../../economy/calibration.ts";
import "./phase-panels.css";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default function EconomicLabPanel({ world }: { world: WorldState }) {
  const [countryId, setCountryId] = useState("ru");
  const [rateDelta, setRateDelta] = useState(100);
  const [horizon, setHorizon] = useState(12);
  const [duration, setDuration] = useState(12);
  const [policyMode, setPolicyMode] = useState<"RATE_SHOCK" | "RATE_PATH" | "POLICY_RULE_SHIFT">("RATE_SHOCK");
  const [historicalYear, setHistoricalYear] = useState(world.baselineReference.referenceYear);
  const [result, setResult] = useState<EconomicLabResult | null>(null);
  const [validation, setValidation] = useState<CalibrationResult[]>([]);
  const [running, setRunning] = useState(false);
  const run = () => { setRunning(true); window.setTimeout(() => { setResult(runEconomicLab(world, { countryId, horizonMonths: horizon, policyRateDeltaBps: rateDelta, policyDurationMonths: duration, policyMode, historicalStartYear: historicalYear })); setRunning(false); }, 0); };
  const validate = async () => {
    setRunning(true);
    const series = await loadHistoricalSeries(countryId);
    window.setTimeout(() => {
      const validationWorld = createHistoricalValidationWorld(world, historicalYear);
      const points = validationWorld.macroHistory.filter((point) => point.countryId === countryId);
      setValidation(series.map((reference) => compareCalibrationSeries(alignReferenceSeriesToWorld(reference, validationWorld.clock.startYear, validationWorld.clock.startMonth), simulatedMetricSeries(reference.metric, points))));
      setRunning(false);
    }, 0);
  };
  return <section className="phase-screen">
    <header><h1>Экономическая лаборатория</h1><span>Контрфактический клон</span></header>
    <section className="lab-layout"><article className="panel lab-controls"><label>Страна<select value={countryId} onChange={(event) => setCountryId(event.target.value)}>{world.countries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}</select></label><label>Исторический старт<select value={historicalYear} onChange={(event) => setHistoricalYear(Number(event.target.value))}>{[2019, 2020, 2021, 2022, 2023].map((year) => <option key={year} value={year}>{year}</option>)}</select></label><label>Режим ставки<select value={policyMode} onChange={(event) => setPolicyMode(event.target.value as typeof policyMode)}><option value="RATE_SHOCK">Шок ставки</option><option value="RATE_PATH">Траектория ставки</option><option value="POLICY_RULE_SHIFT">Сдвиг правила ЦБ</option></select></label><label>Изменение ставки, п.п.<input type="number" value={rateDelta / 100} step="0.25" onChange={(event) => setRateDelta(Math.round(Number(event.target.value) * 100))} /></label><label>Длительность<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value="3">3 месяца</option><option value="6">6 месяцев</option><option value="12">1 год</option><option value="24">2 года</option></select></label><label>Горизонт<select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}><option value="6">6 месяцев</option><option value="12">1 год</option><option value="24">2 года</option></select></label><button className="primary" disabled={running} onClick={run}>{running ? "Расчёт…" : "Сравнить миры"}</button><button onClick={() => { void validate(); }}>Сверить с {historicalYear}–2023</button></article>
      <div>{result ? <><section className="phase-kpis">{result.deltas.map((delta) => <article key={delta.metric}><span>{delta.metric}</span><strong>{number.format(delta.delta)}</strong><small>{number.format(delta.baseline)} → {number.format(delta.counterfactual)}</small></article>)}</section><article className="panel"><header className="panel-title"><h2>Наблюдаемая цепочка</h2><span>{result.deterministicFingerprint}</span></header><div className="phase-list">{result.causalChain.map((link, index) => <div key={`${link.to}-${index}`}><b>{link.from} → {link.to}</b><strong>{number.format(link.observedContribution)}</strong></div>)}</div></article></> : <article className="panel empty">Задайте изменение и запустите сравнение.</article>}{validation.length > 0 && <article className="panel"><header className="panel-title"><h2>Историческая проверка</h2><span>{validation.length} рядов</span></header><div className="phase-list">{validation.map((item) => <div key={item.seriesId}><b>{item.seriesId} · корр. {percent(item.correlationBps)}</b><strong>RMSE {number.format(item.rootMeanSquaredError)}</strong></div>)}</div></article>}</div>
    </section>
  </section>;
}

