# 14: Закрыть пробелы BehavioralMarker и ModelChange

**What to build:** Исправить сохранение Theme-link у BehavioralMarker и дополнить version-bounded model-change read model, чтобы Specialist видел новые DifferentialHypotheses и contradictions между версиями без изменения состава PsychologicalSnapshot.

**Blocked by:** 06/Сделать мутации психологической модели атомарными; 07/Сделать Corrections, observations и model history атомарными; 12/Добавить review workflow для Themes, CoreNodes и DifferentialHypotheses.

**Status:** resolved

- [x] Public service input обновляет Theme-link через правильное database column mapping.
- [x] Regression test читает сохранённую связь и AuditLog через public service boundary.
- [x] Сравнение двух snapshot versions показывает созданные в интервале DifferentialHypotheses и contradictions.
- [x] Read model не добавляет новые snapshot categories и не фабрикует historical state.
- [x] UI связывает изменения с Evidence Trail и явно сообщает недостаток данных.

## Implementation result

### 1. Theme-link BehavioralMarker: public service → database column

Историческая причина дефекта: `updateMarker` собирал patch с camelCase-ключом
`patch.linkedThemeId`, тогда как колонка таблицы `behavioral_markers` называется
`linked_theme_id`. Такой ключ не проходит проверку допустимых полей внутри
`update_behavioral_marker` (migration 0043) и не является колонкой таблицы,
поэтому обновление Theme-link падало и связь не сохранялась. Маппинг был
исправлен в коммите `dfb097a` (тикет 07): `lib/service/observations.ts:604`
теперь пишет `patch.linked_theme_id = input.linkedThemeId`; публичный
camelCase-вход (`linkedThemeId`) не менялся.

В текущем HEAD маппинг корректен и в сервисе, и в RPC (проверено также по
живой функции в локальной БД), поэтому отдельного production-изменения не
потребовалось. Добавлен недостающий regression-тест, который фиксирует именно
этот дефект: на коде до `dfb097a` RPC отклоняет неизвестное поле
`linkedThemeId`, и тест падает.

Regression test: `tests/integration/observations.integration.test.ts` →
«updates a BehavioralMarker Theme link through the public service boundary».
Через публичный сервис проверяется:
- создаётся маркер со ссылкой на CoreNode; `updateMarker({ linkedThemeId })`
  и `getMarker` возвращают сохранённую связь `linked_theme_id`;
- AuditLog читается публичным `listAuditLog` (владелец организации): одна
  запись `behavioral_marker.update` с актором-специалистом;
- очистка связи (`linkedThemeId: null`) — реальное обновление, а тема чужого
  клиента отклоняется и не меняет сохранённую связь.

### 2. Version-bounded model-change read model

- `lib/service/model-changes.ts`: новый `listModelIntervalChanges` и тип
  `ModelIntervalChanges`. Интервал `(from, to]`, где `from` — `generated_at`
  предыдущего snapshot, `to` — `generated_at` сравниваемого. Возвращает
  ModelChanges, DifferentialHypotheses и связи-противоречия
  (`core_node_relations.relation_type = 'contradicts'`), созданные строго
  внутри интервала по собственному `created_at` / `occurred_at`.
- `lib/service/snapshots.ts`: `compareWithPrevious` дополнен полем `interval`
  (`null` для первой версии). `SNAPSHOT_CATEGORIES` не менялись, новые
  категории не добавлялись, историческое состояние не фабрикуется: строки
  старше `from` и новее `to` в выборку не попадают.
- `lib/service/model-change-presentation.ts`: чистые правила —
  `evidenceTrailHref` (ссылка на Evidence Trail только для `core_node`,
  `theme`, `differential_hypothesis`) и `intervalDataLimits` (явные
  формулировки «Недостаточно данных», гарантия «задним числом не
  восстанавливается» и оговорка, что отдельные противоречащие доказательства
  внутри гипотезы не имеют собственной метки времени и не ограничены
  интервалом версий).

### 3. UI

`app/snapshots/page.tsx` — существующий экран изменений модели расширен, а не
продублирован:
- блок «Изменения модели между версиями»: новые DifferentialHypotheses,
  противоречия и ModelChanges; каждый пункт ведёт в Evidence Trail, а для типов
  без Evidence Trail показано явное «Недостаточно данных»;
- список «История изменений модели (ModelChanges)» тоже ведёт в Evidence Trail;
- первая версия и пустой интервал показывают явное «Недостаточно данных»;
- «Ограничения данных интервала» выводят `interval.limits`.

### Файлы

- `lib/service/model-change-presentation.ts` (новый)
- `lib/service/model-changes.ts`
- `lib/service/snapshots.ts`
- `app/snapshots/page.tsx`
- `tests/unit/model-change-presentation.unit.test.ts` (новый, 7 тестов)
- `tests/integration/observations.integration.test.ts` (+1 тест)
- `tests/integration/snapshots.integration.test.ts` (+2 теста)
- `e2e/snapshots.spec.ts` (новый, 1 тест)

### Проверки

- `pnpm typecheck` — ok
- `pnpm lint` — ok
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 98 файлов / 692 теста passed
- `pnpm test:e2e` — 24 теста passed (включая новый `e2e/snapshots.spec.ts`)

### Замечание для ведущего

Пункт 1 формально уже был закрыт тикетом 07 (`dfb097a`): и сервис, и RPC
`update_behavioral_marker` в текущем HEAD используют `linked_theme_id`.
Отдельного production-изменения не потребовалось; добавлен только
regression-тест, которого не хватало. Отдельного фикса в
`lib/service/observations.ts` проверять нечего: строка 604 уже пишет
`patch.linked_theme_id`. Дополнительно можно усилить audit-payload
`update_behavioral_marker` (сейчас `before`/`after` не содержат link-колонок) —
это выходит за рамки тикета и не делалось.

## Ревью ведущего

- **Маппинг Theme-link подтверждён**: публичный вход остался camelCase
  (`linkedThemeId`), а в базу пишется `linked_theme_id` (`lib/service/observations.ts`,
  `patch.linked_theme_id`) — те самые «public input camel-case, database payload
  schema column names» из spec. Дефект был устранён ещё в тикете 07 вместе с
  переводом обновления маркера на атомарный RPC; в этом тикете добавлен
  отсутствовавший regression-тест через public service boundary (сохранённая
  связь + audit), который на старом коде падал бы.
- **Историчность не фабрикуется**: состав `SNAPSHOT_CATEGORIES` не изменён
  (в диффе нет ни одной строки с CATEGOR), новые категории не добавлялись,
  интервал строится по существующим ModelChange/гипотезам/связям
  `contradicts` в окне `(from, to]`; ограничения (нет метки времени у отдельных
  `evidence_against`, первая версия без предыдущей) выводятся явным
  «Недостаточно данных», а не додумываются.
- **Прогоны**: полный набор 98 файлов / 692 теста — зелёный; `pnpm test:e2e` —
  **24 теста** (1 новый snapshots + 23 прежних); `pnpm typecheck`, `pnpm lint` —
  зелёные.
- **Остаточное замечание**: audit-payload `update_behavioral_marker` содержит
  только name/marker_type/scale и не содержит link-колонок. На сохранение связи
  это не влияет (связь проверяется напрямую и покрыта тестом), но если нужен
  полный before/after по ссылке в аудите — это отдельное небольшое изменение RPC.
