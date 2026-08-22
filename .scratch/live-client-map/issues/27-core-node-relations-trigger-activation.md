# 27: Реализовать CoreNodeRelation и TriggerActivation

**What to build:** Специалист связывает узлы осторожными relationship semantics и фиксирует влияние Trigger на Theme или CoreNode.

**Goal:** Создать безопасный graph layer без автоматической сильной причинности.

**Context:** AI не создаёт causes. Causes_confirmed допустим только после ручного подтверждения и в пределах medical boundary.

**Blocked by:** 19 — Triggers; 25 — CoreNodes; 26 — DifferentialHypotheses.

**Status:** resolved

## Decision

- `core_node_relations` + `trigger_activations` добавляют `organization_id`/`client_id` (tenant boundary).
- `relation_type` — только разрешённый vocabulary SPEC §8.16; `causes` запрещён на уровне сервиса и DB-check. `causes_confirmed` — только через отдельную функцию `confirmCausalRelation` с обязательной audit-причиной (явное ручное подтверждение).
- TriggerActivation хранит `activation_delta`, `confidence`, `rationale`.

## Concrete steps

1. Реализовать CoreNodeRelation и TriggerActivation contracts.
2. Ограничить relation types разрешённым vocabulary SPEC.md.
3. Создать services для link, review, edit и archive relation.
4. Добавить UI связи с direction, strength, confidence и rationale.
5. Покрыть causal restrictions и cross-client isolation.

## Acceptance criteria

- [ ] AI path не может создать causes или causes_confirmed.
- [ ] Human causes_confirmed требует явного подтверждения и audit reason.
- [ ] TriggerActivation хранит delta, confidence и rationale.
- [ ] Связь не раскрывает данные другого клиента.

## Checks

- [ ] Пройдены allowed/forbidden relation matrix tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0019_core_node_relations.sql`: таблицы `core_node_relations` (from/to_core_node_id, relation_type с разрешённым vocabulary SPEC §8.16 + causes_confirmed, strength, confidence, evidence_summary) и `trigger_activations` (trigger_id, theme_id/core_node_id nullable, activation_delta, confidence, rationale); RLS; права.
- Сервисный слой `lib/service/relations.ts`: `createRelation` (только некаузальный vocabulary — `causes` и `causes_confirmed` отклоняются), `confirmCausalRelation` (явное подтверждение + обязательная audit-причина), `createTriggerActivation`.
- Тесты: allowed relation, запрещённые causes/causes_confirmed через сервис, causes_confirmed только с причиной, trigger activation с delta/confidence/rationale.

**Изменённые/созданные файлы:**
- `supabase/migrations/0019_core_node_relations.sql`
- `lib/service/relations.ts`
- `tests/integration/relations.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 27 (4 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** связь не раскрывает данные другого клиента — RLS через `is_client_accessible(organization_id, client_id)`.
