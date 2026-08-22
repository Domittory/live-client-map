# 15: Реализовать управление Organization

**What to build:** Owner управляет участниками, настройками, retention и согласованной billing surface из одного административного раздела.

**Goal:** Завершить platform administration до масштабирования business entities.

**Context:** Точный scope определяется тикетами 02 и 05. Все изменения должны проходить authorization и AuditLog.

**Blocked by:** 02 — platform contracts; 04 — onboarding UX; 05 — retention policy; 11 — Organization; 14 — AuditLog.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать список, приглашение, изменение роли и деактивацию участников.
2. Реализовать Organization settings и утверждённые retention controls.
3. Реализовать billing surface строго в согласованном объёме.
4. Защитить ownership transfer и last-owner cases.
5. Добавить UI, audit и role-matrix tests.

## Acceptance criteria

- [ ] Только разрешённый Owner выполняет административные mutations.
- [ ] Нельзя оставить Organization без действующего Owner.
- [ ] Retention settings валидируются по policy.
- [ ] Billing behavior соответствует решению 02 без скрытых заглушек.

## Checks

- [ ] Пройдены role, invitation и ownership edge-case tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
