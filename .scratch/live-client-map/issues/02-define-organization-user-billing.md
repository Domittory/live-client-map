# 02: Описать Organization, User, membership и billing

**What to build:** Определить отсутствующие platform contracts для пользователей, организаций, членства и административных настроек.

**Goal:** Дать implementation agents полную модель доступа Owner, Specialist и Supervisor.

**Context:** SPEC.md перечисляет роли и права, но не задаёт поля Organization, User и membership, жизненный цикл приглашений, административные scopes и границы billing.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Concrete steps

1. Определить поля и ограничения Organization, User и organization membership.
2. Описать роли, administrative scopes, приглашения, блокировку и удаление участника.
3. Уточнить, что именно входит в billing/settings и требуется ли внешний billing provider.
4. Определить ownership transfer и поведение при последнем Owner.
5. Зафиксировать state transitions и audit requirements.

## Acceptance criteria

- [ ] Все platform entities имеют полный набор полей, enums и ограничений.
- [ ] Права Owner, Specialist и Supervisor не противоречат client assignments.
- [ ] Billing либо определён как реализуемый scope, либо явно отложен решением владельца.
- [ ] Решение одобрено владельцем проекта.

## Checks

- [ ] Для каждого административного действия указан разрешённый actor.
- [ ] Тикеты 11 и 15 не требуют придумывать platform fields или role semantics.

## Resolution

Решение одобрено владельцем проекта 2026-08-22.

**Platform-таблицы:**

- `organizations`: `id`, `name`, `slug` (unique), `owner_user_id`, `plan` (`free`/`pro`/`enterprise`), `settings` (jsonb), `status` (`active`/`suspended`/`archived`), `created_at`, `updated_at`.
- `profiles`: `id` (= `auth.users.id`), `email`, `display_name`, `avatar_url`, `locale`, `created_at`, `updated_at`.
- `organization_members`: `id`, `organization_id`, `user_id`, `role` (`owner`/`specialist`/`supervisor`), `status` (`invited`/`active`/`suspended`), `invited_by`, `invited_at`, `joined_at`, `suspended_at`; unique (`organization_id`, `user_id`).
- `organization_invitations`: `id`, `organization_id`, `email`, `role`, `token`, `expires_at`, `accepted_at`.

**Membership и приглашения:**

- Приглашение по email, токен живёт 7 дней; незарегистрированный пользователь регистрируется по ссылке и сразу становится членом организации.
- Один пользователь может состоять в нескольких организациях.
- Последнего Owner нельзя удалить или понизить в роли — сначала передача ownership другому активному участнику.
- Supervisor-членство не даёт доступа к клиентам само по себе; доступ к клиентам — только через `ClientAssignment` (тикет 12, согласно SPEC §6).
- Все административные действия (invite, accept, suspend, remove, ownership transfer, смена plan) пишутся в audit log (тикет 14).

**Billing:**

- Реальные платежи отложены решением владельца: внешнего billing-провайдера в текущей версии нет.
- `plan` и лимиты хранятся как данные в `organizations` и могут изменяться вручную; billing-экран — read-only заглушка.
- Интеграция платёжного провайдера и enforcement лимитов — отдельный будущий тикет.

Тикеты 11 и 15 реализуются по этим контрактам без придумывания новых полей и ролей.
