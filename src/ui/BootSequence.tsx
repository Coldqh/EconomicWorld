import { useEffect, useState } from "react";
import { useReducedMotion } from "./motion.tsx";

const PHASES = [
  "ЗАПУСК ОБЩЕГО РЕЕСТРА",
  "СОЗДАНИЕ ДОМОХОЗЯЙСТВ",
  "СОЗДАНИЕ КОМПАНИЙ",
  "ЗАПУСК БАНКОВ",
  "НАСТРОЙКА ПЛАТЕЖЕЙ",
  "ФОРМИРОВАНИЕ РЫНКОВ",
  "ПРОВЕРКА БАЛАНСОВ",
  "ЭКОНОМИКА ГОТОВА",
];

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (reduced) {
      onComplete();
      return;
    }
    const timer = window.setInterval(() => {
      setPhase((current) => {
        if (current >= PHASES.length - 1) {
          window.clearInterval(timer);
          window.setTimeout(onComplete, 420);
          return current;
        }
        return current + 1;
      });
    }, 290);
    return () => window.clearInterval(timer);
  }, [onComplete, reduced]);

  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <div className="boot-core">
        <div className="boot-ident"><span>EW</span><strong>ECONOMIC WORLD</strong></div>
        <div className="boot-sequence">
          {PHASES.map((item, index) => (
            <div key={item} className={index < phase ? "is-done" : index === phase ? "is-active" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span><b>{item}</b><i>{index < phase ? "ДА" : index === phase ? "•••" : "—"}</i>
            </div>
          ))}
        </div>
        <div className="boot-progress"><i style={{ width: `${((phase + 1) / PHASES.length) * 100}%` }} /></div>
        <button onClick={onComplete}>ПРОПУСТИТЬ</button>
      </div>
    </div>
  );
}
