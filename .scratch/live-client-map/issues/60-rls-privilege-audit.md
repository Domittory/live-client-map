# 60: Провести полный RLS и privilege audit

**What to build:** Каждая business table имеет явную проверенную RLS policy и минимальные database privileges.

**Goal:** Доказать tenant и per-client isolation после добавления всех сущностей.

**Context:** Нельзя использовать комментарий apply same policy вместо реальной policy. Client Portal не получает прямого доступа к base tables.

**Blocked by:** All tickets that create business tables through 59.

**Status:** resolved

## Concrete steps

1. Составить полный inventory business tables, views, functions и storage surfaces.
2. Проверить и при необходимости добавить explicit select/insert/update/delete policies.
3. Проверить membership AND assignment, Owner scopes и consent gates.
4. Проверить security definer search path и revoke лишних privileges.
5. Добавить generated access-matrix integration suite.

## Acceptance criteria

- [x] Каждая business table имеет явные и протестированные policies.
- [x] Cross-organization и unassigned-client access запрещён.
- [x] Client Portal не читает base tables напрямую.
- [x] Security-definer functions фиксируют safe search path и минимальные grants.

## Checks

- [x] Полная access matrix проходит для Owner, Specialist, Supervisor, read-only и portal.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Inventory (полный):**
- 52 business tables — у всех `enable row level security` + явные select/insert/update/delete policies (пробелов в таблицах нет).
- 0 views, 0 storage buckets.
- 22 security-definer функции (все уже фиксируют `set search_path = public`).

**Найденные проблемы (root cause):** Supabase bootstrap default ACL выдаёт `anon` (а для erasure-RPC — и `authenticated`) `EXECUTE` на все функции public-схемы. Паттерн `revoke all ... from public` в миграциях убирает только PUBLIC-грант, но не named-role гранты, которые default ACL материализует в момент создания объекта.

Критические последствия до фикса:
- `anonymize_client_audit` и `purge_client_ai_runs` (деструктивные, задуманы только для service_role) вызывались анонимом и любым залогиненным пользователем по угаданному `client_id` — удаление audit-трейла / ai_runs.
- `has_consent`, `validate_correction_target`, `validate_behavioral_marker_link` — анонимные info-oracle (возвращали данные/существование сущностей).

**Что сделано (миграция `0038_rls_privilege_audit.sql`):**
- Деструктивные erasure-RPC → только `service_role` (`revoke` от `public, anon, authenticated`).
- User-facing RPC (`has_consent`, `grant_consent`, `revoke_consent`, `create_client`, `grant/revoke_client_assignment`, `append_audit`, `validate_*`, admin-RPC) → `authenticated` (+`service_role` где сервис-слой зовёт напрямую), отозвано у `anon`.
- RLS-хелперы (`is_org_member`, `is_org_owner`, `is_client_accessible`) намеренно оставлены вызываемыми для `anon`: многие policies без `to authenticated` вычисляют их и для анонимных запросов (возвращают `false` при `auth.uid()=null`); отзыв превратил бы корректный «0 строк» в `permission denied`.
- Table-level SELECT для `anon` оставлен (Supabase default; RLS — гейт, анонимных policies нет → 0 строк). Это осознанно совпадает с существующими тестами.

**Файлы изменены:**
- `supabase/migrations/0038_rls_privilege_audit.sql` (новый).
- `tests/integration/access-matrix.integration.test.ts` (новый).

**Проверки:**
- `pnpm lint`, `pnpm typecheck` — чисто.
- `pnpm test:unit` — 202 passed.
- `tests/integration/access-matrix.integration.test.ts` — 11 passed (Owner/Specialist/Supervisor/read_only/unassigned/cross-org/portal/anon).
- Ключевые RLS-интеграционные тесты (`auth`, `assignments`, `consent`, `audit`, `erasure`, `client-portal`) — 38 passed последовательно.
- Привилегии проверены SQL-матрицей `has_function_privilege`: `anonymize_client_audit`/`purge_client_ai_runs` = только `service_role`; user-facing RPC = `anon=false`.

**Известные ограничения:**
- Supabase platform default ACL (роль `supabase_admin`) продолжает выдавать `anon` SELECT/TRUNCATE на таблицы при создании объектов вне миграций (dashboard). Наши миграции идут от `postgres` и не затрагиваются; это платформенный контракт, не наш.
- Полный `pnpm test:integration` флакит при параллельном прогоне против одной локальной БД (задокументировано в HANDOFF) — свои файлы проверялись изолированно.

