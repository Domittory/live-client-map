# 28: Реализовать версионируемый scoring engine

**What to build:** Система детерминированно рассчитывает утверждённые scores и объясняет каждый вклад.

**Goal:** Сделать приоритизацию, snapshots и model changes воспроизводимыми.

**Context:** Использовать только решение тикета 06. Формула final priority дана в SPEC.md; остальные формулы нельзя дополнять догадками.

**Blocked by:** 06 — scoring model; 16 — OntologyVersion; 22 — independent evidence; 25 — CoreNodes; 27 — graph relations.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать versioned scoring configuration и pure calculation services.
2. Подключить independent evidence, contexts, contradictions и graph inputs.
3. Реализовать final priority и systemic leverage как отдельные результаты.
4. Сохранять score breakdown и model version для объяснимости.
5. Добавить boundary, missing-data и golden-case tests.

## Acceptance criteria

- [ ] Одинаковые inputs и model version дают одинаковые scores.
- [ ] Все scores находятся в диапазоне 0–100.
- [ ] L0 и повторяющиеся Signals не раздувают confidence/rootness.
- [ ] Старый snapshot можно пересчитать или объяснить его старой версией.

## Checks

- [ ] Пройдены golden examples утверждённой scoring specification.
- [ ] Repository-standard lint, typecheck и tests проходят.
