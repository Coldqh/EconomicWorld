# Patch 12.6 — промежуточный отчёт

Статус: gate не пройден; Phase 13 и Phase 14 не начаты.

## Реализовано

- Схема сохранения 10 и миграция миров 0.12.5/schema 9 без сброса сущностей и позиций.
- Полный lifecycle трансграничного кредита: проценты, principal, maturity, rollover, arrears и default.
- Проценты иностранного кредита входят в primary income BOP; principal меняет financial account и IIP.
- Domestic trade finance исключён из внешнего долга.
- Международное кредитование использует score и prudential exposure вместо `activePairLoans < 2`.
- Defaulted sovereign claim остаётся в gross public debt; arrears сохраняются отдельно.
- Haircut создаёт зеркальные изменения актива держателя и обязательства правительства.
- Удалено заимствование ради возврата к историческому Debt/GDP после инициализации.
- Legacy coupon отделён от marginal yield; initial maturity зависит от странового среднего срока.
- REAL_WORLD commodity composition хранится в country packs; hash/modulo allocation удалён.
- Population/firm cohorts создают агрегированные реальные налоговые платежи в REAL_WORLD.

## Gate

Прошли: default/debt semantics, legacy coupon, maturity calibration, cross-border lifecycle, BOP warning check, domestic trade-credit separation, data-driven trade composition, save size.

Не прошли:

- 20 лет: 55,2 с против цели ≤40 с или улучшения ≥30% относительно 58,3 с.
- Fiscal/GDP scale остаётся несогласованным на длинном горизонте: США 405% Debt/GDP, Япония 982%.
- Main bundle 730,5 КБ; lazy UI split ещё не выполнен.

Последний benchmark: 1 год — 2,3 с / 10,7 МБ; 5 лет — 11,7 с / 16,7 МБ; 20 лет — 55,2 с / 27,2 МБ. Heap после 20-летнего прогона — 179 МБ; наблюдавшийся промежуточный heap — 251 МБ.

Phase 13/14 нельзя добавлять до перестройки единого macro-scale контура GDP, cohort flows, government spending и fiscal reconciliation.
