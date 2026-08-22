# 14: Реализовать AuditLog

**What to build:** Значимые platform и business mutations автоматически оставляют защищённую audit запись.

**Goal:** Создать единый audit mechanism, который будут использовать все последующие slices.

**Context:** AuditLog отличается от ModelChange: он фиксирует действие и actor, а не изменение психологической модели.

**Blocked by:** 10 — Supabase/API foundation; 11 — authenticated actor.

**Status:** resolved

## Implementation result

**Что сделано:**
- Миграция `0005_audit_log.sql`: append-only таблица `audit_log` (SPEC §8.33: actor, entity_type/entity_id, action, before_data/after_data, reason, ip_address, user_agent, created_at).
- Единый write-path: `append_audit(...)` (security definer, `set search_path = public`) — записывает реального `auth.uid()` как actor, проверяет membership; прямой INSERT в таблицу ролям не выдан.
- Append-only на уровне БД: триггер `audit_log_immutable` запрещает UPDATE/DELETE всем ролям, включая service_role.
- RLS: читает audit log только Owner организации; service_role сохраняет privileged read для поддержки платформы.
- Service layer `lib/service/audit.ts`: `recordAudit` (Zod-валидация + вызов RPC), `withAudit` (reusable mutation wrapper: mutation + before/after/actor/reason одной точкой входа), `sanitizeAuditPayload` (рекурсивная редакция password/secret/token/api_key/authorization/cookie/session), `listAuditLog` (owner-only, фильтры entityType/entityId/actorId/action/from/to, cursor-пагинация).
- Механизм подключён к первому downstream consumer: мутации онтологии из тикета 16 (`createOrgDomain`, `createOrgBeliefTemplate`, `archiveOrgDomain`, `archiveOrgBeliefTemplate`) теперь пишут audit через wrapper.
- Owner viewer: API `GET /api/audit-log` и UI `/audit` (фильтры + пагинация, не-владельцу — явный отказ), ссылка с главной.
- `lib/supabase/database.types.ts` перегенерирован из живой базы.

**Изменённые/созданные файлы:**
- `supabase/migrations/0005_audit_log.sql`
- `lib/service/audit.ts`, `lib/service/ontology.ts`, `lib/supabase/database.types.ts`
- `app/api/audit-log/route.ts`, `app/audit/page.tsx`, `app/page.tsx`
- `tests/unit/audit.unit.test.ts`, `tests/integration/audit.integration.test.ts`

**Пройденные проверки:**
- `supabase db reset` — чистая пересборка (0001–0005) OK
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 49 passed (в т.ч. audit integration: successful/rejected/privileged/append-only/owner-viewer)
- `pnpm build` — production build OK
- `pnpm test:e2e` — 2 passed

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
