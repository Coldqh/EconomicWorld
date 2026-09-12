import { useId, useMemo, useState } from "react";
import type { OhlcvBar, YieldCurveSnapshot } from "../domain/model.ts";

type Accent = "mint" | "cyan" | "amber" | "violet";
type ChartPoint = { x: number; y: number; value: number };

const WIDTH = 720;
const HEIGHT = 276;
const PLOT_LEFT = 18;
const PLOT_RIGHT = 628;
const PLOT_TOP = 58;
const PLOT_BOTTOM = 238;

function chartDomain(values: number[], padding = 0.1) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rawSpan = max - min;
  const fallback = Math.max(1, Math.abs(max || 1) * 0.04);
  const margin = rawSpan > 0 ? rawSpan * padding : fallback;
  return { min: min - margin, max: max + margin, span: Math.max(1, rawSpan + margin * 2) };
}

function coordinates(values: number[]): ChartPoint[] {
  const source = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const domain = chartDomain(source);
  return source.map((value, index) => ({
    x: PLOT_LEFT + (index / Math.max(1, source.length - 1)) * (PLOT_RIGHT - PLOT_LEFT),
    y: PLOT_TOP + (1 - (value - domain.min) / domain.span) * (PLOT_BOTTOM - PLOT_TOP),
    value,
  }));
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (after.x - current.x) / 6;
    const control2Y = next.y - (after.y - current.y) / 6;
    path += ` C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`;
  }
  return path;
}

function percentChange(first: number, last: number) {
  if (!Number.isFinite(first) || Math.abs(first) < 0.000001) return 0;
  return ((last - first) / Math.abs(first)) * 100;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0,
  }).format(value);
}

