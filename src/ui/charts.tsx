import { useId, useMemo, useState } from "react";
import type { OhlcvBar } from "../domain/model.ts";

const WIDTH = 720;
const HEIGHT = 250;
const PAD_X = 22;
const PAD_TOP = 20;
const PAD_BOTTOM = 28;

function coordinates(values: number[]): Array<{ x: number; y: number; value: number }> {
  const source = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = Math.min(...source);
  const max = Math.max(...source);
  const span = Math.max(1, max - min);
  return source.map((value, index) => ({
    x: PAD_X + (index / Math.max(1, source.length - 1)) * (WIDTH - PAD_X * 2),
    y: PAD_TOP + (1 - (value - min) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM),
    value,
  }));
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
  accent?: "mint" | "cyan" | "amber" | "violet";
  ariaLabel: string;
}) {
  const gradientId = useId().replaceAll(":", "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const points = useMemo(() => coordinates(values), [values]);
  if (!values.length) return <div className={`line-area-chart chart-${accent}`} role="img" aria-label={`${ariaLabel}: нет данных`}><p className="chart-empty">Нет данных</p></div>;
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${PAD_X},${HEIGHT - PAD_BOTTOM} ${line} ${WIDTH - PAD_X},${HEIGHT - PAD_BOTTOM}`;
  const active = activeIndex === null ? points.at(-1) : points[activeIndex];
  const label = activeIndex === null ? labels.at(-1) : labels[activeIndex];

  const handlePointer = (clientX: number, left: number, width: number) => {
    const local = Math.max(0, Math.min(width, clientX - left));
    setActiveIndex(Math.round((local / Math.max(1, width)) * (points.length - 1)));
  };

  return (
    <div className={`line-area-chart chart-${accent}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          handlePointer(event.clientX, rect.left, rect.width);
        }}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((step) => (
          <line key={step} className="chart-gridline" x1={PAD_X} x2={WIDTH - PAD_X} y1={PAD_TOP + step * 48} y2={PAD_TOP + step * 48} />
        ))}
        <polygon className="chart-area" points={area} fill={`url(#${gradientId})`} />
        <polyline className="chart-line" points={line} />
        {active && (
          <>
            <line className="chart-crosshair" x1={active.x} x2={active.x} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} />
            <circle className="chart-point" cx={active.x} cy={active.y} r="4" />
          </>
        )}
      </svg>
      {active && <div className="chart-tooltip"><span>{label ?? "—"}</span><strong>{format(active.value)}</strong></div>}
    </div>
  );
}

