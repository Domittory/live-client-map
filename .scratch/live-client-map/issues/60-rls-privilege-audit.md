# 60: Провести полный RLS и privilege audit

**What to build:** Каждая business table имеет явную проверенную RLS policy и минимальные database privileges.

**Goal:** Доказать tenant и per-client isolation после добавления всех сущностей.

**Context:** Нельзя использовать комментарий apply same policy вместо реальной policy. Client Portal не получает прямого доступа к base tables.

**Blocked by:** All tickets that create business tables through 59.

**Status:** ready-for-agent

## Concrete steps

1. Составить полный inventory business tables, views, functions и storage surfaces.
2. Проверить и при необходимости добавить explicit select/insert/update/delete policies.
3. Проверить membership AND assignment, Owner scopes и consent gates.
4. Проверить security definer search path и revoke лишних privileges.
5. Добавить generated access-matrix integration suite.

## Acceptance criteria

- [ ] Каждая business table имеет явные и протестированные policies.
- [ ] Cross-organization и unassigned-client access запрещён.
- [ ] Client Portal не читает base tables напрямую.
- [ ] Security-definer functions фиксируют safe search path и минимальные grants.

## Checks

- [ ] Полная access matrix проходит для Owner, Specialist, Supervisor, read-only и portal.
- [ ] Repository-standard lint, typecheck и tests проходят.
