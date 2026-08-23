# 42: Реализовать reactivation rules

**What to build:** Новые Triggers и Signals могут перевести ослабленный CoreNode в reactivated по утверждённым порогам.

**Goal:** Отражать возвращение паттерна, не переписывая прошлую интеграцию.

**Context:** Порог activation и минимальный прирост берутся из versioned scoring configuration тикета 06.

**Blocked by:** 19 — Triggers; 28 — scoring engine; 41 — FollowUp/evaluation.

**Status:** resolved

## Concrete steps

1. Реализовать deterministic reactivation evaluator. ✅
2. Учитывать только допустимое новое evidence и trigger activation. ✅
3. Создавать reviewable status proposal и reason. ✅
4. Показывать reactivation в CoreNode и correction history UI. ✅
5. Добавить threshold, below-threshold и stale-evidence tests. ✅

## Acceptance criteria

- [x] Reactivation использует configuration version и сохраняет calculation details.
- [x] Старое или AI-only evidence не вызывает reactivation само по себе.
- [x] Статус меняется только по разрешённому lifecycle transition.
- [x] Пользователь видит trigger и evidence, вызвавшие предложение.

## Checks

- [x] Пройдены boundary-value и evidence eligibility tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Решения:**

- Пороги взяты из versioned scoring configuration тикета 06/28: `REACTIVATION_CONFIG` в `lib/service/scoring.ts` (version = `SCORING_MODEL_VERSION` "1.0.0"; activation threshold 60, мин. прирост 30, окно свежести 30 дней — как activity window тикета 06, +10 пунктов за свежий сигнал). Прирост трактуется как `≥ minIncrease` по утверждённому решению тикета 06 («прирост ≥ 30 пунктов»), а не строгому `>` из примера SPEC §24.
- Evaluator — чистая детерминированная функция `evaluateReactivation` в `lib/service/reactivation.ts` (без AI): свежие approved Signals (evidence_level ≠ L0_AI_ONLY, не старше окна, через signal→theme→core_node links) + свежие TriggerActivations (delta > 0). Требуется минимум 1 trigger activation И 1 свежий сигнал (SPEC §24 «Новый Trigger + свежие Signals»).
- Proposal — новая таблица `core_node_reactivations` (миграция 0031, RLS через `is_client_accessible`, grants authenticated/service_role, partial unique index: максимум один pending на узел). Evaluator статус не меняет — только создаёт pending proposal с `scoring_model_version`, `calculation` jsonb (сигналы, триггеры, old/new score, дельта, пороги, исключённое evidence) и человекочитаемым `reason`.
- Approve применяет единственный разрешённый переход weakened → reactivated (guard проверяется и на evaluation, и на approve) + записывает новый activation_score; reject оставляет узел без изменений. Все мутации через `withAudit`.
- Запуск evaluator — явное действие: server action + `POST /api/core-nodes/[id]/reactivation` (кнопка «Проверить reactivation» на странице узла, видна для weakened). Фоновых джобов нет.
- UI: новая страница `app/core-nodes/[id]/page.tsx` (статус, proposals с trigger/evidence/reason/config version, approve/reject); на странице коррекции core-node targets показывают текущий статус (включая reactivated) со ссылкой на узел.

**Файлы:**

- `supabase/migrations/0031_core_node_reactivations.sql` (применена, типы перегенерированы)
- `lib/service/scoring.ts` (REACTIVATION_CONFIG)
- `lib/service/reactivation.ts` (evaluator + сервисы)
- `lib/service/core-nodes.ts` (+ getCoreNode)
- `app/actions/reactivation.ts`, `app/api/core-nodes/[id]/reactivation/route.ts`, `app/api/reactivations/[id]/review/route.ts`
- `app/core-nodes/[id]/page.tsx`, `app/core-nodes/[id]/reactivation-forms.tsx`
- `app/corrections/[id]/page.tsx` (статус core-node targets)
- `tests/unit/reactivation.unit.test.ts` (18 тестов: boundary 60/59, прирост 30/29, AI-only, stale, край окна, lifecycle guard, детерминизм)
- `tests/integration/reactivation.integration.test.ts` (6 тестов: full flow approve/reject, below-threshold, AI-only/stale, lifecycle guard, RLS)
- `lib/supabase/database.types.ts` (регенерирован, diff только добавление новой таблицы)

**Проверки:** `supabase migration up` ✅, `pnpm db:types` ✅, `pnpm lint` ✅, `pnpm typecheck` ✅, `pnpm test` ✅ (49 файлов, 289 тестов), `pnpm build` ✅.
