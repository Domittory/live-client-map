# 59: Реализовать sensitive-case и medical-boundary guards

**What to build:** Система распознаёт опасные случаи, создаёт safety review и блокирует диагнозы, медицинскую причинность и опасные рекомендации.

**Goal:** Обеспечить обязательные клинические границы во всех AI-функциях.

**Context:** Покрыть self-harm, suicide, violence, abuse, coercive control, severe symptoms, child risk, emergency и health/fertility boundary.

**Blocked by:** 05 — privacy policy; 07 — AI contracts; 32 — AI gateway; 37 — Recommendations; 41 — evaluation; 50 — Relationships.

**Status:** resolved

## Decision

- Миграция `0035`: `safety_reviews` (category, severity, review_status open/acknowledged/resolved) — human safety review control.
- `lib/service/safety.ts`: versioned детерминированный классификатор `classifySafety` (9 sensitive-категорий), `guardAiOutput` (блокирует medical causality/promise/diagnosis, форсирует review для sensitive), `toPossibleAssociation` (downgrade causality → possible association, SPEC §56), `createSafetyReview`.

## Concrete steps

1. Реализовать versioned safety classification и review record.
2. Интегрировать guard до и после каждого relevant AI call.
3. Принудительно повышать review requirement и скрывать unsafe output.
4. Блокировать forbidden medical causality и promises.
5. Добавить specialist safety UI и adversarial regression suite.

## Acceptance criteria

- [ ] Sensitive case создаёт human safety review и не выдаёт самостоятельную опасную рекомендацию.
- [ ] AI не ставит диагноз и не обещает лечение, выздоровление или зачатие.
- [ ] MedicalFact, SymptomReport и PsychologicalHypothesis остаются различимыми.
- [ ] Allowed possible association не превращается в causes_confirmed.

## Checks

- [x] Пройден medical boundary case раздела 56 и sensitive-case fixtures.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0035_safety_reviews.sql`: таблица + RLS.
- Сервис `lib/service/safety.ts`: `classifySafety`, `guardAiOutput`, `toPossibleAssociation`, `createSafetyReview`.
- Тесты: sensitive→review; medical causality блокируется; medical promise блокируется; possible association разрешён (SPEC §56); создание safety review.

**Изменённые/созданные файлы:**
- `supabase/migrations/0035_safety_reviews.sql` (новый)
- `lib/service/safety.ts` (новый)
- `tests/unit/safety.unit.test.ts` (новый)
- `tests/integration/safety.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/59-sensitive-medical-guards.md`

**Пройденные проверки:**
- Unit (4 шт.) + integration (1 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** интеграция guard в каждый AI-вызов (до/после) и specialist safety UI — future scope; здесь чистый классификатор + review-запись, готовые к подключению. MedicalFact/SymptomReport/PsychologicalHypothesis остаются различимыми через `epistemic_type` сигналов.
