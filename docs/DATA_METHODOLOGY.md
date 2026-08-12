# Методология реальных данных

## Поля provenance

Каждый наблюдаемый показатель обязан иметь `source`, `sourceUrl`, `sourceDate`, `referenceYear`, `unit`, `currency`, `frequency`, `methodology`, `sourceType`. Допустимые типы: `REAL_DATA`, `CALIBRATED`, `ESTIMATED`, `SYNTHETIC_FALLBACK`. Значение без известного источника нельзя публиковать как `REAL_DATA`.

## Нормализация

- денежные значения World Bank хранятся в текущих USD и при инициализации переводятся в minor units;
- проценты переводятся в basis points;
- физические товары используют `milliUnits`, заданные taxonomy;
- baseline фиксирует дату и год, поэтому обновление источника требует новой версии pack;
- сетевые запросы не выполняются в runtime приложения.

## Валидация

История не воспроизводится скриптом. Симуляция стартует из baseline и сравнивается с отложенными наблюдениями. Внешние шоки допустимы только как явно помеченный validation input. Параметры отделены от observables; validation series не используются для подбора training parameters.
