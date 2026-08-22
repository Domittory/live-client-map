# 37: Реализовать Recommendation и ранжирование

**What to build:** Специалист получает объяснимые Recommendations, связанные с текущим запросом и несколькими targets.

**Goal:** Выбирать минимальную безопасную коррекцию с высоким systemic leverage.

**Context:** Ranking использует versioned scoring из тикета 28. Risk >= 80 оставляет Recommendation draft, требует review и запрещает client visibility.

**Blocked by:** 18 — Requests; 28 — scoring; 30 — DevelopmentTargets; 35 — AI model updates; 36 — AI Resources.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать Recommendation и RecommendationTarget contracts.
2. Реализовать deterministic ranking и score breakdown.
3. Добавить generateRecommendations AI contract как источник pending proposals.
4. Создать recommendations UI с rationale, targets, scores и review actions.
5. Покрыть risk gate, relevance и insufficient-data behavior.

## Acceptance criteria

- [ ] Recommendation объясняет связь с текущим ClientRequest.
- [ ] Ranking воспроизводим для заданной scoring version.
- [ ] Risk >= 80 всегда требует human review и остаётся hidden from client.
- [ ] Система может рекомендовать сначала собрать данные вместо коррекции.

## Checks

- [ ] Пройдены formula, risk threshold и insufficient evidence tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