function average(values: number[], period: number) {
  return values.map((_, index) => {
    const window = values.slice(Math.max(0, index - period + 1), index + 1);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
}

function exponentialAverage(values: number[], period: number) {
  const factor = 2 / (period + 1);
  let current = values[0] ?? 0;
  return values.map((value, index) => {
    current = index === 0 ? value : value * factor + current * (1 - factor);
    return current;
  });
}

export function LineAreaChart({
  values,
  labels,
  format,
  accent = "mint",
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  format: (value: number) => string;
  accent?: Accent;
  ariaLabel: string;
}) {
  const gradientId = useId().replaceAll(":", "");
  const glowId = useId().replaceAll(":", "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const points = useMemo(() => coordinates(values), [values]);
  if (!values.length) {
    return <div className={`line-area-chart terminal-empty chart-${accent}`} role="img" aria-label={`${ariaLabel}: нет данных`}><p>Нет данных</p></div>;
  }
  const path = smoothPath(points);
  const areaPath = `${path} L ${PLOT_RIGHT} ${PLOT_BOTTOM} L ${PLOT_LEFT} ${PLOT_BOTTOM} Z`;
  const active = activeIndex === null ? points.at(-1)! : points[activeIndex];
  const label = activeIndex === null ? labels.at(-1) : labels[activeIndex];
  const domain = chartDomain(values);
  const last = values.at(-1)!;
  const delta = percentChange(values[0], last);
  const direction = delta >= 0 ? "positive" : "negative";

  return (
    <div className={`line-area-chart chart-${accent}`}>
      <div className="chart-head"><strong>{format(last)}</strong><span className={direction}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}%</span><small>{values.length} периодов</small></div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH;
        const ratio = (svgX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT);
        setActiveIndex(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
      }} onPointerLeave={() => setActiveIndex(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity="0.34" /><stop offset="72%" stopColor="currentColor" stopOpacity="0.06" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient>
          <filter id={glowId} x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {[0, 1, 2, 3, 4].map((step) => {
          const y = PLOT_TOP + step * ((PLOT_BOTTOM - PLOT_TOP) / 4);
          const value = domain.max - (domain.span * step) / 4;
          return <g key={step}><line className="chart-gridline" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} /><text className="chart-axis" x="708" y={y + 4} textAnchor="end">{compactNumber(value)}</text></g>;
        })}
        {[0, 1, 2, 3, 4].map((step) => { const x = PLOT_LEFT + step * ((PLOT_RIGHT - PLOT_LEFT) / 4); return <line key={step} className="chart-gridline vertical" x1={x} x2={x} y1={PLOT_TOP} y2={PLOT_BOTTOM} />; })}
        <path className="chart-area" d={areaPath} fill={`url(#${gradientId})`} />
        <path className="chart-line chart-glow" d={path} filter={`url(#${glowId})`} />
        <line className="chart-current" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={points.at(-1)!.y} y2={points.at(-1)!.y} />
        <g className="chart-price-tag" transform={`translate(${PLOT_RIGHT + 5} ${points.at(-1)!.y - 11})`}><rect width="76" height="22" rx="3" /><text x="38" y="15" textAnchor="middle">{compactNumber(last)}</text></g>
        <line className="chart-crosshair" x1={active.x} x2={active.x} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
        <line className="chart-crosshair horizontal" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={active.y} y2={active.y} />
        <circle className="chart-point-halo" cx={active.x} cy={active.y} r="8" /><circle className="chart-point" cx={active.x} cy={active.y} r="3.5" />
        <text className="chart-time-label" x={PLOT_LEFT} y="263">{labels[0] ?? ""}</text><text className="chart-time-label" x={PLOT_RIGHT} y="263" textAnchor="end">{labels.at(-1) ?? ""}</text>
      </svg>
      <div className="chart-tooltip floating" style={{ left: `${Math.max(14, Math.min(86, (active.x / WIDTH) * 100))}%` }}><span>{label ?? "—"}</span><strong>{format(active.value)}</strong></div>
    </div>
  );
}

export function YieldCurveChart({ snapshots, ariaLabel }: { snapshots: YieldCurveSnapshot[]; ariaLabel: string }) {
  const gradientId = useId().replaceAll(":", "");
  const [historyOffset, setHistoryOffset] = useState(0);
  const available = snapshots.slice(-60);
  const offset = Math.min(historyOffset, Math.max(0, available.length - 1));
  const snapshot = available.at(-(offset + 1));
  if (!snapshot) return <div className="yield-curve-chart terminal-empty" role="img" aria-label={`${ariaLabel}: нет данных`}><p>Нет данных</p></div>;
  const points = snapshot.points;
  const maxMaturity = Math.max(1, ...points.map((point) => point.maturityMonths));
  const domain = chartDomain(points.map((point) => point.yieldBps), 0.18);
  const x = (maturity: number) => 36 + maturity / maxMaturity * 590;
  const y = (yieldBps: number) => 46 + (1 - (yieldBps - domain.min) / domain.span) * 158;
  const chartPoints = points.map((point) => ({ x: x(point.maturityMonths), y: y(point.yieldBps) }));
  const path = smoothPath(chartPoints);
  const area = `${path} L 626 204 L 36 204 Z`;
  const spread = points.length > 1 ? points.at(-1)!.yieldBps - points[0].yieldBps : 0;
  return <div className="yield-curve-chart">
    <div className="chart-head"><strong>{(points.at(-1)!.yieldBps / 100).toFixed(2)}%</strong><span className={spread >= 0 ? "positive" : "negative"}>{spread >= 0 ? "+" : ""}{Math.round(spread)} б.п.</span><small>дальний край</small></div>
    <svg viewBox="0 0 720 250" role="img" aria-label={ariaLabel}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".26" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3].map((step) => { const gridY = 46 + step * (158 / 3); const value = domain.max - (domain.span * step) / 3; return <g key={step}><line className="chart-gridline" x1="36" x2="626" y1={gridY} y2={gridY} /><text className="chart-axis" x="704" y={gridY + 4} textAnchor="end">{(value / 100).toFixed(1)}%</text></g>; })}
      {chartPoints.map((point, index) => <line key={index} className="chart-gridline vertical" x1={point.x} x2={point.x} y1="46" y2="204" />)}
      <path className="yield-area" d={area} fill={`url(#${gradientId})`} /><path className="yield-line" d={path} />
      {points.map((point) => <g key={point.maturityMonths}><circle className="yield-point-halo" cx={x(point.maturityMonths)} cy={y(point.yieldBps)} r="8" /><circle className="yield-point" cx={x(point.maturityMonths)} cy={y(point.yieldBps)} r="3.5" /><text className="yield-label" x={x(point.maturityMonths)} y="228" textAnchor="middle">{point.maturityMonths < 24 ? `${point.maturityMonths}м` : `${Math.round(point.maturityMonths / 12)}г`}</text><text className="yield-value" x={x(point.maturityMonths)} y={y(point.yieldBps) - 12} textAnchor="middle">{(point.yieldBps / 100).toFixed(1)}%</text></g>)}
    </svg>
    <footer><span>{snapshot.elapsedMonth + 1} месяц</span>{available.length > 1 && <label>История<input type="range" min="0" max={available.length - 1} value={offset} onChange={(event) => setHistoryOffset(Number(event.target.value))} /></label>}</footer>
  </div>;
}

