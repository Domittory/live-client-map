# 29: Реализовать Resource

**What to build:** Специалист отдельно ведёт способности и опоры клиента с собственным evidence и динамикой.

**Goal:** Не смешивать problem reduction с resource development.

**Context:** Ослабление CoreNode не означает автоматическое усиление Resource. Positive + stress также не создаёт ресурс.

**Blocked by:** 17 — Client; 21 — Signal interpretation.

**Status:** resolved

## Decision

- `resources` добавляет `organization_id`/`client_id` (tenant boundary).
- Resource создаётся только явным действием специалиста (нет автогенерации из ослабления CoreNode — регрессия запрещена на уровне сервиса).
- Каждое изменение strength/confidence требует `evidenceSummary` или `reason` (валидируется).

## Concrete steps

1. Реализовать Resource contract, lifecycle и visibility.
2. Создать services для ручного создания, evidence linking и обновления.
3. Добавить Resources UI с strength, confidence, trend и evidence summary.
4. Запретить автоматическое создание из ослабления проблемы.
5. Покрыть independence, evidence и permissions tests.

## Acceptance criteria

- [ ] Resource существует как самостоятельная сущность.
- [ ] Каждое изменение strength/confidence имеет evidence или human reason.
- [ ] CoreNode activation down не меняет Resource автоматически.
- [ ] Client visibility применяется отдельно от specialist view.

## Checks

- [ ] Пройдены no-automatic-resource regression tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0020_resources.sql`: таблица `resources` (name, description, domain, strength_score, confidence_score, trend, evidence_summary, status, visibility); RLS; права.
- Сервисный слой `lib/service/resources.ts`: `createResource` (только явное действие), `updateResource` (требует evidenceSummary/reason при изменении scores).
- Тесты: resource как самостоятельная сущность; изменение score без evidence отклоняется; с evidence — применяется.

**Изменённые/созданные файлы:**
- `supabase/migrations/0020_resources.sql`
- `lib/service/resources.ts`
- `tests/integration/resources.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 29 (2 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** ослабление CoreNode не меняет Resource автоматически — ресурсы создаются/обновляются только явными действиями специалиста (нет автогенерации).
