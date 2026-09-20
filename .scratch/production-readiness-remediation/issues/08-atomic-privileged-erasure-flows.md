# 08: Сделать privileged и erasure flows атомарными

**What to build:** Закрыть транзакционные разрывы в privileged, safety и erasure flows так, чтобы авторизованная операция либо завершала весь согласованный cleanup и audit, либо оставляла исходное состояние доступным для безопасного повтора.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** resolved

- [x] Privileged RPCs подтверждают Owner/actor context до обхода обычного RLS и имеют минимальные grants.
- [x] Erasure не оставляет частично удалённые client data, AI runs или неанонимизированный AuditLog.
- [x] Legal hold и consent constraints проверяются до необратимой части операции.
- [x] Повтор после failure имеет определённый идемпотентный или recoverable результат.
- [x] Fault injection проверяет failures на каждой транзакционно значимой стадии без удаления unrelated data.

## Implementation result

### Найденные транзакционные разрывы

1. `executeErasure()` собирала всю операцию из ~восьми независимых PostgREST-вызовов. Падение после `anonymize_client_audit()` (необратимая стадия) и до `delete from clients` оставляло живого клиента с уже стёртым audit trail; падение между delete и обновлением `erasure_requests` оставляло запрос в `in_progress` без `backup_marker` и без клиента для повтора.
2. `legal_hold` читался отдельной транзакцией до необратимых шагов — параллельно выставленный hold мог быть молча проигнорирован.
3. `setLegalHold()` и `revokeDataStorage()` обходили RLS через `service_role` после клиентской проверки `is_org_owner`, и каждый писал данные отдельным вызовом от `recordAudit()`/upsert.
4. `createSafetyReview()`, `createPortalUser()` и `revokePortalUser()` сначала писали control-row, а audit добавляли вторым сетевым вызовом: контроль мог существовать без audit trail.
5. `anonymize_client_audit` / `purge_client_ai_runs` были отдельными RPC, доступными `service_role`, вне Owner-only транзакции.

В `lib/service/admin.ts` привилегированных путей с обходом RLS не найдено — все мутации уже идут через RPC. В `lib/service/client-portal.ts` обхода RLS нет (запросы шли под RLS пользователя), но был разрыв «запись + отдельный audit»; он закрыт.

### Что сделано

Миграция `supabase/migrations/0044_atomic_privileged_flows.sql`:

- внутренние helper'ы (revoke all from public, anon, authenticated; клиентским ролям не выдаются):
  - `opaque_client_ref(uuid)` — тот же ref, что `opaqueClientRef()` в TS (`sha256(id)[0..16]`); паритет проверен тестом;
  - `require_org_owner_actor(uuid)` — actor из `auth.uid()` + `is_org_owner` до любых RLS-bypass шагов;
  - `erasure_impact_tables()` — единый список client-scoped таблиц;
- публичные Owner-only RPC (grant `authenticated, service_role`):
  - `set_client_legal_hold(uuid, boolean)` — идемпотентно, блокирует строку `clients ... for update`, пишет audit в той же транзакции;
  - `request_client_erasure(uuid)` — отзыв `data_storage` и запись `erasure_requests` одной транзакцией, терминальный запрос не понижается;
  - `execute_client_erasure(uuid)` — одна транзакция: Owner-проверка → проверка `legal_hold` на заблокированной строке → отзыв всех активных consent'ов → `set_config('app.data_erasure','on', true)` (transaction-local) → анонимизация audit → purge `ai_runs` → hard delete `clients` → финализация запроса и completion-audit. Терминальный `completed` не перезапускается; запрос без клиента (legacy/out-of-band частичный сбой) финализируется как `already_completed` с `backup_marker`;
- публичные RPC контроля (grant `authenticated, service_role`): `create_safety_review`, `create_portal_user`, `revoke_portal_user` — control-row и audit в одной транзакции;
- `anonymize_client_audit` / `purge_client_ai_runs` остались внутренними: EXECUTE отозван и у `service_role` (вызываются только из `execute_client_erasure` под правами владельца миграции).

Ключевые решения по security-семантике (на проверку лиду):

