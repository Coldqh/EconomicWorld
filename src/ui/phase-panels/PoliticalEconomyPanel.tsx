import type { WorldState } from "../../domain/model.ts";
import "./phase-panels.css";

const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default function PoliticalEconomyPanel({ world }: { world: WorldState }) {
  const state = world.politicalEconomy;
  const capacity = [...state.stateCapacity].sort((a, b) => b.policyCredibilityBps - a.policyCredibilityBps);
  const shadow = state.shadowEconomy.filter((item) => item.elapsedMonth === world.clock.elapsedMonths || item.elapsedMonth === world.clock.elapsedMonths - 1);
  return <section className="phase-screen">
    <header><h1>Политическая экономика</h1><span>{state.institutions.length} институтов</span></header>
    <div className="phase-kpis"><article><span>Предложения</span><strong>{state.policyProposals.length}</strong></article><article><span>Коалиции</span><strong>{state.coalitions.length}</strong></article><article><span>Закупки</span><strong>{state.procurementContracts.length}</strong></article><article><span>Зомби-фирмы</span><strong>{state.zombieFirms.filter((item) => item.status === "zombie").length}</strong></article></div>
    <div className="phase-columns"><article className="panel"><header className="panel-title"><h2>Государственная способность</h2><span>доверие / риск</span></header><div className="phase-list">{capacity.map((item) => <div key={item.countryId}><b>{item.countryId.toUpperCase()}</b><strong>{percent(item.policyCredibilityBps)}</strong><small>политический риск {percent(item.politicalRiskBps)} · сбор налогов {percent(item.fiscalCapacityBps)}</small></div>)}</div></article><article className="panel"><header className="panel-title"><h2>Теневая экономика</h2><span>истинное / официальное</span></header><div className="phase-list">{shadow.map((item) => <div key={`${item.countryId}:${item.elapsedMonth}`}><b>{item.countryId.toUpperCase()}</b><strong>{item.officialOutputMinor.toLocaleString("ru-RU")}</strong><small>скрыто {item.hiddenOutputMinor.toLocaleString("ru-RU")} · налоговый разрыв {item.taxGapMinor.toLocaleString("ru-RU")}</small></div>)}{!shadow.length && <p className="empty">Данные появятся после закрытия месяца.</p>}</div></article></div>
    <article className="panel"><header className="panel-title"><h2>Решения и денежный след</h2><span>{state.decisionTraces.length}</span></header><div className="phase-traces">{state.decisionTraces.slice(-10).reverse().map((item) => <div key={item.id}><span>{item.countryId.toUpperCase()}</span><b>{item.decision}</b><small>{item.outcome} · транзакций {item.transactionIds.length}</small></div>)}</div></article>
  </section>;
}

