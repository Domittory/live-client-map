# 12: Реализовать ClientAssignment и доступ по ролям

**What to build:** Owner управляет назначениями, а доступ к клиенту требует одновременно membership и действующий ClientAssignment.

**Goal:** Создать обязательную per-client security boundary до появления клиентских данных.

**Context:** SPEC.md запрещает проверять только Organization. Supervisor не должен автоматически видеть всех клиентов.

**Blocked by:** 04 — auth UX; 11 — Auth и Organization.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать ClientAssignment contract и access roles из SPEC.md.
2. Создать reusable authorization check membership AND assignment.
3. Реализовать grant, revoke и список assignments в access UI.
4. Добавить явные RLS policies и минимальные privileges.
5. Покрыть каждую роль и revoked assignment integration tests.

## Acceptance criteria

- [ ] Specialist и Supervisor видят только назначенных клиентов.
- [ ] Revoked assignment немедленно прекращает доступ.
- [ ] Read-only assignment запрещает mutations.
- [ ] Owner exception работает только с утверждённым administrative scope.

## Checks

- [ ] Пройдена access matrix для ролей и двух организаций.
- [ ] Repository-standard lint, typecheck и tests проходят.
