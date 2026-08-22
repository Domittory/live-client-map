# 26: Реализовать DifferentialHypothesis и contradictions

**What to build:** Специалист хранит несколько конкурирующих объяснений и отдельно видит evidence за и против каждого.

**Goal:** Не позволить системе преждевременно выбирать единственную психологическую причину.

**Context:** Противоречие является полезным сигналом, а не ошибкой данных. Medical causality остаётся запрещённой без подтверждения.

**Blocked by:** 25 — CoreNodes и Theme links.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать DifferentialHypothesis contract и evidence references.
2. Реализовать representation contradictions между Signals, Themes и hypotheses.
3. Создать services для создания, review, изменения confidence и статуса.
4. Добавить UI параллельного сравнения evidence for/against.
5. Покрыть competing hypothesis и contradiction scenarios.

## Acceptance criteria

- [ ] Несколько гипотез сосуществуют без автоматического winner.
- [ ] Contradicting evidence понижает confidence по утверждённым правилам.
- [ ] Недостаток данных отображается явно.
- [ ] Гипотеза не считается доказательством самой себя.

## Checks

- [ ] Пройден acceptance case раздела 55 SPEC.md.
- [ ] Repository-standard lint, typecheck и tests проходят.
