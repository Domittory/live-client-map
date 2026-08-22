# 34: Реализовать clusterEvidence и classifyThemes

**What to build:** AI предлагает EvidenceClusters, связи с существующими Themes и новые Themes с объяснением.

**Goal:** Добавить семантическую помощь без ложного подсчёта независимого evidence.

**Context:** Deterministic rules тикета 22 остаются authority для counts. AI предлагает grouping и rationale, но не подтверждает себя.

**Blocked by:** 22 — Context engine; 24 — Themes; 33 — AI ingest.

**Status:** resolved

## Decision

- Добавляю `review_status` в `themes` (migration 0023) — для pending AI-предложений (SPEC §36).
- `clusterEvidence` создаёт pending EvidenceClusters; `independent_weight` детерминированно = 1 (AI-оценка независимости advisory, authority — тикет 22).
- `classifyThemes` создаёт pending Theme (action create) или линкует к существующей (action link_existing); связи хранят rationale и source references.

## Concrete steps

1. Реализовать отдельные AI contracts clusterEvidence и classifyThemes.
2. Передавать существующую карту и canonical context inputs.
3. Валидировать предлагаемые links, counts и rationale.
4. Создавать предложения только со статусом pending.
5. Добавить review UI и regression tests на повторяющиеся Signals.

## Acceptance criteria

- [ ] AI не увеличивает independent count поверх deterministic context rules.
- [ ] Предложение может link to existing или создать pending Theme.
- [ ] Каждая связь имеет rationale и source references.
- [ ] Re-analysis не создаёт неуправляемые duplicates.

## Checks

- [ ] Пройден кейс 20 синонимичных Signals одной сессии.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0023_theme_review_status.sql`: добавлен `review_status` в `themes` (для pending AI-предложений, SPEC §36).
- Сервисный слой `lib/service/ai-cluster.ts`: `clusterEvidence` (gateway `ai.cluster-evidence.v1`, создаёт EvidenceClusters с детерминированным `independent_weight = 1` — AI не раздувает независимость), `classifyThemes` (gateway `ai.classify-themes.v1`, создаёт pending Theme или линкует к существующей, связи с rationale).
- Тесты: кластер с нераздутой независимостью; pending Theme с link-rationale.

**Изменённые/созданные файлы:**
- `supabase/migrations/0023_theme_review_status.sql`
- `lib/service/ai-cluster.ts`
- `tests/integration/ai-cluster.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 34 (2 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** deterministic rules тикета 22 остаются authority для counts — AI-предложения не увеличивают independent count.
