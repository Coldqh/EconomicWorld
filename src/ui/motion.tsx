import {
  type CSSProperties,
  type PropsWithChildren,
  useEffect,
  useRef,
  useState,
} from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const rendered = useRef(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (reduced) {
      const frame = requestAnimationFrame(() => {
        rendered.current = value;
        setDisplay(value);
      });
      return () => cancelAnimationFrame(frame);
    }
    const from = rendered.current;
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const progress = Math.min(1, (now - started) / 420);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (value - from) * eased;
      rendered.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [reduced, value]);

  return <span className={className}>{format(display)}</span>;
}

export function DataPulse({ value, children }: PropsWithChildren<{ value: number }>) {
  const previous = useRef(value);
  const [direction, setDirection] = useState<"up" | "down" | "idle">("idle");

  useEffect(() => {
    const next = value > previous.current ? "up" : value < previous.current ? "down" : "idle";
    previous.current = value;
    setDirection(next);
    if (next === "idle") return;
    const timer = window.setTimeout(() => setDirection("idle"), 620);
    return () => window.clearTimeout(timer);
  }, [value]);

  return <span className={`data-pulse data-pulse-${direction}`}>{children}</span>;
}

export function PageTransition({ children }: PropsWithChildren) {
  return <div className="page-transition">{children}</div>;
}

export function AnimatedChartContainer({ children }: PropsWithChildren) {
  return <div className="animated-chart-container">{children}</div>;
}

export function Reveal({ children, delay = 0 }: PropsWithChildren<{ delay?: number }>) {
  return <div className="reveal" style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</div>;
}

export function Stagger({ children, index }: PropsWithChildren<{ index: number }>) {
  return <div className="stagger" style={{ "--stagger-index": index } as CSSProperties}>{children}</div>;
}

export function LiveIndicator({ running }: { running: boolean }) {
  return (
    <span className={`live-indicator ${running ? "is-running" : "is-paused"}`}>
      <i /> {running ? "В РАБОТЕ" : "ПАУЗА"}
    </span>
  );
}

export function SimulationTransition({ active }: { active: boolean }) {
  return (
    <div className={`simulation-transition ${active ? "is-active" : ""}`} aria-hidden="true">
      <i /><i /><i />
    </div>
  );
}
