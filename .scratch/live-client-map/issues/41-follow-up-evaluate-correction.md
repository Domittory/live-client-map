# 41: Реализовать FollowUp и evaluateCorrection

**What to build:** Специалист планирует follow-up, собирает retest и feedback и получает проверяемую оценку эффекта Correction.

**Goal:** Замкнуть цикл коррекции реальными данными после вмешательства.

**Context:** Оценка учитывает retest, observations, behavioral markers, client и specialist feedback, а также изменения по контекстам.

**Blocked by:** 32 — AI gateway; 40 — Observations и BehavioralMarkers.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать FollowUp contract и scheduling lifecycle.
2. Создать UI заполнения результатов и feedback.
3. Реализовать evaluateCorrection как отдельный AI contract.
4. Сформировать pending assessment и human approval flow.
5. Покрыть effective, partial, ineffective, unclear и missing-data cases.

## Acceptance criteria

- [ ] Completed Correction не считается effective без follow-up evidence.
- [ ] AI assessment отделён от client и specialist feedback.
- [ ] CoreNode не становится integrated только из-за выполнения Correction.
- [ ] Follow-up history сохраняется во времени.

## Checks

- [ ] Пройдены correction lifecycle и insufficient follow-up tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
