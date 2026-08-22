# 14: Реализовать AuditLog

**What to build:** Значимые platform и business mutations автоматически оставляют защищённую audit запись.

**Goal:** Создать единый audit mechanism, который будут использовать все последующие slices.

**Context:** AuditLog отличается от ModelChange: он фиксирует действие и actor, а не изменение психологической модели.

**Blocked by:** 10 — Supabase/API foundation; 11 — authenticated actor.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать append-only AuditLog contract из SPEC.md.
2. Создать reusable mutation wrapper для before/after, actor и reason.
3. Защитить audit records от изменения обычными пользователями.
4. Добавить разрешённый Owner audit viewer с безопасной фильтрацией.
5. Покрыть successful, rejected и privileged actions.

## Acceptance criteria

- [ ] Audit entry содержит actor, action, entity, before/after и timestamp.
- [ ] Обычный пользователь не изменяет и не удаляет audit records.
- [ ] Secrets и запрещённые sensitive values не попадают в audit payload.
- [ ] Downstream services могут подключить audit без дублирования механизма.

## Checks

- [ ] Пройдены append-only и authorization integration tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
