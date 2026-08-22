# 17: Реализовать каталог и профиль Client

**What to build:** Назначенный специалист создаёт, находит, открывает, редактирует и архивирует профиль клиента.

**Goal:** Получить первый защищённый end-to-end business slice.

**Context:** Использовать Client fields из SPEC.md, per-client assignment, consent gates, visibility и AuditLog. Примеры не должны становиться hardcoded-профилями.

**Blocked by:** 12 — assignments/RLS; 13 — consent gates; 14 — AuditLog.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать Client storage contract и validation.
2. Создать service/API operations list, create, read, update и archive.
3. Применить assignment, consent, tenant isolation и audit.
4. Создать каталог и профиль с private/client-visible разделением.
5. Добавить integration и UI tests для happy path и denied access.

## Acceptance criteria

- [ ] Specialist работает только с назначенными клиентами своей Organization.
- [ ] Private notes никогда не попадают в client-visible response.
- [ ] Archive сохраняет историю и убирает клиента из активного списка.
- [ ] Все mutations оставляют audit record.

## Checks

- [ ] Пройдены create/edit/archive и cross-tenant denial tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
