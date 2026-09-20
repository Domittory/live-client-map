# 01: Ввести шаблон атомарной business mutation

**What to build:** Ввести расширяемый least-privilege RPC-шаблон, в котором одна показательная business mutation, связанные записи и AuditLog фиксируются одной PostgreSQL-транзакцией, чтобы следующие миграционные партии могли переходить на него без изменения публичных service contracts.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Показательная compound mutation и её AuditLog либо коммитятся вместе, либо не оставляют ни одной записи.
- [x] RPC проверяет tenant, ClientAssignment, consent и authenticated actor там, где они применимы, и использует фиксированный search path и минимальные grants.
- [x] Публичный service input сохраняет camel-case convention, а database payload использует schema column names.
- [x] Fault injection на промежуточной записи и AuditLog append доказывает полный rollback через публичную service boundary.
- [x] Существующие callers продолжают работать без одновременной миграции всего service layer.

## Implementation result

**What was implemented**

- Migration `0039_atomic_business_mutation.sql` фиксирует контракт атомарной business mutation и вводит расширяемый шаблон:
  - `public.require_org_member_actor(p_organization_id)` — переиспользуемый guard: резолвит actor из `auth.uid()` и проверяет членство в организации, иначе SQLSTATE `42501`. EXECUTE отозван у `public`/`anon`/`authenticated` (вызывается только из SECURITY DEFINER функций).
  - `public.create_client(...)` переписан как показательная атомарная мутация: Client + `primary_specialist` assignment + строка `client.created` в AuditLog пишутся одной транзакцией. Публичная RPC-сигнатура `(uuid, text, text, text)` не изменилась, поэтому существующие callers и service contract работают без изменений.
  - Least privilege: `set search_path = public`, `revoke all` у `public`/`anon`, `grant execute` только `authenticated` и `service_role`.
  - ClientAssignment и consent на создании не применимы (запись клиента ещё не существует) — это явно задокументировано в миграции; членство в организации гейтит операцию, а создатель получает assignment, который дальше гейтит client-scoped доступ.
  - AuditLog идёт через `append_audit()`, поэтому actor остаётся привязан к реальному вызывающему, а payload содержит только business-колонки (`display_name`).
- `lib/service/transaction.ts`: введён документированный `runAtomicRpc<T>(client, rpcName, args, messages)`, который маппит `42501` в `FORBIDDEN`, остальное — в `INTERNAL_ERROR`. Неиспользуемый `runRpc` удалён.
- `lib/service/clients.ts`: `createClient()` вызывает `runAtomicRpc("create_client", ...)` и больше не делает отдельный `recordAudit()` — иначе появлялся бы un-audited client при падении второго вызова. Публичный camel-case input (`createClientSchema`) сохранён, RPC получает snake_case параметры.
- `supabase/seed.sql`: локальная (seed-only, никогда не применяется `db push`) поддержка fault injection в непокрытой схемой `test_support` (`faults` + `inject_fault()` + триггеры на `client_assignments` и `audit_log`). Схема не экспонируется через PostgREST, поэтому не попадает ни в API, ни в генерируемые типы.
- `tests/integration/atomic-mutation.integration.test.ts`: доказывает атомарность через публичную service boundary:
  - happy path: client + assignment + ровно одна audit-строка (`client.created`, actor = specialist);
  - fault на промежуточной записи (`client_assignments`) → полный rollback (нет клиента, нет audit);
  - fault на append в `audit_log` → полный rollback (уже вставленные client и assignment откатываются);
  - после снятия fault мутация снова работает;
  - `anon` не может выполнить атомарный RPC.

**Files changed**

- `supabase/migrations/0039_atomic_business_mutation.sql` (new)
- `supabase/seed.sql`
- `lib/service/transaction.ts`
- `lib/service/clients.ts`
- `tests/integration/atomic-mutation.integration.test.ts` (new)
- `package.json`, `pnpm-lock.yaml` (devDependency `pg` + `@types/pg` для прямого подключения тестов к локальной БД)

**Validation**

- `supabase db reset` — миграции (включая 0039) и seed применяются с чистой БД.
- `pnpm typecheck` — pass.
- `pnpm lint` (eslint + prettier) — pass.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 80 files, 482 tests passed (было 221 integration; +5 новых).
- Проверка дрейфа типов: `supabase gen types typescript --local` не содержит `test_support`/`test_faults` (0 вхождений), т.е. локальная тест-поддержка не протекает в `lib/supabase/database.types.ts`.

**Observation (не входит в scope тикета)**

`supabase gen types typescript --local` отличается от закоммиченного `lib/supabase/database.types.ts`: отсутствуют `clients.legal_hold` и таблица `erasure_requests` из миграции 0037. Это предсуществующий дрейф типов, а не результат этой правки; его должен закрыть тикет 23 (reproducible release gate / refresh generated types).
