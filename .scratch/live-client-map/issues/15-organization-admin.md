# 15: Реализовать управление Organization

**What to build:** Owner управляет участниками, настройками, retention и согласованной billing surface из одного административного раздела.

**Goal:** Завершить platform administration до масштабирования business entities.

**Context:** Точный scope определяется тикетами 02 и 05. Все изменения должны проходить authorization и AuditLog.

**Blocked by:** 02 — platform contracts; 04 — onboarding UX; 05 — retention policy; 11 — Organization; 14 — AuditLog.

**Status:** resolved

## Implementation result

**Что сделано:**
- Миграция `0007_organization_admin.sql`:
  - `organization_invitations` (контракт тикета 02: email, role specialist/supervisor, token, 7-дневный TTL, accepted_at; unique (organization_id, email)).
  - Owner-only RPC (security definer, `set search_path = public`): `invite_member`, `accept_invitation`, `update_member_role`, `set_member_status`, `transfer_ownership`; каждая пишет audit через `append_audit` в той же транзакции (тикет 14).
  - Last-owner invariant: триггер `protect_org_owner_membership` запрещает удалить/понизить/деактивировать membership владельца; `transfer_ownership` атомарно меняет `organizations.owner_user_id` и роли (owner → новому, specialist → старому).
  - Retention check constraint на `organizations.settings` по политике тикета 05: `client_data_years` 1–5, `export_days` 1–30; audit (3 года) и backups (30 дней) фиксированы и не настраиваются.
  - RLS: приглашения читает только Owner; co-member profiles читаемы внутри организации (для списка участников).
- Service `lib/service/admin.ts`: Zod-схемы + RPC-обёртки (`inviteMember`, `acceptInvitation`, `updateMemberRole`, `setMemberStatus`, `transferOwnership`), `updateOrgSettings` (merge settings + audit), `listMembers` (owner-only), константа `RETENTION_POLICY`.
- Server actions `app/actions/admin.ts` (паттерн `app/actions/auth.ts`).
- UI `/admin`: участники (смена роли, suspend/reactivate), приглашения (список + форма + invite-ссылка), настройки с retention-контролами, billing read-only (план + явное «оплата не подключена», без скрытых заглушек — тикет 02), передача ownership. Не-владельцу — явный отказ.
- UI `/invite/[token]`: принятие приглашения (email должен совпадать), подсказка войти/зарегистрироваться.
- Ссылка на `/admin` с главной. Типы БД перегенерированы.

**Изменённые/созданные файлы:**
- `supabase/migrations/0007_organization_admin.sql`
- `lib/service/admin.ts`, `app/actions/admin.ts`
- `app/admin/page.tsx`, `app/admin/forms.tsx`, `app/invite/[token]/{page,accept-form}.tsx`, `app/page.tsx`
- `tests/unit/admin.unit.test.ts`, `tests/integration/admin.integration.test.ts`
- `tests/integration/ontology.integration.test.ts` (чинит идемпотентность: уникальные slug/version на прогон)
- `lib/supabase/database.types.ts`

**Пройденные проверки:**
- `supabase db reset` — чистая пересборка (0001–0007) OK
- `pnpm lint` — pass; `pnpm typecheck` — pass; `pnpm build` — OK; `pnpm test:e2e` — 2 passed
- `pnpm test` — 67 passed, включая role-matrix (только Owner), invite→accept с audit, last-owner защита (RPC + прямой update), ownership transfer с немедленной потерей прав, duplicate invite, retention constraint; повторный прогон без reset тоже зелёный

## Concrete steps

1. Реализовать список, приглашение, изменение роли и деактивацию участников.
2. Реализовать Organization settings и утверждённые retention controls.
3. Реализовать billing surface строго в согласованном объёме.
4. Защитить ownership transfer и last-owner cases.
5. Добавить UI, audit и role-matrix tests.

## Acceptance criteria

- [ ] Только разрешённый Owner выполняет административные mutations.
- [ ] Нельзя оставить Organization без действующего Owner.
- [ ] Retention settings валидируются по policy.
- [ ] Billing behavior соответствует решению 02 без скрытых заглушек.

## Checks

- [ ] Пройдены role, invitation и ownership edge-case tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
