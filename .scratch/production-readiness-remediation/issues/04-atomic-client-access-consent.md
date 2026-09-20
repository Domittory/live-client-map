# 04: Сделать Organization, Client, access и consent мутации атомарными

**What to build:** Перевести Organization, Client, membership, ClientAssignment и consent lifecycle на атомарные RPCs, сохранив текущие роли, RLS и публичные service contracts.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** resolved

- [x] Создание и изменение Client фиксируется вместе с обязательным AuditLog либо полностью откатывается.
- [x] Invite, membership role/status, ClientAssignment grant/revoke и consent grant/revoke атомарны и сохраняют least privilege.
- [x] Supervisor не получает organization-wide доступ и видит только явно назначенных Clients.
- [x] AuditLog failure и промежуточная database failure покрыты rollback tests для каждого типа compound mutation.
- [x] Access matrix и onboarding regression suites остаются зелёными.

## Implementation result

**What was implemented**

Миграция `0040_atomic_access_consent.sql` продолжает шаблон из 0039 и закрывает оставшиеся неатомарные мутации. Что уже было атомарным до неё: `create_organization` (org + owner membership), `invite_member`, `accept_invitation`, `update_member_role`, `set_member_status`, `transfer_ownership` — эти RPC с 0007 пишут AuditLog внутри той же транзакции, их не трогали.

Новые/переписанные RPC:

- `update_client(p_client_id, p_org_id, p_patch jsonb)`: обновление клиента и его `client.updated` audit — одна транзакция. Patch проходит строгий whitelist (`display_name`, `first_name`, `last_name`, `occupation`, `specialist_notes_private`, `client_visible_notes`), значения только string/null; неизвестное поле или пустой patch → SQLSTATE 22023. `before`/`after` для аудита собираются из колонок, `updated_at` обновляется.
- `archive_client(p_client_id, p_org_id)`: статус `archived` + `archived_at` + audit `client.archived` в одной транзакции; повторный архив идемпотентен.
- `grant_client_assignment(...)`: owner-only; валидирует допустимую роль; проверяет, что клиент принадлежит организации, а пользователь — её активный участник (раньше это не проверялось, и owner мог выдать доступ к чужому клиенту); пишет audit `assignment.grant` с before/after ролью.
- `revoke_client_assignment(...)`: owner-only; та же проверка тенанта; audit `assignment.revoke` пишется только если назначение реально отозвано (не фабрикуется лишняя запись).
- `grant_consent(...)` / `revoke_consent(...)`: сигнатуры сохранены, но аудит `consent.granted` / `consent.revoked` теперь пишется внутри RPC, а не отдельным вызовом после него; добавлена явная проверка принадлежности клиента организации (закрывает cross-tenant дыру, т.к. owner-исключение в `is_client_accessible` не проверяло тенант клиента).
- `update_organization_settings(p_org_id, p_name, p_retention jsonb)`: owner-only; слияние settings, сохранение границ retention через существующий CHECK (23514), audit `organization.update_settings` в той же транзакции.
- Least privilege: у всех новых функций явно `revoke all ... from public, anon` и grant только `authenticated`/`service_role` (иначе default privileges из 0002 выдали бы EXECUTE роли anon).

Изменения сервисного слоя:

- `lib/service/transaction.ts`: `runAtomicRpc` теперь маппит 22023/23514 → `VALIDATION_ERROR` и 23505 → `CONFLICT` (опциональные сообщения).
- `lib/service/clients.ts`: `updateClient` и `archiveClient` ходят в атомарные RPC; отдельный `recordAudit` убран. Публичные camel-case сигнатуры не изменились.
- `lib/service/admin.ts`: `updateOrgSettings` ходит в `update_organization_settings`; убран отдельный `recordAudit`.
- `app/actions/consent.ts`: убраны два отдельных вызова `recordAudit` — аудит теперь внутри RPC.
- `supabase/seed.sql`: fault-триггеры теперь навешиваются на все таблицы атомарных мутаций (`clients`, `client_assignments`, `consent_records`, `organizations`, `organization_members`, `organization_invitations`, `audit_log`), а у fault-строки появился `owner`, чтобы параллельные тестовые файлы не стирали чужие faults.

**Files changed**

- `supabase/migrations/0040_atomic_access_consent.sql` (new)
- `supabase/seed.sql`
- `lib/service/transaction.ts`, `lib/service/clients.ts`, `lib/service/admin.ts`
- `app/actions/consent.ts`
- `tests/integration/support/fault-injection.ts` (new, общий helper)
- `tests/integration/atomic-access-consent.integration.test.ts` (new, 17 tests)
- `tests/integration/atomic-mutation.integration.test.ts` (переведён на общий helper)

**Validation**

- `supabase db reset` — все миграции (включая 0040) и seed применяются с чистой БД.
- Новый набор `atomic-access-consent.integration.test.ts`: 17 тестов — commit+audit и rollback для client update, client archive, assignment grant, assignment revoke, consent grant, consent revoke, org settings; отказ для поля вне whitelist, для клиента чужой организации, для не-участника и для не-owner; supervisor видит только назначенного клиента.
- Rollback доказан через fault injection: отказ на append в `audit_log` полностью откатывает уже сделанную бизнес-запись (проверяется состояние строк, а не только отсутствие аудита).
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 83 files, **521 tests passed** (было 504; +17 новых).
- Access matrix и onboarding остаются зелёными: `assignments.integration.test.ts` (7), `auth.integration.test.ts` (4), `consent.integration.test.ts` (5), `admin.integration.test.ts` — в общем прогоне pass.
- `pnpm typecheck` — pass; `pnpm lint` — pass; `pnpm test:e2e` — 2 passed.

**Notes**

- Организационное создание (`create_organization`) осталось без новой audit-строки: оно и раньше было одной транзакцией (org + owner membership), а требование приёмки про обязательный AuditLog относится к Client. Добавление `organization.created` не требуется и не делалось, чтобы не менять контракт архива/аудита в этом тикете.
- `app/actions/assignments.ts` по-прежнему ищет пользователя по email через service-role клиент — это часть управления доступом, которую переделывает тикет 09.
