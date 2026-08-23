# 58: Реализовать отзыв consent и полное data erasure

**What to build:** Ответственный пользователь отзывает согласие или запускает удаление клиента, а система исполняет утверждённую policy во всех хранилищах.

**Goal:** Реализовать право на прекращение обработки и hard delete без нарушения обязательных retention rules.

**Context:** Это end-to-end workflow поверх всех созданных business entities, exports, portal data, audit и backups.

**Blocked by:** 05 — privacy policy; 13 — consent; 14 — AuditLog; 17 — Client; 43 — Snapshots; 50–57 — relationship, portal и exchange.

**Status:** resolved

## Decision

Решение одобрено владельцем проекта 2026-08-23.

- **audit_log** обезличивается через SECURITY DEFINER RPC `anonymize_client_audit` + transaction-local session-флаг `app.data_erasure`; триггер `audit_log_immutable` переопределён так, что UPDATE разрешён только этому пути, DELETE запрещён всегда. Для всех остальных audit остаётся append-only.
- **legal_hold** — колонка `clients.legal_hold boolean not null default false`, ставит/снимает только Owner (column-level `revoke` от `authenticated`, запись через service_role после `is_org_owner`).
- **Hard delete** выполняется через service_role-клиент, каскадом от строки `clients` (все клиентские таблицы уже `on delete cascade`). Авторизация и audit — через auth-клиент, т.к. `is_org_owner`/`append_audit` читают `auth.uid()`.
- **Бэкапы/tombstones** (30-дневная ротация) не строятся здесь — в `erasure_requests.backup_marker` фиксируется всё, что нужно тикету 63.

## Concrete steps

1. Реализовать impact preview и authorization для revoke/erasure request.
2. Остановить запрещённые AI, portal, relationship и export operations.
3. Выполнить delete/anonymize/retain actions по policy для всех entities.
4. Обработать exports, jobs, caches и backup tombstones.
5. Добавить progress, failure recovery, audit и exhaustive tests.

## Acceptance criteria

- [x] После revoke новые операции соответствующего scope запрещены.
- [x] Erasure охватывает все business tables и производные данные.
- [x] Legally retained records минимизированы и объяснены.
- [x] Повторный запуск безопасен и продолжает незавершённую операцию.

## Checks

- [x] Пройден seeded-client erasure audit по всем entity types.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0037_erasure.sql`: `clients.legal_hold`, таблица `erasure_requests` (state machine `requested→in_progress→completed/blocked/failed`, `unique(organization_id, client_ref)`, `client_id on delete set null`), переопределение триггеров `audit_log_immutable` и `block_mutation` под session-флаг `app.data_erasure`, SECURITY DEFINER функции `anonymize_client_audit` (скраб `entity_id`/`before_data`/`after_data`/`reason`/`ip`/`ua`, сохраняет action/время/actor) и `purge_client_ai_runs`.
- Сервис `lib/service/erasure.ts`: `previewErasure` (Owner-only потабличный impact + список id для анонимизации), `setLegalHold`, `executeErasure` (owner-check → legal_hold gate → собрать id → request in_progress → revoke всех consent → anonymize audit → purge ai_runs → hard delete clients cascade → finalize + completion-audit без ссылки на удалённого клиента), `revokeDataStorage`, чистая `summarizeImpact` и `opaqueClientRef`. Идемпотентность: повторный запуск возвращает `already_completed`, путь «клиент уже удалён» дофинализирует request.
- API: `GET /api/erasure/preview`, `POST /api/erasure` (`execute`/`revoke`), `POST /api/erasure/legal-hold`.
- UI: секция «Удаление данных» на `app/clients/[id]` (только Owner) — потабличный preview + форма с подтверждением и тумблером legal hold (`app/actions/erasure.ts`, `app/clients/[id]/erasure-form.tsx`).

**Изменённые/созданные файлы:**
- `supabase/migrations/0037_erasure.sql` (новый)
- `lib/service/erasure.ts` (новый)
- `app/api/erasure/preview/route.ts`, `app/api/erasure/route.ts`, `app/api/erasure/legal-hold/route.ts` (новые)
- `app/actions/erasure.ts`, `app/clients/[id]/erasure-form.tsx` (новые)
- `app/clients/[id]/page.tsx` (модифицирован)
- `tests/unit/erasure.unit.test.ts`, `tests/integration/erasure.integration.test.ts` (новые)

**Пройденные проверки:**
- Миграция применена к локальной БД (docker exec psql, `ON_ERROR_STOP=1`).
- `pnpm lint`, `pnpm typecheck` — чисто.
- `pnpm test:unit` — 202 pass (7 новых по erasure).
- Интеграционные: erasure (5), report (7), export (3), ai-gateway (9) — 24 pass, включая регресс триггеров `audit_log`/`ai_runs`.

**Known limitations:**
- Бэкапы и tombstones (30-дневная ротация) — не реализованы, зафиксированы в `erasure_requests.backup_marker` для тикета 63.
- Join-таблицы без `client_id` (`signal_theme_links`, `theme_core_node_links`, `trigger_activations`, `recommendation_targets`, `correction_targets`, `correction_expected_markers`) удаляются каскадом через родителей; их audit-строки содержат только структурные UUID и не входят в scope анонимизации (персональных данных в них нет).
- Снятие `legal_hold` не запускает удаление автоматически — Owner повторно жмёт выполнение.