- `legal_hold` и tenant/owner проверяются на заблокированной строке `clients` (`for update`), поэтому hold и erasure сериализуются;
- порядок в `execute_client_erasure` намеренно такой: consent-гейты отзываются до первой необратимой записи; проверка `legal_hold` — до отзыва consent'ов, при hold данные не трогаются вообще;
- `revoke ... from service_role` для двух destructive-хелперов — более строго, чем минимальное требование тикета (public/anon/authenticated); обоснование: вне Owner-only транзакции они не нужны никому, а service_role с ними мог бы анонимизировать audit по угаданному UUID;
- `request_client_erasure` сознательно НЕ проверяет `legal_hold` (как и раньше `revokeDataStorage`): блокируется только необратимая часть;
- новые RPC повторяют существующие проверки как надмножество: `assert_client_write`/`assert_client_consent` вместо RLS + `requireConsent`, поэтому публичные контракты сервисов (`createSafetyReview`, `createPortalUser`, `revokePortalUser`, `setLegalHold`, `revokeDataStorage`, `executeErasure`) не изменены.

### Изменённые файлы

- `supabase/migrations/0044_atomic_privileged_flows.sql` — новый.
- `lib/service/erasure.ts` — preview остаётся read-only через `admin`; все мутации идут через `runAtomicRpc` на authenticated-клиенте, убраны `upsertRequest`, `requireUserId` и парные `recordAudit`.
- `lib/service/safety.ts` — `createSafetyReview` через RPC.
- `lib/service/client-portal.ts` — `createPortalUser` / `revokePortalUser` через RPC, удалён неиспользуемый `clientOrg`.
- `supabase/seed.sql` — тестовые триггеры теперь `before insert or update or delete`; в список добавлены `erasure_requests`, `ai_runs`, `safety_reviews`, `client_portal_users`.
- `tests/integration/atomic-erasure-flows.integration.test.ts` — новый (13 тестов).

### Проверки (точные команды и результаты)

- `export DOCKER_HOST="unix:///Users/dmitryeliseev/.colima/default/docker.sock"; HOME="$TMPDIR/supabase-home" supabase db reset` → exit 0, применены миграции 0001–0044, seed выполнен.
- `pnpm typecheck` → успешно.
- `pnpm lint` → `eslint . && prettier --check .` → успешно.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` → **87 файлов / 593 теста passed** (было 86/580; +1 файл, +13 тестов).
- `pnpm test:e2e` → **2 passed**.

Fault-injection покрытие в `atomic-erasure-flows.integration.test.ts` (все маркеры уникальны, поэтому suite безопасен при параллельных файлах): запись `erasure_requests`, отзыв `consent_records`, необратимая анонимизация `audit_log` (маркер — уникальный `action`, который анонимизация сохраняет), purge `ai_runs`, hard delete `clients`, финальный completion-audit после delete и финализации. Каждый сбой доказывает полный rollback (client data, AI runs, audit, consents), затем retry приводит к определённому `completed`; отдельно проверены legal hold до необратимой части, recoverable-финализация запроса без клиента, недоступность destructive-хелперов для `authenticated`/`service_role`/anon и неприкосновенность unrelated клиентов в своей и чужой организации.

## Ревью ведущего

Независимо проверено после реализации:

- **Права в БД** (запрос к `pg_proc`/`has_function_privilege`): `anon` может выполнять
  только давно известный безопасный набор (`health_check`, RLS-хелперы
  `is_org_member`/`is_org_owner`/`is_client_accessible` и триггерные функции).
  `anonymize_client_audit` и `purge_client_ai_runs` недоступны ни `authenticated`,
  ни `service_role` — они вызываются только из Owner-only `execute_client_erasure`
  (SECURITY DEFINER). Внутренние помощники `require_org_owner_actor`,
  `opaque_client_ref`, `erasure_impact_tables` не доступны `authenticated`.
- **Порядок erasure** прочитан построчно: блокировка строки клиента `for update` →
  проверка `legal_hold` до любых изменений (при hold не трогается вообще ничего) →
  сбор impacted ids/счётчиков → запись `erasure_requests` + audit → отзыв активных
  consent'ов → `set_config('app.data_erasure','on', true)` (transaction-local) →
  анонимизация audit (без удаления) → purge AI runs → hard delete клиента с
  каскадом → финализация `completed` + audit. Одна транзакция, повтор идемпотентен.
- **Клиент для RPC**: `executeErasure`/`setLegalHold` вызывают RPC через
  пользовательский клиент (`auth`), поэтому `auth.uid()` доступен и owner-проверка
  внутри RPC работает; `admin` (service_role) используется только для чтения перед
  вызовом, чтобы сохранить контракт `NOT_FOUND`.
- **Прогоны**: `supabase db reset` (0001–0044), полный набор 87 файлов / 593 теста —
  зелёный, `pnpm typecheck` / `pnpm lint` / `pnpm test:e2e` — зелёные.
