import type { SkillId } from "../domain/model.ts";

export interface AcademyLesson {
  id: string;
  title: string;
  summary: string;
  terms: Array<{ ru: string; en: string }>;
  lab: "balance" | "leverage" | "inflation" | "credit";
}

export interface AcademyCourse {
  id: string;
  title: string;
  durationMonths: number;
  costCents: number;
  prerequisiteCourseIds: string[];
  skillGains: Partial<Record<SkillId, number>>;
  lessons: AcademyLesson[];
}

export const ACADEMY_COURSES: AcademyCourse[] = [
  {
    id: "accounting-basics",
    title: "Основы бухгалтерии",
    durationMonths: 3,
    costCents: 18_000_00,
    prerequisiteCourseIds: [],
    skillGains: { accounting: 900, finance: 250 },
    lessons: [
      { id: "balance-equation", title: "Активы, обязательства и капитал", summary: "Баланс показывает ресурсы, требования кредиторов и остаток владельцев.", terms: [{ ru: "Актив", en: "Asset" }, { ru: "Обязательство", en: "Liability" }, { ru: "Капитал", en: "Equity" }], lab: "balance" },
      { id: "profit-cash", title: "Выручка, прибыль и денежный поток", summary: "Прибыль возникает по методу начисления и не равна изменению денег на счёте.", terms: [{ ru: "Выручка", en: "Revenue" }, { ru: "Денежный поток", en: "Cash Flow" }], lab: "leverage" },
    ],
  },
  {
    id: "macro-basics",
    title: "ВВП и инфляция",
    durationMonths: 3,
    costCents: 15_000_00,
    prerequisiteCourseIds: [],
    skillGains: { economics: 850, statistics: 350 },
    lessons: [
      { id: "gdp", title: "ВВП без двойного счёта", summary: "Добавленная стоимость исключает повторный учёт промежуточных товаров.", terms: [{ ru: "Валовой внутренний продукт", en: "GDP" }, { ru: "Добавленная стоимость", en: "Value Added" }], lab: "balance" },
      { id: "inflation", title: "Инфляция и ИПЦ", summary: "ИПЦ сравнивает стоимость потребительской корзины и показывает вклад категорий.", terms: [{ ru: "Индекс потребительских цен", en: "CPI" }, { ru: "Вклад", en: "Contribution" }], lab: "inflation" },
    ],
  },
  {
    id: "banking-credit",
    title: "Банки, депозиты и кредит",
    durationMonths: 4,
    costCents: 24_000_00,
    prerequisiteCourseIds: ["accounting-basics"],
    skillGains: { finance: 1_050, accounting: 300 },
    lessons: [
      { id: "loan-creation", title: "Как кредит создаёт депозит", summary: "У банка появляется кредитный актив, а у заёмщика — депозит и долг.", terms: [{ ru: "Основная сумма долга", en: "Principal" }, { ru: "Резервы", en: "Reserves" }], lab: "credit" },
      { id: "interest-rate", title: "Процентные ставки", summary: "Ставка соединяет цену фондирования, риск и денежную политику.", terms: [{ ru: "Ключевая ставка", en: "Policy Rate" }, { ru: "Кредитное плечо", en: "Leverage" }], lab: "leverage" },
    ],
  },
  {
    id: "data-analysis",
    title: "Анализ экономических данных",
    durationMonths: 5,
    costCents: 32_000_00,
    prerequisiteCourseIds: ["macro-basics"],
    skillGains: { statistics: 750, dataAnalysis: 1_100, programming: 450 },
    lessons: [
      { id: "real-nominal", title: "Номинальные и реальные показатели", summary: "Дефлятор отделяет изменение цен от изменения физических объёмов.", terms: [{ ru: "Дефлятор ВВП", en: "GDP Deflator" }, { ru: "Реальный ВВП", en: "Real GDP" }], lab: "inflation" },
      { id: "risk-data", title: "Данные, риск и кредит", summary: "Денежный поток и долговая нагрузка ограничивают доступный кредит.", terms: [{ ru: "Андеррайтинг", en: "Underwriting" }], lab: "credit" },
    ],
  },
];
