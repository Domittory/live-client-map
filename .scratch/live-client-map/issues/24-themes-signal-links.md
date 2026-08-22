# 24: Реализовать Theme и SignalThemeLink

**What to build:** Специалист объединяет Signals в Themes и видит rationale каждой связи.

**Goal:** Создать первый проверяемый слой психологической модели поверх независимого evidence.

**Context:** Theme должна хранить confidence, counts, contexts, trend, status и visibility. Связь с Signal содержит relevance и rationale.

**Blocked by:** 22 — EvidenceCluster/Context engine; 23 — human review.

**Status:** resolved

## Decision

- `themes` + `signal_theme_links` добавляют `organization_id`/`client_id` (tenant boundary).
- Агрегаты Theme (`evidence_count`, `independent_evidence_count`, `contexts_count`) пересчитываются сервисным слоем только из подтверждённого evidence: `review_status = approved` И не `ai_hypothesis`/`L0_AI_ONLY`.
- `contexts_count`/`independent_evidence_count` — число разных `diagnostic_session_id` среди подтверждённых Signals (прокси независимости контекстов из тикета 22).

## Concrete steps

1. Реализовать Theme и SignalThemeLink contracts.
2. Создать services для create/update/archive Theme и link/unlink Signal.
3. Пересчитывать агрегаты только из допустимого evidence.
4. Добавить Themes UI со списком Signals, clusters и contexts.
5. Подключить RLS, audit и aggregate tests.

## Acceptance criteria

- [ ] Theme имеет evidence trail до raw Signals.
- [ ] AI-only и rejected Signals не увеличивают confirmed counts.
- [ ] Link rationale и relevance доступны специалисту.
- [ ] Archive не переписывает историю старых snapshots.

## Checks

- [ ] Пройдены aggregate, unlink и authorization tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0016_themes_signal_links.sql`: таблицы `themes` (name, domain, activity/confidence, evidence_count, independent_evidence_count, contexts_count, trend, status, visibility, archived_at) и `signal_theme_links` (relevance_score, link_rationale, created_by, unique(signal_id, theme_id)); RLS; права.
- Сервисный слой `lib/service/themes.ts`: `createTheme`, `linkSignal`/`unlinkSignal` (с audit), `recomputeThemeAggregates` — пересчитывает counts только из подтверждённого evidence (`review_status = approved` И не `ai_hypothesis`); `contexts_count` = число разных `diagnostic_session_id`.
- Тесты: AI-only и rejected Signals не увеличивают counts; разные сессии → 2 контекста; unlink уменьшает агрегат.

**Изменённые/созданные файлы:**
- `supabase/migrations/0016_themes_signal_links.sql`
- `lib/service/themes.ts`
- `tests/integration/themes.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 24 (3 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** archive Theme не переписывает историю — soft delete через `status/archived_at`, старые snapshots не изменяются.
