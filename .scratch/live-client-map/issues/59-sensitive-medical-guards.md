# 59: Реализовать sensitive-case и medical-boundary guards

**What to build:** Система распознаёт опасные случаи, создаёт safety review и блокирует диагнозы, медицинскую причинность и опасные рекомендации.

**Goal:** Обеспечить обязательные клинические границы во всех AI-функциях.

**Context:** Покрыть self-harm, suicide, violence, abuse, coercive control, severe symptoms, child risk, emergency и health/fertility boundary.

**Blocked by:** 05 — privacy policy; 07 — AI contracts; 32 — AI gateway; 37 — Recommendations; 41 — evaluation; 50 — Relationships.

**Status:** ready-for-agent

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

- [ ] Пройден medical boundary case раздела 56 и sensitive-case fixtures.
- [ ] Repository-standard lint, typecheck и tests проходят.
