import { useState } from "react";
import type { WorldState } from "../../domain/model.ts";
import { bankAccountBalance, bankAccountsForOwner } from "../../core/ledger.ts";
import { valueInReportingCurrency } from "../../finance/fx-market.ts";
import { createFuture, derivativeExposure, writeOption } from "../../finance/derivatives.ts";
import { valueEuropeanOption } from "../../finance/option-pricing.ts";
import { formatCompactMoney, formatMoney } from "../../finance/currencies.ts";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const currencyMoney = (amountMinor: number, currencyId: string) => formatMoney(amountMinor, currencyId);
const compactMoney = (amountMinor: number, currencyId = "RUB") => formatCompactMoney(amountMinor, currencyId);
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const CONTRACT_STATUS_LABELS: Record<string, string> = {
  active: "активен", matured: "истёк", settled: "рассчитан", defaulted: "дефолт", terminated: "закрыт",
  open: "открыт", closed: "закрыт", expired: "истёк",
};

export default function AdvancedMarketsPanel({ world, exchange, listings, commit, notify }: { world: WorldState; exchange: WorldState["exchanges"][number] | undefined; listings: WorldState["listings"]; commit: () => void; notify: (text: string) => void }) {
  const [tab, setTab] = useState<"futures" | "options" | "otc">("options");
  const [securityId, setSecurityId] = useState(listings[0]?.securityId ?? "");
  const playerId = world.player.householdId;
  const listing = listings.find((item) => item.securityId === securityId) ?? listings[0];
  const localBank = exchange && world.banks.find((bank) => bank.countryId === exchange.countryId && bank.baseCurrency === exchange.currencyId);
  const settlement = exchange && bankAccountsForOwner(world, playerId, exchange.currencyId)[0];
  const brokerage = exchange && world.brokerageAccounts.find((account) => account.ownerId === playerId && account.currencyId === exchange.currencyId && world.brokers.find((broker) => broker.id === account.brokerId)?.exchangeIds.includes(exchange.id));
  const capital = valueInReportingCurrency(world, playerId, world.player.reportingCurrencyId).totalMinor;
  const exchangeAccess = Boolean(exchange && settlement && brokerage && bankAccountBalance(world, settlement.id) >= 100_000);
  const professionalAccess = exchangeAccess && capital >= 5_000_000_00 && (world.player.profileId === "professional" || world.player.completedProgramIds.length > 0);
  const optionSeries = world.optionMarketSeries.filter((series) => series.exchangeId === exchange?.id && series.underlyingSecurityId === listing?.securityId && series.expirationMonth > world.clock.elapsedMonths);
  const strikes = [...new Set(optionSeries.map((series) => series.strikeMinor))].sort((left, right) => left - right);
  const area = world.monetaryAreas.find((item) => item.currencyId === exchange?.currencyId);
  const rate = world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId)?.policyRateBps ?? 0;
  const greeks = (series: WorldState["optionMarketSeries"][number] | undefined) => series && listing ? valueEuropeanOption({ optionType: series.optionType, underlyingPriceMinor: listing.lastPriceCents, strikeMinor: series.strikeMinor, timeToExpiryYears: Math.max(1, series.expirationMonth - world.clock.elapsedMonths) / 12, riskFreeRateBps: rate, volatilityBps: series.impliedVolatilityBps ?? 2_500 }) : null;
  const playerContracts = world.derivativeContracts.filter((contract) => contract.counterpartyIds.includes(playerId));
  const exposure = derivativeExposure(world, playerId);
  const openFuture = () => {
    if (!exchange || !listing || !localBank) return;
    const contract = createFuture(world, playerId, localBank.id, { kind: "equity", securityId: listing.securityId }, exchange.id, 1, 1, 6);
    commit();
    notify(contract ? "Фьючерс открыт и принят клирингом" : "Не удалось внести начальную маржу");
  };
  const buyOption = (series: WorldState["optionMarketSeries"][number]) => {
    if (!localBank) return;
    const answer = writeOption(world, series.id, playerId, localBank.id, 1);
    commit();
    notify(answer.message);
  };

  return <>
    <div className="compact-tabs derivative-tabs"><button className={tab === "futures" ? "active" : ""} onClick={() => setTab("futures")}>Фьючерсы</button><button className={tab === "options" ? "active" : ""} onClick={() => setTab("options")}>Опционы</button><button className={tab === "otc" ? "active" : ""} onClick={() => setTab("otc")}>Свопы и внебиржевой рынок</button></div>
    <section className="derivative-access panel"><dl><div><dt>Биржевой доступ</dt><dd className={exchangeAccess ? "positive" : "negative"}>{exchangeAccess ? "Открыт" : "Нужны брокерский счёт и капитал"}</dd></div><div><dt>Профессиональный доступ</dt><dd className={professionalAccess ? "positive" : ""}>{professionalAccess ? "Открыт" : "Закрыт"}</dd></div><div><dt>Номинал</dt><dd>{compactMoney(exposure.grossNotionalMinor, exchange?.currencyId ?? world.player.reportingCurrencyId)}</dd></div><div><dt>Чистая позиция</dt><dd>{compactMoney(exposure.netExposureMinor, exchange?.currencyId ?? world.player.reportingCurrencyId)}</dd></div><div><dt>Внесено обеспечения</dt><dd>{compactMoney(exposure.collateralPostedMinor, exchange?.currencyId ?? world.player.reportingCurrencyId)}</dd></div></dl></section>
    {listings.length > 0 && <div className="filter-bar derivative-underlying"><label>Базовый актив<select value={listing?.securityId ?? ""} onChange={(event) => setSecurityId(event.target.value)}>{listings.map((item) => <option key={item.id} value={item.securityId}>{item.ticker}</option>)}</select></label></div>}
    {tab === "options" && <article className="panel option-chain"><header className="panel-title"><h2>Цепочка опционов · {listing?.ticker}</h2><span>Экспирация {optionSeries[0]?.expirationMonth ? `${optionSeries[0].expirationMonth + 1}м` : "—"}</span></header><div className="option-chain-scroll"><div className="option-chain-head"><span>Цена колл</span><span>Δ</span><span>Страйк</span><span>Цена пут</span><span>Δ</span><span>Открытый интерес</span></div>{strikes.map((strike) => { const call = optionSeries.find((series) => series.strikeMinor === strike && series.optionType === "call"); const put = optionSeries.find((series) => series.strikeMinor === strike && series.optionType === "put"); const callGreeks = greeks(call); const putGreeks = greeks(put); return <div className="option-chain-row" key={strike}><button disabled={!call || !exchangeAccess} onClick={() => call && buyOption(call)}>{call ? currencyMoney(call.askMinor ?? 0, call.currencyId) : "—"}</button><span>{callGreeks?.delta.toFixed(2) ?? "—"}</span><strong>{currencyMoney(strike, exchange?.currencyId ?? "RUB")}</strong><button disabled={!put || !exchangeAccess} onClick={() => put && buyOption(put)}>{put ? currencyMoney(put.askMinor ?? 0, put.currencyId) : "—"}</button><span>{putGreeks?.delta.toFixed(2) ?? "—"}</span><span>{(call?.openInterest ?? 0) + (put?.openInterest ?? 0)}</span><small>Γ {callGreeks?.gamma.toFixed(4) ?? "—"} · Θ {number.format(callGreeks?.thetaPerMonthMinor ?? 0)} · Вега {number.format(callGreeks?.vegaPerVolPointMinor ?? 0)} · Подразумеваемая волатильность {percent(call?.impliedVolatilityBps ?? 2_500)}</small></div>; })}</div>{!strikes.length && <p className="empty">Серий для выбранного актива нет.</p>}</article>}
    {tab === "futures" && <><article className="panel derivative-ticket"><header className="panel-title"><h2>{listing?.ticker} · 6 месяцев</h2><span>Расчётный фьючерс</span></header><dl className="metric-list"><div><dt>Цена</dt><dd>{currencyMoney(listing?.lastPriceCents ?? 0, exchange?.currencyId ?? "RUB")}</dd></div><div><dt>Начальная маржа</dt><dd>{currencyMoney(Math.round((listing?.lastPriceCents ?? 0) * 1_200 / 10_000), exchange?.currencyId ?? "RUB")}</dd></div><div><dt>Вариационная маржа</dt><dd>Ежемесячно</dd></div><div><dt>Клиринг</dt><dd>{world.clearingHouses.find((house) => house.exchangeIds.includes(exchange?.id ?? ""))?.name ?? "—"}</dd></div></dl><button className="primary" disabled={!exchangeAccess} onClick={openFuture}>Открыть длинную позицию</button></article><article className="panel"><header className="panel-title"><h2>Открытые позиции</h2><span>{world.clearedPositions.filter((position) => position.memberId === playerId && position.status === "open").length}</span></header><div className="bond-list">{world.clearedPositions.filter((position) => position.memberId === playerId && position.status === "open").map((position) => { const contract = world.derivativeContracts.find((item) => item.id === position.contractId); return <article key={position.id}><span>{position.side === "long" ? "Длинная" : "Короткая"} · {contract?.id}</span><strong>{position.netQuantity}</strong><small>{currencyMoney(position.lastSettlementPriceMinor, contract?.currencyId ?? "RUB")}</small></article>; })}</div></article></>}
    {tab === "otc" && <><article className="panel"><header className="panel-title"><h2>Позиции</h2><span>{playerContracts.filter((contract) => contract.type !== "future" && contract.type !== "option").length}</span></header><div className="bond-list">{playerContracts.filter((contract) => contract.type !== "future" && contract.type !== "option").map((contract) => <article key={contract.id}><span>{contract.type === "interest-rate-swap" ? "Процентный своп" : contract.type === "total-return-swap" ? "Своп совокупного дохода" : contract.type === "credit-default-swap" ? "Кредитная защита" : contract.type === "fx-swap" ? "Валютный своп" : "Форвард"}</span><strong>{compactMoney(contract.notionalMinor, contract.currencyId)}</strong><small>{CONTRACT_STATUS_LABELS[contract.status] ?? contract.status} · до {contract.maturityMonth + 1}м</small></article>)}</div>{!professionalAccess && <p className="empty">Внебиржевой рынок доступен через профессиональный счёт при достаточном капитале.</p>}</article><article className="panel"><header className="panel-title"><h2>Риск контрагента</h2></header><dl className="metric-list"><div><dt>Рыночная стоимость</dt><dd>{compactMoney(exposure.grossMarketValueMinor, exchange?.currencyId ?? "RUB")}</dd></div><div><dt>Потенциальный риск</dt><dd>{compactMoney(exposure.potentialExposureMinor, exchange?.currencyId ?? "RUB")}</dd></div><div><dt>Получено обеспечения</dt><dd>{compactMoney(exposure.collateralReceivedMinor, exchange?.currencyId ?? "RUB")}</dd></div></dl></article></>}
  </>;
}
