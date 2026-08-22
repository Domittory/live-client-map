# 10: Создать Supabase, migration и API/service каркас

**What to build:** Сквозной технический путь от приложения через service/API boundary к Supabase с автоматической проверкой.

**Goal:** Дать следующим вертикальным slices единый способ хранить, валидировать и получать данные.

**Context:** SPEC.md требует Supabase, RLS и реальные policies. Этот тикет создаёт инфраструктуру, но не добавляет психологические business entities.

**Blocked by:** 01 — technical architecture; 03 — domain data dictionary; 09 — repository bootstrap.

**Status:** resolved

## Concrete steps

1. Настроить локальный и test Supabase согласно решению 01.
2. Создать migration workflow, generated types и безопасную environment configuration.
3. Определить transaction, validation, error и pagination conventions service/API слоя.
4. Провести health behavior через приложение, service boundary и базу.
5. Добавить migration и integration test harness.

## Acceptance criteria

- [ ] Пустая база создаётся полностью из versioned migrations.
- [ ] Health behavior подтверждает доступность базы без раскрытия secrets.
- [ ] Validation и error responses имеют единый contract.
- [ ] Integration tests изолированы и воспроизводимы.

## Checks

- [ ] Migration apply, rollback policy и clean rebuild проверены.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Service/API-конвенции: единый error-contract (`errors.ts`), strict-валидация через Zod (`validation.ts`), cursor-pagination (`pagination.ts`), транзакции через RPC (`transaction.ts`, правило SPEC §44).
- Типизированный доступ к env (`env.ts`) + `.env.example`; секреты (service role key) не попадают в браузер.
- Supabase-клиенты (`client.ts`, `server.ts`) и сгенерированные типы БД (`database.types.ts`).
- Health-эндпоинт проверяет базу: `GET /api/health` → `{ status, service, version, database }`; при недоступной БД возвращает `"unavailable"` без падения и без раскрытия secrets.
- Миграция `0001_infra.sql` (расширение `pgcrypto` + `health_check()` c `security definer` и `set search_path = public`), `seed.sql`.
- Integration-тест против локального Supabase (пропускается без Supabase, подхватывает `.env.local`).
- CI: добавлен job `integration` (Supabase CLI → `supabase start` → `test:integration`).
- Скрипты: `test:integration`, `db:reset`, `db:types`.

**Изменённые/созданные файлы:**
- `lib/env.ts`, `lib/health.ts`, `lib/supabase/{client,server,database.types}.ts`
- `lib/service/{errors,validation,pagination,transaction,health}.ts`
- `app/api/health/route.ts`
- `tests/unit/{health,service}.unit.test.ts`, `tests/smoke/health.smoke.test.ts`, `tests/integration/health.integration.test.ts`
- `supabase/{migrations/0001_infra.sql,seed.sql,config.toml}`
- `.env.example`, `.env.local` (не коммитится), `package.json`, `eslint.config.mjs`, `.prettierignore`, `.github/workflows/ci.yml`, `docs/development.md`

**Пройденные проверки:**
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 16 passed (unit + smoke + integration против локального Supabase)
- `pnpm build` — production build OK
- `supabase db reset` — чистая пересборка базы только из миграций OK
- Runtime: `GET /api/health` → `database: "ok"` без раскрытия secrets