export function MiniTrendChart({ values, format = (value) => value.toLocaleString("ru-RU"), accent = "mint", ariaLabel }: { values: number[]; format?: (value: number) => string; accent?: Accent; ariaLabel: string }) {
  const gradientId = useId().replaceAll(":", "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (!values.length) return <div className="mini-trend-empty" role="img" aria-label={`${ariaLabel}: нет данных`}>Нет данных</div>;
  const source = values.length === 1 ? [values[0], values[0]] : values;
  const domain = chartDomain(source, 0.12);
  const points = source.map((value, index) => ({ value, x: 4 + (index / Math.max(1, source.length - 1)) * 112, y: 4 + (1 - (value - domain.min) / domain.span) * 34 }));
  const path = smoothPath(points);
  const area = `${path} L 116 40 L 4 40 Z`;
  const zeroY = domain.min < 0 && domain.max > 0 ? 4 + (1 - (0 - domain.min) / domain.span) * 34 : null;
  const last = points.at(-1)!;
  const active = activeIndex === null ? null : points[activeIndex];
  return <div className={`mini-trend chart-${accent}`}>
    <svg viewBox="0 0 120 44" role="img" aria-label={ariaLabel} onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const index = Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * (points.length - 1)); setActiveIndex(Math.max(0, Math.min(points.length - 1, index))); }} onPointerLeave={() => setActiveIndex(null)}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".3" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      {zeroY !== null && <line className="mini-zero" x1="4" x2="116" y1={zeroY} y2={zeroY} />}
      <path className="mini-area" d={area} fill={`url(#${gradientId})`} /><path className="mini-line" d={path} /><circle className="mini-last-halo" cx={last.x} cy={last.y} r="4.5" /><circle className="mini-last" cx={last.x} cy={last.y} r="2.2" />{active && <circle className="mini-active" cx={active.x} cy={active.y} r="3.2" />}
    </svg>{active && <span className="mini-tooltip">{format(active.value)}</span>}
  </div>;
}

export function MarketBars({ production, sales }: { production: number; sales: number }) {
  const max = Math.max(1, production, sales);
  return <div className="market-bars" role="img" aria-label={`Выпуск ${production}, продажи ${sales}`}>
    <div><span>Выпуск</span><strong>{compactNumber(production)}</strong><i><b className="production" style={{ width: `${(production / max) * 100}%` }} /></i></div>
    <div><span>Продажи</span><strong>{compactNumber(sales)}</strong><i><b className="sales" style={{ width: `${(sales / max) * 100}%` }} /></i></div>
  </div>;
}

