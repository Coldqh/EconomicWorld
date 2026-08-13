import { useState } from "react";
import type { WorldState } from "../../domain/model.ts";
import { checkInvariants } from "../../economy/invariants.ts";
import "./phase-panels.css";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default function DiagnosticsPanel({ world }: { world: WorldState }) {
  const [tab, setTab] = useState<"performance" | "save" | "ledger" | "countries">("performance");
  const invariants = checkInvariants(world);
  const diagnostics = world.diagnostics;
  const breakdown = diagnostics.saveBreakdown;
  const saveRows = [["Реестр", breakdown.ledgerBytes], ["Рынки", breakdown.marketsBytes], ["История", breakdown.historyBytes], ["Деривативы", breakdown.derivativesBytes], ["Компании", breakdown.companiesBytes], ["Население", breakdown.populationBytes], ["Госдолг", breakdown.sovereignBytes], ["Прочее", breakdown.otherBytes]] as const;
  return <section className="phase-screen">
    <header><h1>Контроль</h1><span>{invariants.filter((item) => item.ok).length}/{invariants.length} проверок</span></header>
    <div className="phase-kpis"><article><span>Население</span><strong>{diagnostics.populationRepresented.toLocaleString("ru-RU")}</strong></article><article><span>Фирмы</span><strong>{diagnostics.businessesRepresented.toLocaleString("ru-RU")}</strong></article><article><span>Горячий реестр</span><strong>{diagnostics.ledgerHotTransactions.toLocaleString("ru-RU")}</strong></article><article><span>Сохранение</span><strong>{number.format(diagnostics.estimatedSaveBytes / 1_000_000)} МБ</strong></article></div>
    <div className="diagnostic-tabs" role="tablist">{[["performance", "Производительность"], ["save", "Сохранение"], ["ledger", "Реестр"], ["countries", "Страны"]].map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</div>
    {tab === "performance" && <div className="phase-columns"><article className="panel"><header className="panel-title"><h2>Память</h2><span>{diagnostics.memoryPressure}</span></header><div className="phase-list"><div><b>Размер мира</b><strong>{number.format(diagnostics.estimatedSaveBytes / 1_000_000)} МБ</strong></div><div><b>Записи истории</b><strong>{diagnostics.historyRecordCount.toLocaleString("ru-RU")}</strong></div><div><b>Расчётные единицы</b><strong>{diagnostics.deterministicWorkUnits.toLocaleString("ru-RU")}</strong></div></div></article><article className="panel"><header className="panel-title"><h2>Масштаб</h2><span>{world.clock.elapsedMonths} мес.</span></header><div className="phase-list"><div><b>Подробные персоны</b><strong>{diagnostics.highFidelityPersons}</strong></div><div><b>Подробные компании</b><strong>{diagnostics.explicitFirms}</strong></div><div><b>Активные деривативы</b><strong>{diagnostics.activeDerivativeContracts}</strong></div></div></article></div>}
    {tab === "save" && <article className="panel"><header className="panel-title"><h2>Состав сохранения</h2><span>{number.format(breakdown.totalBytes / 1_000_000)} МБ</span></header><div className="phase-list">{saveRows.map(([label, bytes]) => <div key={label}><b>{label}</b><strong>{number.format(bytes / 1_000_000)} МБ</strong></div>)}</div></article>}
    {tab === "ledger" && <article className="panel"><header className="panel-title"><h2>Уровни реестра</h2><span>баланс</span></header><div className="phase-list"><div><b>Горячие операции</b><strong>{world.ledger.transactions.length.toLocaleString("ru-RU")}</strong></div><div><b>Важные детали</b><strong>{world.history.importantLedgerTransactions.length.toLocaleString("ru-RU")}</strong></div><div><b>Сжатые операции</b><strong>{diagnostics.ledgerCompactedTransactions.toLocaleString("ru-RU")}</strong></div></div></article>}
    {tab === "countries" && <article className="panel"><header className="panel-title"><h2>Сверка стран</h2><span>{world.realWorldInitializationReports.filter((item) => item.withinTolerance).length}/{world.realWorldInitializationReports.length || world.countries.length}</span></header><div className="phase-list">{world.countryEconomicProfiles.map((profile) => <div key={profile.countryId}><b>{profile.countryId.toUpperCase()} · {number.format(profile.population / 1_000_000)} млн</b><strong>{percent(profile.unemploymentBps)}</strong><small>{profile.metadata.sourceType} · {profile.metadata.baseYear}</small></div>)}</div></article>}
    <section className="invariant-grid">{invariants.map((item) => <article className={`invariant ${item.ok ? "pass" : "fail"}`} key={item.id}><span>{item.ok ? "Норма" : "Ошибка"}</span><div><small>{item.section}</small><h2>{item.title}</h2><p>{item.detail}</p></div></article>)}</section>
  </section>;
}
