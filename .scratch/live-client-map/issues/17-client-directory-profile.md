# 17: Реализовать каталог и профиль Client

**What to build:** Назначенный специалист создаёт, находит, открывает, редактирует и архивирует профиль клиента.

**Goal:** Получить первый защищённый end-to-end business slice.

**Context:** Использовать Client fields из SPEC.md, per-client assignment, consent gates, visibility и AuditLog. Примеры не должны становиться hardcoded-профилями.

**Blocked by:** 12 — assignments/RLS; 13 — consent gates; 14 — AuditLog.

**Status:** resolved

## Decision

- Таблица `clients` (SPEC §8.1) + FK из `client_assignments.client_id` и `consent_records.client_id` (замыкает forward-reference тикетов 12/13).
- `create_client` RPC: атомарно создаёт клиента + primary_specialist assignment (security definer, проверка `is_org_member`).
- RLS: SELECT = `is_client_accessible(org, id, false)`; UPDATE = `is_client_accessible(org, id, true)`; INSERT только через RPC; archive — soft delete через UPDATE (`status = 'archived'`, `archived_at`).
- `specialist_notes_private` исключается из client-visible проекции на сервисном уровне.

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

## Implementation result

**Что сделано:**
- Миграция `0008_clients.sql`: таблица `clients` (SPEC §8.1; поле `current_role` в кавычках — зарезервированное слово Postgres); FK из `client_assignments.client_id` и `consent_records.client_id` (замыкает forward-reference тикетов 12/13); RPC `create_client` (атомарно клиент + primary_specialist assignment); RLS (SELECT = `is_client_accessible(org,id,false)`, UPDATE = `is_client_accessible(org,id,true)`, INSERT через RPC, archive — soft delete).
- Сервисный слой `lib/service/clients.ts`: create/list/get/update/archive + `toClientVisible` (исключает `specialist_notes_private`) + audit через `recordAudit`.
- Серверные действия create/update/archive, UI `/clients` (каталог + создание) и `/clients/[id]` (профиль + редактирование + архив).
- Тесты: create→primary_assignment, archive (soft delete), cross-tenant denial, audit record, unit-тест `toClientVisible`.

**Изменённые/созданные файлы:**
- `supabase/migrations/0008_clients.sql`
- `lib/service/clients.ts`
- `app/actions/clients.ts`, `app/clients/page.tsx`, `app/clients/client-create-form.tsx`, `app/clients/[id]/page.tsx`, `app/clients/[id]/client-edit-form.tsx`
- `tests/integration/clients.integration.test.ts`, `tests/unit/clients.unit.test.ts`
- `tests/integration/assignments.integration.test.ts`, `tests/integration/consent.integration.test.ts` (setup: реальный клиент вместо случайного UUID — требуется после FK)

**Пройденные проверки:**
- `pnpm typecheck` — pass
- `pnpm test` — 72 passed (0 fail), включая clients (create/archive/cross-tenant/audit) и приватность заметок.
- `pnpm lint` — файлы этого тикета проходят; 2 файла `lib/ai/*` из параллельной работы не отформатированы (не относятся к тикету).
