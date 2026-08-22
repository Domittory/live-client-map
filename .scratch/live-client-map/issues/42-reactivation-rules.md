# 42: Реализовать reactivation rules

**What to build:** Новые Triggers и Signals могут перевести ослабленный CoreNode в reactivated по утверждённым порогам.

**Goal:** Отражать возвращение паттерна, не переписывая прошлую интеграцию.

**Context:** Порог activation и минимальный прирост берутся из versioned scoring configuration тикета 06.

**Blocked by:** 19 — Triggers; 28 — scoring engine; 41 — FollowUp/evaluation.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать deterministic reactivation evaluator.
2. Учитывать только допустимое новое evidence и trigger activation.
3. Создавать reviewable status proposal и reason.
4. Показывать reactivation в CoreNode и correction history UI.
5. Добавить threshold, below-threshold и stale-evidence tests.

## Acceptance criteria

- [ ] Reactivation использует configuration version и сохраняет calculation details.
- [ ] Старое или AI-only evidence не вызывает reactivation само по себе.
- [ ] Статус меняется только по разрешённому lifecycle transition.
- [ ] Пользователь видит trigger и evidence, вызвавшие предложение.

## Checks

- [ ] Пройдены boundary-value и evidence eligibility tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
