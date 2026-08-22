# 12: Реализовать ClientAssignment и доступ по ролям

**What to build:** Owner управляет назначениями, а доступ к клиенту требует одновременно membership и действующий ClientAssignment.

**Goal:** Создать обязательную per-client security boundary до появления клиентских данных.

**Context:** SPEC.md запрещает проверять только Organization. Supervisor не должен автоматически видеть всех клиентов.

**Blocked by:** 04 — auth UX; 11 — Auth и Organization.

**Status:** resolved

## Decision

**Forward-reference `client_id`:** тикет 12 создаёт `client_assignments` с `client_id uuid` без внешнего ключа — таблица `clients` создаётся в тикете 17 и добавит FK и RLS-политики на клиентах. Переиспользуемая проверка `is_client_accessible(org_id, client_id, require_write)` параметризована и не зависит от таблицы `clients`. Grant/revoke выполняются security-definer функциями с проверкой, что вызывающий — Owner организации (owner exception, SPEC §43).

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

## Implementation result

**Что сделано:**
- Миграция `0004_client_assignments.sql`: таблица `client_assignments` (client_id, user_id, access_role, created_at, revoked_at, unique (client_id, user_id)); переиспользуемая проверка `is_client_accessible(org_id, client_id, require_write)` (membership AND assignment + owner exception); security-definer функции `grant_client_assignment` / `revoke_client_assignment` (проверка, что вызывающий — Owner); RLS «читать только свои назначения»; права для ролей anon/authenticated/service_role.
- Исправлены default-права в `0002` (добавлен `service_role`) — иначе серверный admin-клиент и тесты не имели доступа к таблицам.
- Серверные действия grant/revoke (email → user_id через admin API) и минимальный access UI (`/access`).
- Integration-тесты: access matrix по ролям, owner exception, revoked assignment, non-owner denial.

**Изменённые/созданные файлы:**
- `supabase/migrations/0004_client_assignments.sql` (новый), `supabase/migrations/0002_auth_organization.sql` (права)
- `app/actions/assignments.ts`, `app/access/page.tsx`, `app/access/access-form.tsx`
- `tests/integration/assignments.integration.test.ts`

**Пройденные проверки:**
- `pnpm typecheck` — pass
- `pnpm test` — 7/7 тестов тикета 12 проходят (owner exception, read/write по ролям, revoked, non-owner denial). Note: в репозитории 2 упавших теста и 1 неотформатированный файл относятся к параллельной работе (ticket 16 ontology, ticket 14 audit) — не к этому тикету.
- `pnpm lint` — файлы этого тикета проходят.
