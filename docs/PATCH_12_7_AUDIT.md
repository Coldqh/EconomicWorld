# Patch 12.7 — аудит размерности потоков

Статус: gate не пройден. Phase 13/14 не начаты.

## Найденная первопричина

Текущий страновой GDP в `collectCountryMetrics` смешивает текущую активность explicit companies с сохранёнными при инициализации компонентами `CountryScaleReconciliation`. Государственный бюджет при этом строится из ledger-транзакций только текущего месяца. Глобальный `NationalAccountsState` не имеет странового разреза и учитывает преимущественно explicit companies.

До исправлений cohort wage demand вычислялся как `population × city wage`: для США около 28 квадриллионов денежных единиц в месяц при baseline GDP около 232 триллионов. Затем выплата ограничивалась депозитом случайно сопоставленного firm cohort, поэтому реально собираемые налоги были почти нулевыми.

На 60-м месяце до нормализации США имели около 240,7 трлн monthly GDP, 1,2 млрд revenue и 11,4 трлн interest spending. Япония — 56,1 трлн GDP, 0,86 млрд revenue и 10,0 трлн interest.

## Выполненные эксперименты

- Wage pool нормализован от фактической cohort value added и распределяется по household weights.
- Cohort income, consumption и taxes переведены на месячный период.
- Baseline spending share удалён из post-initialization borrowing target.
- New sovereign yield больше не содержит почти линейную двойную премию за stock Debt/GDP.

После этого cohort taxes стали макромасштабными, но единого national-accounts периода всё ещё нет. В 20-летнем диагностическом прогоне США остаются около 221% Debt/GDP, Япония около 370% и получает 16 defaulted issues. Runtime около 65 секунд.

## Архитектурный blocker

Для прохождения gate требуется атомарно заменить:

1. глобальный `NationalAccountsState` на страновые flow accumulators;
2. baseline-смесь в `collectCountryMetrics` на GDP текущего периода;
3. government purchases на расходы из того же странового периода;
4. fiscal cash/debt bridges на opening/flows/closing identities;
5. cohort/explicit overlap на документированные representation weights.

Локальная калибровка ставок, налогов или Debt/GDP скрыла бы ошибку и не считается исправлением.