export function TradingChart({ bars, format, ariaLabel }: { bars: OhlcvBar[]; format: (value: number) => string; ariaLabel: string }) {
  const [pointer, setPointer] = useState<{ index: number; y: number } | null>(null);
  if (!bars.length) return <div className="trading-chart terminal-empty" role="img" aria-label={`${ariaLabel}: сделок нет`}><p>Нет сделок</p><small>График появится после первой сделки</small></div>;
  const width = 900;
  const height = 430;
  const plotLeft = 16;
  const priceRight = 786;
  const priceTop = 42;
  const priceBottom = 292;
  const volumeTop = 330;
  const volumeBottom = 397;
  const visible = bars.slice(-60);
  const domain = chartDomain(visible.flatMap((bar) => [bar.lowCents, bar.highCents]), 0.05);
  const maxVolume = Math.max(1, ...visible.map((bar) => bar.volume));
  const candleWidth = Math.max(3, Math.min(13, ((priceRight - plotLeft) / visible.length) * 0.64));
  const priceY = (value: number) => priceTop + (1 - (value - domain.min) / domain.span) * (priceBottom - priceTop);
  const x = (index: number) => plotLeft + index * (priceRight - plotLeft) / Math.max(1, visible.length - 1);
  const ema7 = exponentialAverage(visible.map((bar) => bar.closeCents), 7);
  const ema20 = exponentialAverage(visible.map((bar) => bar.closeCents), 20);
  const volumeAverage = average(visible.map((bar) => bar.volume), 10);
  const ema7Path = smoothPath(ema7.map((value, index) => ({ x: x(index), y: priceY(value) })));
  const ema20Path = smoothPath(ema20.map((value, index) => ({ x: x(index), y: priceY(value) })));
  const volumeAveragePath = smoothPath(volumeAverage.map((value, index) => ({ x: x(index), y: volumeBottom - (value / maxVolume) * (volumeBottom - volumeTop) })));
  const activeIndex = pointer?.index ?? visible.length - 1;
  const active = visible[activeIndex];
  const activeX = x(activeIndex);
  const last = visible.at(-1)!;
  const first = visible[0];
  const change = percentChange(first.openCents, last.closeCents);
  const currentY = priceY(last.closeCents);
  const high = Math.max(...visible.map((bar) => bar.highCents));
  const low = Math.min(...visible.map((bar) => bar.lowCents));
  const totalVolume = visible.reduce((sum, bar) => sum + bar.volume, 0);
  const hoverPrice = pointer ? domain.max - ((pointer.y - priceTop) / (priceBottom - priceTop)) * domain.span : active.closeCents;
  return <div className="trading-chart">
    <div className="trading-summary"><div className={change >= 0 ? "positive" : "negative"}><strong>{format(last.closeCents)}</strong><span>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span></div><dl><div><dt>Макс.</dt><dd>{format(high)}</dd></div><div><dt>Мин.</dt><dd>{format(low)}</dd></div><div><dt>Объём</dt><dd>{compactNumber(totalVolume)}</dd></div></dl><div className="indicator-legend"><span className="ema-fast">EMA 7</span><span className="ema-slow">EMA 20</span><span className="volume-key">VOL 10</span></div></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width; const svgY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * height; const ratio = (svgX - plotLeft) / (priceRight - plotLeft); setPointer({ index: Math.max(0, Math.min(visible.length - 1, Math.round(ratio * (visible.length - 1)))), y: Math.max(priceTop, Math.min(priceBottom, svgY)) }); }} onPointerLeave={() => setPointer(null)}>
      {[0, 1, 2, 3, 4].map((step) => { const gridY = priceTop + step * ((priceBottom - priceTop) / 4); const value = domain.max - (domain.span * step) / 4; return <g key={step}><line className="trade-grid" x1={plotLeft} x2={priceRight} y1={gridY} y2={gridY} /><text className="price-axis" x="888" y={gridY + 4} textAnchor="end">{format(value)}</text></g>; })}
      {[0, 1, 2, 3, 4, 5].map((step) => { const gridX = plotLeft + step * ((priceRight - plotLeft) / 5); return <line key={step} className="trade-grid vertical" x1={gridX} x2={gridX} y1={priceTop} y2={volumeBottom} />; })}
      <line className="volume-separator" x1={plotLeft} x2={priceRight} y1="314" y2="314" /><text className="volume-caption" x={plotLeft} y="326">ОБЪЁМ</text>
      {visible.map((bar, index) => { const candleX = x(index); const positive = bar.closeCents >= bar.openCents; const top = priceY(Math.max(bar.openCents, bar.closeCents)); const bottom = priceY(Math.min(bar.openCents, bar.closeCents)); const volumeHeight = Math.max(1, (bar.volume / maxVolume) * (volumeBottom - volumeTop)); return <g key={`${bar.securityId}-${bar.elapsedMonth}`} className={positive ? "candle-up" : "candle-down"}><line className="wick" x1={candleX} x2={candleX} y1={priceY(bar.highCents)} y2={priceY(bar.lowCents)} /><rect className="candle" x={candleX - candleWidth / 2} y={top} width={candleWidth} height={Math.max(1.5, bottom - top)} rx="1" /><rect className="volume" x={candleX - candleWidth / 2} y={volumeBottom - volumeHeight} width={candleWidth} height={volumeHeight} rx="1" /></g>; })}
      <path className="ema-line ema-fast" d={ema7Path} /><path className="ema-line ema-slow" d={ema20Path} /><path className="volume-average" d={volumeAveragePath} />
      <line className="trade-current" x1={plotLeft} x2={priceRight} y1={currentY} y2={currentY} /><g className={`trade-price-tag ${change >= 0 ? "up" : "down"}`} transform={`translate(${priceRight + 5} ${currentY - 11})`}><rect width="103" height="22" rx="3" /><text x="51.5" y="15" textAnchor="middle">{format(last.closeCents)}</text></g>
      <line className="trade-crosshair" x1={activeX} x2={activeX} y1={priceTop} y2={volumeBottom} />{pointer && <><line className="trade-crosshair horizontal" x1={plotLeft} x2={priceRight} y1={pointer.y} y2={pointer.y} /><g className="hover-price-tag" transform={`translate(${priceRight + 5} ${pointer.y - 10})`}><rect width="103" height="20" rx="3" /><text x="51.5" y="14" textAnchor="middle">{format(hoverPrice)}</text></g></>}
      <circle className="trade-active-point" cx={activeX} cy={priceY(active.closeCents)} r="3" />
      {[0, 1, 2, 3].map((step) => { const index = Math.round(step * (visible.length - 1) / 3); return <text key={step} className="time-axis" x={x(index)} y="421" textAnchor={step === 0 ? "start" : step === 3 ? "end" : "middle"}>{visible[index].elapsedMonth + 1}м</text>; })}
    </svg>
    <div className="ohlc-tooltip"><span>{active.elapsedMonth + 1} месяц</span><b>О {format(active.openCents)}</b><b>МАКС {format(active.highCents)}</b><b>МИН {format(active.lowCents)}</b><b>З {format(active.closeCents)}</b><small>Объём {active.volume.toLocaleString("ru-RU")}</small></div>
  </div>;
}

