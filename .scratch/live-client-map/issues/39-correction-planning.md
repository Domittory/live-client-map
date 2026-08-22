# 39: Реализовать планирование Correction

**What to build:** Специалист превращает одобренную Recommendation в Correction с несколькими targets и ожидаемыми markers.

**Goal:** Создать проверяемый план вмешательства до его проведения.

**Context:** CorrectionTarget поддерживает primary, secondary, downstream и context roles. Expected markers задаются до результата.

**Blocked by:** 37 — Recommendations; 38 — InterventionMethod library.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать Correction, CorrectionTarget и CorrectionExpectedMarker.
2. Создать flow от Recommendation к planned Correction.
3. Валидировать target references, method contraindications и required consent.
4. Добавить Corrections UI с rationale, expected effect и markers.
5. Покрыть multi-target, status и audit tests.

## Acceptance criteria

- [ ] Одна Correction поддерживает несколько типизированных targets.
- [ ] Expected markers фиксируются до completed status.
- [ ] Priority score before сохраняется для будущего сравнения.
- [ ] Нельзя стартовать Correction с нарушенным consent или contraindication rule.

## Checks

- [ ] Пройдены create-from-recommendation и multi-target tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
