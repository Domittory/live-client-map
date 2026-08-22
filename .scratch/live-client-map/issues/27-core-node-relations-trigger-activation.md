# 27: Реализовать CoreNodeRelation и TriggerActivation

**What to build:** Специалист связывает узлы осторожными relationship semantics и фиксирует влияние Trigger на Theme или CoreNode.

**Goal:** Создать безопасный graph layer без автоматической сильной причинности.

**Context:** AI не создаёт causes. Causes_confirmed допустим только после ручного подтверждения и в пределах medical boundary.

**Blocked by:** 19 — Triggers; 25 — CoreNodes; 26 — DifferentialHypotheses.

**Status:** ready-for-agent

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