export function BalanceVisual({ assets, liabilities, capital }: { assets: number; liabilities: number; capital: number }) {
  const max = Math.max(1, assets, liabilities + Math.max(0, capital));
  return <div className="balance-visual" role="img" aria-label="Структура банковского баланса">
    <div className="balance-row"><header><span>Активы</span><strong>{compactNumber(assets)}</strong></header><div className="balance-track"><span className="assets" style={{ width: `${Math.max(2, (assets / max) * 100)}%` }} /></div></div>
    <div className="balance-row"><header><span>Обязательства / капитал</span><strong>{compactNumber(liabilities)} / {compactNumber(capital)}</strong></header><div className="balance-track balance-stack"><span style={{ width: `${Math.max(2, (liabilities / max) * 100)}%` }} /><i style={{ width: `${Math.max(2, (Math.max(0, capital) / max) * 100)}%` }} /></div></div>
  </div>;
}

export function DistributionPlot({ values }: { values: number[] }) {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted.at(-1) ?? min + 1;
  const span = Math.max(1, max - min);
  return <div className="distribution-plot" role="img" aria-label="Распределение депозитов домохозяйств">
    {[0, 1, 2, 3, 4].map((step) => <span key={step} className="distribution-grid" style={{ left: `${step * 25}%` }} />)}<div className="distribution-axis" />
    {sorted.map((value, index) => <i key={index} style={{ left: `${((value - min) / span) * 100}%`, bottom: `${8 + (index % 5) * 7}px` }} />)}<small className="distribution-min">{compactNumber(min)}</small><small className="distribution-max">{compactNumber(max)}</small>
  </div>;
}
