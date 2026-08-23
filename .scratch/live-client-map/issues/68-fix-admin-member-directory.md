# 68: Исправить загрузку участников в администрировании

**What to build:** Владелец организации открывает раздел администрирования и видит участников с email без runtime error.

**Goal:** Устранить `Failed to list members` и закрыть реальный service seam regression-тестом.

**Context:** `listMembers` запрашивает PostgREST embedding `profiles(email)`, но в схеме нет прямого foreign key между `organization_members` и `profiles`. Локальный repro стабильно возвращает `HTTP 400 / PGRST200`.

**Blocked by:** 11, 14

**Status:** resolved

## Root cause

PostgREST умеет автоматически соединять таблицы только по известному foreign key. Обе таблицы отдельно ссылаются на `auth.users`, но не связаны напрямую друг с другом, поэтому `profiles(email)` не может быть разрешён.

## Decision

2026-08-23 владелец одобрил рекомендованное исправление: читать memberships и profiles двумя RLS-защищёнными запросами и соединять их по `user_id` внутри `listMembers`. Database migration не добавляется.

## Acceptance criteria

- [x] Owner получает список участников с email через `listMembers`.
- [x] Owner и обычный участник корректно различаются в результате.
- [x] Существующие owner-only permissions не ослаблены.
- [x] Раздел `/admin` больше не падает на загрузке участников.
- [x] Regression test воспроизводит ошибку до исправления и проходит после него.

## Checks

- [x] Целевой integration test проходит.
- [x] `pnpm lint` и `pnpm typecheck` проходят.
- [x] Полный test suite проходит.

## Comments

- Screenshot пользователя: Next.js runtime overlay с `[Server] Error: Failed to list members`.
- Исходный repro: embedded query дважды вернул `PGRST200`; scalar membership query вернул `HTTP 200`.

## Implementation result

**Что сделано:**

- `listMembers` больше не использует несуществующий PostgREST join `profiles(email)`.
- Memberships и разрешённые RLS profiles читаются двумя запросами и соединяются по `user_id`.
- Добавлен integration test для owner + specialist, их email и owner marker.

**Изменённые файлы:**

- `lib/service/admin.ts`
- `tests/integration/admin.integration.test.ts`
- `.scratch/live-client-map/issues/68-fix-admin-member-directory.md`

**Проверки:**

- RED: целевой test упал с `ServiceError: Failed to list members` до исправления.
- GREEN: `admin.integration.test.ts` — 6/6 passed после исправления.
- `pnpm lint` — pass.
- `pnpm typecheck` — pass.
- Полный suite в последовательном режиме — 78 files, 466 tests passed.
- `git diff --check` — pass.

**Примечание по локальному окружению:** параллельный `pnpm test` после нескольких полных прогонов
перегружал накопившую данные локальную test-базу и давал timeout в разных старых тестах. Все
затронутые timeout-сценарии прошли отдельно, а полный suite прошёл с одним worker. База не
сбрасывалась, чтобы не удалить пользовательские локальные данные.
