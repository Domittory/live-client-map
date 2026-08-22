# 36: Реализовать updateResources

**What to build:** AI предлагает создание или изменение Resources на основании отдельного подтверждаемого evidence.

**Goal:** Автоматизировать resource layer, сохраняя независимость от problem reduction.

**Context:** Resource strength не выводится автоматически из снижения CoreNode activation. Все предложения ожидают human review.

**Blocked by:** 29 — Resources; 32 — AI gateway; 34 — AI classification; 35 — AI model updates.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать отдельный updateResources contract.
2. Передавать relevant Signals, observations и текущие Resources.
3. Валидировать evidence references, confidence и trend.
4. Создавать pending proposal с approve/edit/reject flow.
5. Добавить no-inference и duplicate/resource-merge tests.

## Acceptance criteria

- [ ] Ослабление проблемы само по себе не создаёт и не усиливает Resource.
- [ ] Каждое предложение имеет independent evidence references.
- [ ] Rejected proposal не влияет на snapshots или scores.
- [ ] Existing Resource может быть linked вместо создания duplicate.

## Checks

- [ ] Пройдены problem-reduction vs resource-development tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
