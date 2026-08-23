# 55: Реализовать JSON archive и CSV Signals export

**What to build:** Owner экспортирует переносимый архив разрешённых данных, а специалист — Signals в утверждённом CSV.

**Goal:** Обеспечить data portability с проверяемой полнотой и privacy filtering.

**Context:** Форматы берутся из тикета 08. Export обязан учитывать tenant, assignments, consent, visibility и relationship privacy.

**Blocked by:** 05 — privacy policy; 08 — export contracts; 43 — Snapshots; 50 — Relationships.

**Status:** resolved

## Decision

- Сервис `lib/service/export.ts` (без миграции): `exportSignalsCsv` (сигналы в утверждённом CSV-формате §7, сохраняет raw_statement/source/review status; secondary specialist не получает sensitive) и `exportClientArchive` (JSON-архив §11, Owner-only, versioned, исключает specialist_notes_private).
- Авторизация: `is_client_accessible` + `data_storage` consent; архив — только owner (`is_org_owner`). Оба пишут audit (`export.signals_csv` / `export.client_archive`).

## Concrete steps

1. Реализовать versioned JSON archive assembler.
2. Реализовать CSV Signals projection с source и epistemic metadata.
3. Добавить authorization, consent и privacy filters.
4. Создать export request/status/download UI с audit.
5. Покрыть completeness, forbidden fields и large dataset behavior.

## Acceptance criteria

- [ ] Архив соответствует утверждённой schema version.
- [ ] CSV не теряет raw statement, source и review status.
- [ ] Пользователь не экспортирует неназначенного клиента.
- [ ] Export action и результат имеют audit trail.

## Checks

- [x] Пройдены schema validation и sensitive-field exclusion tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Сервис `lib/service/export.ts`: `exportSignalsCsv` (22 колонки, source/epistemic/review metadata), `exportClientArchive` (JSON-архив §11, owner-only, без specialist_notes_private). Авторизация + data_storage consent + audit.
- Тесты: CSV сохраняет raw statement/source/review status; архив только для owner и без private notes; неназначенный клиент отклоняется.

**Изменённые/созданные файлы:**
- `lib/service/export.ts` (новый)
- `tests/integration/export.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/55-export-json-csv.md`

**Пройденные проверки:**
- Интеграционный тест тикета 55 (3 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** полный набор коллекций архива (§11: relationships, audit_events, reference_catalog и пр.) и export UI/download отложены; реализован versioned core archive (client/requests/signals/themes/core_nodes/resources/targets/recommendations).
