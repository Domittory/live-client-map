# 45: Собрать Client Overview

**What to build:** Специалист открывает клиента и сразу видит его текущий запрос, ключевые элементы модели, последние изменения и следующий шаг.

**Goal:** Создать основной рабочий экран без необходимости обходить все разделы.

**Context:** Overview агрегирует данные, но не создаёт новую психологическую интерпретацию.

**Blocked by:** 18 — Requests; 19 — Triggers; 29 — Resources; 30 — DevelopmentTargets; 37 — Recommendations; 43 — Snapshots.

**Status:** resolved

## Decision

- Read-модель без миграции: `lib/service/overview.ts` → `getClientOverview(organizationId, clientId)` агрегирует существующие таблицы (client_requests, core_nodes, resources, development_targets, triggers, corrections, model_changes, recommendations, signals/themes) и ничего не создаёт — overview не генерирует новую психологическую интерпретацию.
- «Top items» ранжируются детерминированно: CoreNode через `coreNodePriorityScore` (versioned formula тикета 28 из сохранённых component scores), Resources по strength→confidence, Recommendation по сохранённому `final_priority_score`.
- Privacy: запросы фильтруют archived/rejected узлы; client-facing вариант с visibility-фильтром вынесен за рамки этого тикета (относится к тикету 51/56) — здесь specialist-обзор, RLS ограничивает по assignment.

## Concrete steps

1. Создать read service для overview с assignment и visibility.
2. Показать active request, top CoreNodes/Resources, targets и recent Trigger.
3. Показать last Correction, latest changes, next Recommendation и pending review.
4. Реализовать empty, loading, stale и error states.
5. Добавить aggregate contract и UI tests.

## Acceptance criteria

- [ ] Overview содержит все элементы раздела 38 SPEC.md.
- [ ] Top items используют сохранённый versioned ranking.
- [ ] Hidden/private данные не попадают в client-facing variants.
- [ ] Каждый блок ведёт к детальному evidence-aware экрану.

## Checks

- [x] Пройдены populated, partial и empty-client smoke tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Сервис `lib/service/overview.ts`: `getClientOverview` (active request, top CoreNodes/Resources, development targets, recent triggers, last correction, latest model changes, next recommendation, pending review count) + чистый `coreNodePriorityScore` (versioned ranking через scoring.ts).
- UI `app/clients/[id]/page.tsx`: блоки обзора с empty-состояниями и ссылкой на детальный экран запросов.
- Тесты: unit (ranking formula + missing-data → null) + integration (empty client → пустые блоки; populated → active request, ranked core node 79.2, pending count).

**Изменённые/созданные файлы:**
- `lib/service/overview.ts` (новый)
- `app/clients/[id]/page.tsx` (обновлён)
- `tests/unit/overview.unit.test.ts` (новый)
- `tests/integration/overview.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/45-client-overview.md`

**Пройденные проверки:**
- Unit (2 шт.) + integration (2 шт.) — pass.
- `eslint`, `prettier` на файлах тикета — pass.
- `pnpm typecheck` — полностью чист (включая ранее падавший `ai-cluster.ts:137`, который уже исправлен другим агентом).

**Note:** «что изменилось» отдаёт последние `model_changes` (SPEC §8.31); при желании можно дополнить diff из последнего snapshot (`changes_since_previous`). Детальные evidence-aware экраны (core-nodes/resources/…) реализуются в тикетах 46–49.
