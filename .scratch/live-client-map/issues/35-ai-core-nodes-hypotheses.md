# 35: Реализовать AI-обновление CoreNodes и гипотез

**What to build:** AI предлагает новые или изменённые CoreNodes, DifferentialHypotheses, relations и contradictions для human review.

**Goal:** Автоматизировать аналитический слой, не позволяя AI молча менять подтверждённую модель.

**Context:** Объединяет updateCoreNodes, generateDifferentialHypotheses и detectContradictions как отдельные contracts, а не mega-prompt.

**Blocked by:** 25 — CoreNodes; 26 — differential/contradictions; 27 — relations; 28 — scoring; 34 — AI classify.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать три независимых AI services и их schemas.
2. Передавать independent evidence, existing model, contradictions и versions.
3. Создавать proposed Model mutations в pending review.
4. Запретить overwrite confirmed CoreNode без explicit review action.
5. Покрыть competing hypotheses, medical language и self-evidence cases.

## Acceptance criteria

- [ ] AI предлагает несколько объяснений при неоднозначности.
- [ ] Confirmed entities не меняются до human approval.
- [ ] AI-generated hypothesis не повышает собственные counts/scores.
- [ ] Forbidden causes relation отклоняется validation layer.

## Checks

- [ ] Пройдены acceptance cases 51.1, 51.4, 51.5 и 55.
- [ ] Repository-standard lint, typecheck и tests проходят.
