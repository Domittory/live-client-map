# 41: Реализовать FollowUp и evaluateCorrection

**What to build:** Специалист планирует follow-up, собирает retest и feedback и получает проверяемую оценку эффекта Correction.

**Goal:** Замкнуть цикл коррекции реальными данными после вмешательства.

**Context:** Оценка учитывает retest, observations, behavioral markers, client и specialist feedback, а также изменения по контекстам.

**Blocked by:** 32 — AI gateway; 40 — Observations и BehavioralMarkers.

**Status:** resolved

## Concrete steps

1. Реализовать FollowUp contract и scheduling lifecycle.
2. Создать UI заполнения результатов и feedback.
3. Реализовать evaluateCorrection как отдельный AI contract.
4. Сформировать pending assessment и human approval flow.
5. Покрыть effective, partial, ineffective, unclear и missing-data cases.

## Acceptance criteria

- [x] Completed Correction не считается effective без follow-up evidence.
- [x] AI assessment отделён от client и specialist feedback.
- [x] CoreNode не становится integrated только из-за выполнения Correction.
- [x] Follow-up history сохраняется во времени.

## Checks

- [x] Пройдены correction lifecycle и insufficient follow-up tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

### Файлы

- `supabase/migrations/0030_follow_ups.sql` — таблица `follow_ups` по SPEC §8.30 (применена через `supabase migration up`). RLS через `is_client_accessible` (select/insert/update), grants `authenticated` и `service_role`. Поля результатов и feedback — `jsonb` (структурированные, машиночитаемые для evaluateCorrection); `result_status` — text с check-констрейнтом.
- `lib/service/follow-ups.ts` — сервис: `scheduleFollowUp`, `completeFollowUp`, `cancelFollowUp`, `listFollowUps` (cursor-пагинация), `getFollowUp`, `evaluateCorrection`, `reviewFollowUpAssessment`. Zod strict-схемы, `withAudit` для всех мутаций, `ServiceError`, локальные интерфейсы строк.
- `lib/supabase/database.types.ts` — перегенерирован (`pnpm db:types`).
- `app/actions/follow-ups.ts` — server actions (schedule/complete/cancel/evaluate/review) с provider resolution как в `app/api/ai/run/route.ts`.
- `app/api/follow-ups/route.ts` (GET list, POST schedule), `app/api/follow-ups/[id]/route.ts` (GET, PATCH complete, DELETE cancel), `app/api/follow-ups/[id]/evaluate/route.ts` (POST), `app/api/follow-ups/[id]/review/route.ts` (POST approve/reject).
- `app/corrections/[id]/page.tsx` + `app/corrections/[id]/follow-ups-forms.tsx` — секция Follow-ups: планирование, форма заполнения результатов (retest/behavioral/client feedback/specialist assessment), кнопка «Оценить эффект (AI)», pending ai_assessment с approve/reject и выбором итогового статуса, история follow-ups.
- `tests/unit/follow-ups.unit.test.ts` — 11 тестов: zod-схемы (strict, диапазоны, обязательность хотя бы одного поля результата), evidence guard (`collectMissingEvidence`, `hasSufficientEvidence`, `canBeEffective`).
- `tests/integration/follow-ups.integration.test.ts` — 9 тестов: полный lifecycle (schedule → complete → evaluate через FakeAiProvider → approve), AI-proposed effective при наличии evidence, reject + идемпотентность gateway (re-evaluate требует новых данных), insufficient evidence → deterministic guard без вызова AI + запрет effective override, observations как объективное evidence, lifecycle-конфликты, история нескольких follow-ups, RLS (чужая org не видит/не пишет), CoreNode guard (completion correction не меняет статус core node).

### Принятые решения

- **Lifecycle**: `scheduled → completed → (AI assessment pending) → effective / partially_effective / ineffective / unclear` только после human approval; `cancelled` для несостоявшихся. Множество follow-ups на одну correction, история не перезаписывается.
- **Effective-guard (SPEC §51.9)**: детерминированная проверка объективного evidence (retest, behavioral result, observations по correction, измеренные маркеры) применяется трижды — до вызова AI (нет evidence → `unclear` через `deterministic_guard` без provider call), к результату AI (effective без evidence понижается до unclear) и на human approval (override в effective без evidence → FORBIDDEN). Субъективные отзывы (client_feedback, specialist_assessment) evidence не считаются.
- **AI assessment** хранится в отдельной колонке `ai_assessment` (jsonb: результат контракта `ai.evaluate-correction.v1` + approval-метаданные: approval_status, source, run_id, decided_by/at), отдельно от `client_feedback` и `specialist_assessment`.
- **CoreNode guard**: ни completion Correction, ни evaluateCorrection не пишут в `core_nodes`; `proposed_core_node_status` из AI-ответа только сохраняется в ai_assessment для ревьюера. Покрыто интеграционным тестом (completion не меняет статус core node).
- **Payload evaluateCorrection (SPEC §33)**: retest/feedback самого follow-up, observations по correction_id, behavioral markers (baseline/current/trend), expected markers, target refs, история follow-ups, affected contexts (life areas), `priority_score_before` (округляется до int 0–100 — колонка double precision, а контракт требует integer score).
- **Идемпотентность gateway**: повторная оценка с неизменным evidence → CONFLICT; после reject нужна новая порция данных для переоценки (задокументировано тестом).

### Проверки (все зелёные)

- `pnpm lint` — OK (eslint + prettier check).
- `pnpm typecheck` — OK.
- `pnpm test` — 47 файлов, 265 тестов, все проходят (включая 20 новых: 11 unit + 9 integration).
- `pnpm build` — OK.

### Ограничения / замечания

- Отдельной страницы `/follow-ups` нет — UI встроен в страницу correction (допустимо по тикету).
- В app по умолчанию используется `FakeAiProvider` (как и в `app/api/ai/run/route.ts`); реальный провайдер включается через `AI_PROVIDER=openai` + `OPENAI_API_KEY`.
- Git commit не делался (по инструкции).
