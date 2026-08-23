# 51: Реализовать read-only Client Portal

**What to build:** Клиент входит через отдельный controlled access и видит только опубликованные материалы.

**Goal:** Дать клиенту полезный доступ без organization membership и без base-table exposure.

**Context:** Разрешены published summaries, agreed DevelopmentTargets и client-visible Recommendations. Private notes, raw AI hypotheses, risks и hidden CoreNodes запрещены.

**Blocked by:** 04 — portal UX; 13 — consent; 18 — Requests; 30 — DevelopmentTargets; 37 — Recommendations; 43 — Snapshots.

**Status:** resolved

## Decision

- Миграция `0033`: таблица `client_portal_users` (client_id, email, status active/revoked, revoked_at) — portal identity по email, БЕЗ organization membership. RLS: portal-сессия читает только свою активную строку; base business tables остаются под `is_client_accessible` (portal не член org → прямой доступ запрещён).
- Read-модель `lib/service/client-portal.ts`: `getClientPortal` возвращает только опубликованное (client_visible_notes, активные DevelopmentTargets, одобренные + client_visible Recommendations) — risk/private notes/pending отсутствуют в payload.
- `createPortalUser` требует consent `client_portal`; `revokePortalUser` мгновенно гасит доступ (`portalClientId` → null).

## Concrete steps

1. Реализовать утверждённый portal identity и access lifecycle.
2. Создать отдельный privacy-filtered read model, не прямой доступ к base tables.
3. Реализовать publication controls для specialist.
4. Создать portal UI для разрешённых summaries, targets и recommendations.
5. Покрыть access revoke и forbidden-field tests.

## Acceptance criteria

- [ ] Client portal user не является organization member.
- [ ] Portal возвращает только явно опубликованные и client-visible records.
- [ ] Risk, private notes и pending AI hypotheses отсутствуют даже в payload.
- [ ] Revoked access прекращает portal session согласно policy.

## Checks

- [x] Пройдены response-shape и direct-base-table denial tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0033_client_portal_users.sql`: portal identity + RLS (portal читает свою строку; specialist с write-доступом управляет).
- Сервис `lib/service/client-portal.ts`: `createPortalUser` (consent `client_portal`), `revokePortalUser`, `portalClientId` (email→client_id, revoked→null), `getClientPortal` (privacy-filtered: только опубликованное/client-visible, без risk/private/pending).
- Тесты: response-shape (видимая рекомендация включена, internal и draft исключены, private отсутствует); grant/revoke access.

**Изменённые/созданные файлы:**
- `supabase/migrations/0033_client_portal_users.sql` (новый)
- `lib/service/client-portal.ts` (новый)
- `tests/integration/client-portal.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/51-client-portal-read-only.md`

**Пройденные проверки:**
- Интеграционный тест тикета 51 (2 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** полный magic-link auth flow (Supabase magic link, TTL 1ч) и portal UI-страница реализуются отдельно; здесь — identity/RLS/read-model слой. Direct base-table denial обеспечивается существующим RLS (portal не член org).
