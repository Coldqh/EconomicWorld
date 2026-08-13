import type { WorldState } from "../../domain/model.ts";
import "./phase-panels.css";

const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default function GeoeconomicsPanel({ world }: { world: WorldState }) {
  const state = world.geoeconomics;
  const dependencies = [...state.directionalDependencies].sort((a, b) => b.strategicDependencyBps - a.strategicDependencyBps).slice(0, 12);
  const policies = state.policies.filter((item) => item.status === "active").slice(-12).reverse();
  return <section className="phase-screen">
    <header><h1>Геоэкономика</h1><span>{policies.length} активных мер</span></header>
    <div className="phase-kpis"><article><span>Соглашения</span><strong>{state.tradeAgreements.filter((item) => item.status === "active").length}</strong></article><article><span>Экономические блоки</span><strong>{state.blocs.length}</strong></article><article><span>Промышленные программы</span><strong>{state.industrialPolicyPrograms.filter((item) => item.status === "active").length}</strong></article><article><span>Суверенные линии</span><strong>{state.sovereignLendingFacilities.filter((item) => item.status === "open").length}</strong></article></div>
    <div className="phase-columns"><article className="panel"><header className="panel-title"><h2>Направленные зависимости</h2><span>стратегическая доля</span></header><div className="phase-list">{dependencies.map((item) => <div key={`${item.sourceCountryId}:${item.targetCountryId}`}><b>{item.sourceCountryId.toUpperCase()} → {item.targetCountryId.toUpperCase()}</b><strong>{percent(item.strategicDependencyBps)}</strong><small>торговля {percent(item.tradeDependencyBps)} · финансы {percent(item.financeDependencyBps)}</small></div>)}</div></article><article className="panel"><header className="panel-title"><h2>Меры</h2><span>policy access</span></header><div className="phase-list">{policies.map((item) => <div key={item.id}><b>{item.kind}</b><strong>{item.targetCountryIds.map((id) => id.toUpperCase()).join(", ")}</strong><small>{item.rateBps ? `ставка ${percent(item.rateBps)}` : `ограничение ${percent(item.accessPenaltyBps)}`}</small></div>)}{!policies.length && <p className="empty">Активных мер нет.</p>}</div></article></div>
    <article className="panel"><header className="panel-title"><h2>Решения</h2><span>{state.decisionTraces.length}</span></header><div className="phase-traces">{state.decisionTraces.slice(-10).reverse().map((item) => <div key={item.id}><span>{item.actorCountryId.toUpperCase()}</span><b>{item.decision}</b><small>{item.outcome} · {item.reasons[0]}</small></div>)}</div></article>
  </section>;
}

