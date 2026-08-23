# 49: Реализовать Dynamics и History UI

**What to build:** Специалист сравнивает версии модели и видит хронологию диагностик, коррекций и объяснённых изменений.

**Goal:** Дать проверяемый ответ на вопрос «что изменилось с прошлого раза».

**Context:** Экран использует immutable snapshots, ModelChange и approved explanations; он не пересчитывает историю на клиенте.

**Blocked by:** 43 — ModelChange/Snapshots; 44 — explainModelChanges.

**Status:** resolved

## Concrete steps

1. Создать timeline read model для sessions, corrections, follow-ups и ModelChanges.
2. Реализовать snapshot comparison before/after.
3. Показать strengthened, weakened, new, contradicted и priority changes.
4. Добавить navigation к evidence и source event.
5. Покрыть ordering, historical immutability и UI states.

## Acceptance criteria

- [x] Экран покрывает список изменений раздела 26 SPEC.md.
- [x] Before/after значения совпадают с сохранёнными snapshots.
- [x] Historical explanation сохраняет использованные versions.
- [x] Пустая история отображается без ложных выводов.

## Checks

- [x] Пройдены chronological ordering и snapshot diff tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

- `lib/service/dynamics.ts` — read model (только чтение, без audit):
  - `getClientTimeline(client, { organizationId, clientId })` — объединённая
    хронология diagnostic sessions, corrections, follow-ups, ModelChanges и
    snapshot-версий из существующих таблиц под RLS (is_client_accessible);
    история не пересчитывается. Сортировка по времени события, детерминированный
    tie-break (тип события → source id). Каждое событие несёт `sourceId`,
    `sourceRoute` (коррекция → `/corrections/[id]`, follow-up → страница его
    коррекции, snapshot → `/snapshots?...`, model change на core_node →
    `/core-nodes/[id]`) и `evidenceRoute` на evidence drawer для
    evidence-backed entity types (core_node/theme/differential_hypothesis).
    Чистая функция `buildTimeline` вынесена для unit-тестов.
  - `compareSnapshotVersions(client, { fromSnapshotId, toSnapshotId })` —
    before/after сравнение двух сохранённых версий одного клиента детерминированным
    `diffSnapshots` из ticket 43; валидация (разные клиенты, порядок версий) —
    `VALIDATION_ERROR`.
- `app/dynamics/page.tsx` — экран: хронология событий со ссылками на источник и
  evidence; выбор двух версий snapshot и блок SPEC §26 «Что изменилось в модели?»
  (усилилось/ослабло — score movements из diff; новые Themes/CoreNodes; ослабшие
  узлы; приоритет коррекций — recommendations diff; DifferentialHypotheses и
  противоречия явно помечены «нет данных», т.к. не входят в snapshot-категории
  SPEC §25); approved explanations с version metadata (scoring/ontology/ai/prompt
  versions, before/after snapshot refs). Честные empty states без выводов при
  отсутствии истории или при < 2 snapshots.
- `app/page.tsx` — добавлена ссылка «Dynamics и история».
- Тесты: `tests/unit/dynamics.unit.test.ts` (6 шт.: ordering, tie-break,
  маппинг типов/маршрутов, performed_at/scheduled_at, evidence routes,
  empty state) и `tests/integration/dynamics.integration.test.ts` (6 шт.:
  пустой timeline; объединение session+correction+follow-up+model change+snapshot
  в хронологическом порядке; before/after совпадает с сохранёнными snapshots и
  diff равен stored `changes_since_previous`; rejected invalid comparison;
  approved explanation сохраняет versions; RLS чужой организации).
- Новых миграций не потребовалось — read model читает существующие таблицы.
- Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — зелёные.
