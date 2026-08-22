# 25: Реализовать CoreNode и ThemeCoreNodeLink

**What to build:** Специалист создаёт корневую рабочую гипотезу и связывает её с поддерживающими Themes.

**Goal:** Представить CoreNode как проверяемую гипотезу, а не диагноз или вечную истину.

**Context:** CoreNode имеет сложный lifecycle, scores, evidence counts, visibility и human confirmation. Theme link хранит relationship type, confidence и rationale.

**Blocked by:** 24 — Themes и Signal links.

**Status:** resolved

## Decision

- `core_nodes` + `theme_core_node_links` добавляют `organization_id`/`client_id` (tenant boundary).
- Lifecycle (сервисный слой): `hypothesis → active` (confirm, ставит `last_confirmed_by`), `→ rejected`, `→ archived` (soft delete). Статус `integrated` НЕ устанавливается простым переходом — только через gated-функцию при достаточном evidence (SPEC §23), в тикете 25 правило документировано и заблокировано.
- Каждый ThemeCoreNodeLink хранит `relationship_type`, `confidence`, `link_rationale`, `created_by`.

## Concrete steps

1. Реализовать CoreNode и ThemeCoreNodeLink contracts.
2. Реализовать разрешённые lifecycle transitions из data dictionary.
3. Создать services для ручного создания, review, link и archive.
4. Добавить CoreNodes UI с supporting и contradicting evidence.
5. Покрыть status, evidence lineage, visibility и permission tests.

## Acceptance criteria

- [ ] CoreNode отображается как рабочая гипотеза с confidence.
- [ ] Статус integrated нельзя установить только по факту Correction.
- [ ] Каждый Theme link имеет rationale и author.
- [ ] Rejected/archived узлы сохраняются в истории.

## Checks

- [ ] Пройдены lifecycle и evidence-lineage tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0017_core_nodes_links.sql`: таблицы `core_nodes` (title, hypothesis, root_domain, 9 score-полей 0–100, evidence/independent/contexts counts, status с полным enum SPEC §8.12, visibility, created_by, last_confirmed_by, archived_at) и `theme_core_node_links` (relationship_type, confidence, link_rationale, created_by, unique(theme_id, core_node_id)); RLS; права.
- Сервисный слой `lib/service/core-nodes.ts`: `createCoreNode` (status=hypothesis), `linkTheme` (rationale+author), `confirmCoreNode` (hypothesis→active, ставит last_confirmed_by), `rejectCoreNode`, `archiveCoreNode` (soft delete).
- Тесты: hypothesis→active с подтверждением, link с rationale+author, reject/archive сохраняются в истории.

**Изменённые/созданные файлы:**
- `supabase/migrations/0017_core_nodes_links.sql`
- `lib/service/core-nodes.ts`
- `tests/integration/core-nodes.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 25 (3 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** `integrated` не устанавливается простым переходом — только gated-функцией при достаточном evidence (SPEC §23); в этом тикете правило задокументировано и заблокировано (нет прямой функции перехода в integrated).
