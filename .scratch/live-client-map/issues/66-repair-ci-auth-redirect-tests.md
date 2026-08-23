# 66: Исправить CI auth redirect и запуск Supabase

**What to build:** Восстановить воспроизводимый GitHub Actions CI для Playwright auth redirect и integration tests против локального Supabase.

**Goal:** Устранить различия между локальным окружением и чистым CI без ослабления authentication middleware и без production secrets.

**Context:** В CI #1 job `Quality gates` запускает Playwright без обязательных Supabase client env, а `Integration tests (Supabase)` использует несовместимый Supabase CLI 2.20.3 через `supabase/setup-cli@v1`.

**Blocked by:** 09, 10, 11

**Status:** resolved

## Root cause

- В чистом checkout отсутствует игнорируемый `.env.local`, поэтому middleware получает пустые `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY` и падает до redirect.
- `supabase/setup-cli@v1` без `version` устанавливает CLI 2.20.3; текущий `supabase/config.toml` создан CLI 2.115.0 и содержит неподдерживаемые старой версией поля.
- После исправления startup новый CI выявил второй environment skew: Node.js 20 не предоставляет native `WebSocket`, необходимый текущему `@supabase/realtime-js`; локальные тесты проходили на Node.js 24.

## Decision

2026-08-23 владелец одобрил обновление всего проекта до Node.js 24 LTS вместо WebSocket polyfill или downgrade Supabase. Решение заменяет Node.js 20 из тикета 01.

## Acceptance criteria

- [x] E2E запускаются против реально запущенного локального Supabase.
- [x] Supabase CLI в CI закреплён на совместимой версии.
- [x] Auth middleware и существующий redirect test не отключены и не ослаблены.
- [x] CI не требует production Supabase secrets.
- [x] Repository-standard lint, typecheck, unit, integration и E2E checks проходят.

## Comments

- 2026-08-23: Владелец подтвердил рекомендованный вариант с локальным Supabase для E2E.
- 2026-08-23: CI run `32642219035` подтвердил успешный Supabase startup и выявил несовместимость Node.js 20 с native WebSocket.

## Implementation result

**Что сделано:**

- `supabase/setup-cli` обновлён с `@v1` до `@v2` и закреплён на CLI 2.115.0.
- Playwright E2E перенесены из `Quality gates` в Supabase job после `supabase start` и integration tests.
- E2E получает только безопасные настройки локального Supabase; production secrets не используются.
- В `docs/development.md` закреплена локальная версия Supabase CLI 2.115.0.
- Runtime проекта, CI и локальной разработки обновлён с Node.js 20 до Node.js 24 LTS.
- `@types/node` обновлён до major 24, а архитектурное решение зафиксировано в тикете 01.

**Изменённые файлы:**

- `.github/workflows/ci.yml`
- `.nvmrc`
- `package.json`
- `pnpm-lock.yaml`
- `README.md`
- `docs/development.md`
- `.scratch/live-client-map/issues/01-decide-technical-architecture.md`
- `.scratch/live-client-map/issues/66-repair-ci-auth-redirect-tests.md`

**Проверки:**

- `pnpm lint` — pass.
- `pnpm typecheck` — pass.
- `pnpm test` — 78 files, 465 tests passed против локального Supabase.
- Чистый CI-подобный Playwright запуск — 2 tests passed, включая unauthenticated redirect.
- Минимальный Supabase client repro — fail на Node.js 20, pass на Node.js 24.

**Известные ограничения:**

- Новый GitHub Actions run после runtime commit требуется для окончательной проверки runner-specific setup.
