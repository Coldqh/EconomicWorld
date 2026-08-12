import type { GlobalCommodityDefinition, InputOutputCoefficient, PortNode } from "../domain/model.ts";

export const GLOBAL_COMMODITIES: GlobalCommodityDefinition[] = [
  { id: "crude-oil", name: "Сырая нефть", category: "energy", unit: "тыс. баррелей", linkedGoodId: "energy", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 7_800, storable: true, energyContentBps: 10_000 },
  { id: "natural-gas", name: "Природный газ", category: "energy", unit: "млн м³", linkedGoodId: "energy", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 320, storable: true, energyContentBps: 8_200 },
  { id: "thermal-coal", name: "Энергетический уголь", category: "energy", unit: "тонна", linkedGoodId: "energy", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 12_500, storable: true, energyContentBps: 6_500 },
  { id: "uranium", name: "Уран", category: "energy", unit: "кг", linkedGoodId: "energy", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 8_500, storable: true, energyContentBps: 10_000 },
  { id: "electricity", name: "Электроэнергия", category: "energy", unit: "МВт·ч", linkedGoodId: "energy", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 8_800, storable: false, energyContentBps: 10_000 },
  { id: "iron-ore", name: "Железная руда", category: "metals", unit: "тонна", linkedGoodId: "materials", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 10_500, storable: true, energyContentBps: 0 },
  { id: "steel", name: "Сталь", category: "metals", unit: "тонна", linkedGoodId: "materials", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 65_000, storable: true, energyContentBps: 0 },
  { id: "copper", name: "Медь", category: "metals", unit: "тонна", linkedGoodId: "materials", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 850_000, storable: true, energyContentBps: 0 },
  { id: "aluminium", name: "Алюминий", category: "metals", unit: "тонна", linkedGoodId: "materials", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 230_000, storable: true, energyContentBps: 0 },
  { id: "nickel", name: "Никель", category: "metals", unit: "тонна", linkedGoodId: "materials", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 1_650_000, storable: true, energyContentBps: 0 },
  { id: "wheat", name: "Пшеница", category: "agriculture", unit: "тонна", linkedGoodId: "food", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 24_000, storable: true, energyContentBps: 0 },
  { id: "corn", name: "Кукуруза", category: "agriculture", unit: "тонна", linkedGoodId: "food", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 21_000, storable: true, energyContentBps: 0 },
  { id: "soybeans", name: "Соя", category: "agriculture", unit: "тонна", linkedGoodId: "food", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 47_000, storable: true, energyContentBps: 0 },
  { id: "fertilizers", name: "Удобрения", category: "industrial", unit: "тонна", linkedGoodId: "materials", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 38_000, storable: true, energyContentBps: 0 },
  { id: "chemicals", name: "Химическая продукция", category: "industrial", unit: "индексная единица", linkedGoodId: "materials", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 18_000, storable: true, energyContentBps: 0 },
  { id: "semiconductors", name: "Полупроводники", category: "industrial", unit: "индексная единица", linkedGoodId: "goods", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 42_000, storable: true, energyContentBps: 0 },
  { id: "machinery", name: "Машины и оборудование", category: "industrial", unit: "индексная единица", linkedGoodId: "goods", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 58_000, storable: true, energyContentBps: 0 },
  { id: "vehicles", name: "Автомобили", category: "final", unit: "индексная единица", linkedGoodId: "goods", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 92_000, storable: true, energyContentBps: 0 },
  { id: "consumer-goods", name: "Потребительские товары", category: "final", unit: "индексная единица", linkedGoodId: "goods", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 16_000, storable: true, energyContentBps: 0 },
  { id: "business-services", name: "Деловые услуги", category: "final", unit: "индексная единица", linkedGoodId: "services", benchmarkCurrencyId: "USD", baseSpotPriceMinor: 14_000, storable: false, energyContentBps: 0 },
];

export const INPUT_OUTPUT_COEFFICIENTS: InputOutputCoefficient[] = [
  { outputSectorId: "food", inputCommodityId: "wheat", requiredMilliUnitsPerOutputUnit: 260 },
  { outputSectorId: "food", inputCommodityId: "fertilizers", requiredMilliUnitsPerOutputUnit: 55 },
  { outputSectorId: "materials", inputCommodityId: "iron-ore", requiredMilliUnitsPerOutputUnit: 220 },
  { outputSectorId: "materials", inputCommodityId: "crude-oil", requiredMilliUnitsPerOutputUnit: 45 },
  { outputSectorId: "goods", inputCommodityId: "steel", requiredMilliUnitsPerOutputUnit: 130 },
  { outputSectorId: "goods", inputCommodityId: "copper", requiredMilliUnitsPerOutputUnit: 30 },
  { outputSectorId: "goods", inputCommodityId: "semiconductors", requiredMilliUnitsPerOutputUnit: 85 },
  { outputSectorId: "goods", inputCommodityId: "electricity", requiredMilliUnitsPerOutputUnit: 70 },
  { outputSectorId: "services", inputCommodityId: "electricity", requiredMilliUnitsPerOutputUnit: 28 },
  { outputSectorId: "energy", inputCommodityId: "natural-gas", requiredMilliUnitsPerOutputUnit: 160 },
  { outputSectorId: "energy", inputCommodityId: "thermal-coal", requiredMilliUnitsPerOutputUnit: 90 },
];

export const RESOURCE_ENDOWMENT_INDEX: Record<string, Record<string, number>> = {
  ru: { "crude-oil": 10_000, "natural-gas": 10_000, "thermal-coal": 8_500, nickel: 8_000, wheat: 7_500, fertilizers: 8_500 },
  us: { "crude-oil": 9_000, "natural-gas": 9_500, "thermal-coal": 8_000, corn: 10_000, soybeans: 9_500, copper: 4_500 },
  ca: { "crude-oil": 9_500, "natural-gas": 7_500, uranium: 9_000, wheat: 8_000, nickel: 5_500 },
  de: { "thermal-coal": 3_000, wheat: 3_500 }, fr: { uranium: 1_000, wheat: 5_500 }, gb: { "crude-oil": 3_500, "natural-gas": 3_000 },
  jp: { copper: 700 }, it: { wheat: 1_500 }, es: { copper: 1_000, wheat: 2_000 }, nl: { "natural-gas": 1_500 }, kr: { "thermal-coal": 500 },
};

export const MAJOR_PORTS: PortNode[] = [
  ["ru", "Новороссийск", 760_000], ["de", "Гамбург", 920_000], ["fr", "Марсель-Фос", 780_000], ["gb", "Феликстоу", 850_000],
  ["us", "Лос-Анджелес", 1_300_000], ["jp", "Йокогама", 1_050_000], ["ca", "Ванкувер", 820_000], ["it", "Триест", 720_000],
  ["es", "Валенсия", 780_000], ["nl", "Роттердам", 1_500_000], ["kr", "Пусан", 1_200_000],
].map(([countryId, name, annualCapacityMilliUnits]) => ({ id: `port-${countryId}`, countryId: String(countryId), name: String(name), annualCapacityMilliUnits: Number(annualCapacityMilliUnits), congestionBps: 1_200 }));