export function MiniTrendChart({
  values,
  format = (value) => value.toLocaleString("ru-RU"),
  accent = "mint",
  ariaLabel,
}: {
  values: number[];
  format?: (value: number) => string;
  accent?: "mint" | "cyan" | "amber" | "violet";
  ariaLabel: string;
}) {
  const gradientId = useId().replaceAll(":", "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (!values.length) return <div className="mini-trend-empty" role="img" aria-label={`${ariaLabel}: нет данных`}>Нет данных</div>;
  const source = values.length === 1 ? [values[0], values[0]] : values;
  const minValue = Math.min(...source);
  const maxValue = Math.max(...source);
  const padding = Math.max(1, (maxValue - minValue) * 0.12);
  const scaleMin = minValue === maxValue ? minValue - Math.max(1, Math.abs(minValue) * 0.02) : minValue - padding;
  const scaleMax = minValue === maxValue ? maxValue + Math.max(1, Math.abs(maxValue) * 0.02) : maxValue + padding;
  const points = source.map((value, index) => ({
    value,
    x: 4 + (index / Math.max(1, source.length - 1)) * 112,
    y: 4 + (1 - (value - scaleMin) / Math.max(1, scaleMax - scaleMin)) * 34,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `4,40 ${line} 116,40`;
  const zeroY = scaleMin < 0 && scaleMax > 0 ? 4 + (1 - (0 - scaleMin) / (scaleMax - scaleMin)) * 34 : null;
  const last = points.at(-1)!;
  const active = activeIndex === null ? null : points[activeIndex];
  return <div className={`mini-trend chart-${accent}`}>
    <svg viewBox="0 0 120 44" role="img" aria-label={ariaLabel} onPointerDown={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const index = Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * (points.length - 1));
      setActiveIndex(Math.max(0, Math.min(points.length - 1, index)));
    }} onPointerLeave={() => setActiveIndex(null)}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".22" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      {zeroY !== null && <line className="mini-zero" x1="4" x2="116" y1={zeroY} y2={zeroY} />}
      <polygon className="mini-area" points={area} fill={`url(#${gradientId})`} />
      <polyline className="mini-line" points={line} />
      <circle className="mini-last" cx={last.x} cy={last.y} r="2.3" />
      {active && <circle className="mini-active" cx={active.x} cy={active.y} r="3.4" />}
    </svg>
    {active && <span className="mini-tooltip">{format(active.value)}</span>}
  </div>;
}

export function MarketBars({ production, sales }: { production: number; sales: number }) {
  const max = Math.max(1, production, sales);
  return (
    <div className="market-bars" role="img" aria-label={`Выпуск ${production}, продажи ${sales}`}>
      <i className="production" style={{ width: `${(production / max) * 100}%` }} />
      <i className="sales" style={{ width: `${(sales / max) * 100}%` }} />
    </div>
  );
}

export function TradingChart({ bars, format, ariaLabel }: { bars: OhlcvBar[]; format: (value: number) => string; ariaLabel: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (!bars.length) return <div className="trading-chart empty-chart" role="img" aria-label={`${ariaLabel}: сделок нет`}>Нет сделок — свечи не построены</div>;
  const width = 820;
  const height = 360;
  const priceRight = 740;
  const priceTop = 18;
  const volumeTop = 280;
  const visible = bars.slice(-60);
  const low = Math.min(...visible.map((bar) => bar.lowCents));
  const high = Math.max(...visible.map((bar) => bar.highCents));
  const span = Math.max(1, high - low);
  const maxVolume = Math.max(1, ...visible.map((bar) => bar.volume));
  const candleWidth = Math.max(3, Math.min(16, priceRight / visible.length * 0.62));
  const priceY = (value: number) => priceTop + (1 - (value - low) / span) * 238;
  const x = (index: number) => 18 + index * (priceRight - 36) / Math.max(1, visible.length - 1);
  const active = activeIndex === null ? visible.at(-1)! : visible[activeIndex];
  const activeX = x(activeIndex === null ? visible.length - 1 : activeIndex);
  return <div className="trading-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onPointerMove={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const local = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      setActiveIndex(Math.max(0, Math.min(visible.length - 1, Math.round(local / rect.width * (visible.length - 1)))));
    }} onPointerLeave={() => setActiveIndex(null)}>
      {[0, 1, 2, 3, 4].map((step) => { const y = priceTop + step * 59.5; const value = Math.round(high - span * step / 4); return <g key={step}><line className="trade-grid" x1="0" x2={priceRight} y1={y} y2={y} /><text className="price-axis" x={priceRight + 8} y={y + 4}>{format(value)}</text></g>; })}
      {visible.map((bar, index) => { const candleX = x(index); const positive = bar.closeCents >= bar.openCents; const top = priceY(Math.max(bar.openCents, bar.closeCents)); const bottom = priceY(Math.min(bar.openCents, bar.closeCents)); const volumeHeight = Math.max(1, bar.volume / maxVolume * 54); return <g key={`${bar.securityId}-${bar.elapsedMonth}`} className={positive ? "candle-up" : "candle-down"}><line className="wick" x1={candleX} x2={candleX} y1={priceY(bar.highCents)} y2={priceY(bar.lowCents)} /><rect className="candle" x={candleX - candleWidth / 2} y={top} width={candleWidth} height={Math.max(1.5, bottom - top)} /><rect className="volume" x={candleX - candleWidth / 2} y={volumeTop + 58 - volumeHeight} width={candleWidth} height={volumeHeight} /></g>; })}
      <line className="trade-crosshair" x1={activeX} x2={activeX} y1={priceTop} y2="338" />
      <line className="trade-current" x1="0" x2={priceRight} y1={priceY(visible.at(-1)!.closeCents)} y2={priceY(visible.at(-1)!.closeCents)} />
      <text className="time-axis" x="18" y="350">{visible[0].elapsedMonth + 1}м</text><text className="time-axis" x={priceRight - 24} y="350">{visible.at(-1)!.elapsedMonth + 1}м</text>
    </svg>
    <div className="ohlc-tooltip"><span>{active.elapsedMonth + 1} месяц</span><b>О {format(active.openCents)}</b><b>М {format(active.highCents)}</b><b>Мн {format(active.lowCents)}</b><b>З {format(active.closeCents)}</b><small>Объём {active.volume.toLocaleString("ru-RU")}</small></div>
  </div>;
}

export function BalanceVisual({ assets, liabilities, capital }: { assets: number; liabilities: number; capital: number }) {
  const max = Math.max(1, assets, liabilities + capital);
  return (
    <div className="balance-visual" role="img" aria-label="Структура банковского баланса">
      <div><span style={{ width: `${Math.max(2, (assets / max) * 100)}%` }} /></div>
      <div className="balance-stack">
        <span style={{ width: `${Math.max(2, (liabilities / max) * 100)}%` }} />
        <i style={{ width: `${Math.max(2, (Math.max(0, capital) / max) * 100)}%` }} />
      </div>
    </div>
  );
}

export function DistributionPlot({ values }: { values: number[] }) {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted.at(-1) ?? min + 1;
  const span = Math.max(1, max - min);
  return (
    <div className="distribution-plot" role="img" aria-label="Распределение депозитов домохозяйств">
      <div className="distribution-axis" />
      {sorted.map((value, index) => (
        <i key={index} style={{ left: `${((value - min) / span) * 100}%`, bottom: `${8 + (index % 5) * 7}px` }} />
      ))}
    </div>
  );
}
