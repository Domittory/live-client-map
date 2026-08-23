# Разработка

Единый набор команд и требований к окружению. Источник решения — тикет `01-decide-technical-architecture`.

## Prerequisites

| Компонент    | Версия                   | Проверка             |
| ------------ | ------------------------ | -------------------- |
| Node.js      | 24 LTS                   | `node --version`     |
| pnpm         | 9 (см. `packageManager`) | `pnpm --version`     |
| Docker       | актуальная               | `docker --version`   |
| Supabase CLI | 2.115.0                  | `supabase --version` |

pnpm включается через Corepack: `corepack enable` (версия берётся из поля `packageManager` в
`package.json`). Docker и Supabase CLI требуются для локального Supabase — они вводятся в тикете 10,
а не в репозиторий-bootstrap.

## Установка из чистого checkout

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

После старта `GET http://localhost:3000/api/health` должен вернуть `{ "status": "ok", ... }`.

## Локальный Supabase

Запуск локальной базы (нужен Docker; на macOS — `colima start`):

```bash
colima start        # если Docker ещё не запущен
supabase start      # поднимает базу + сервисы и применяет миграции
supabase db reset   # чистая пересборка базы только из миграций
pnpm db:types       # генерация lib/supabase/database.types.ts
```

Ключи локального Supabase печатает `supabase start`; их кладут в `.env.local` (не коммитится) —
см. `.env.example`. Интеграционные тесты `pnpm test:integration` подключаются к локальной базе и
автоматически пропускаются, если Supabase не запущен.

## Обязательные команды (quality gates)

```bash
pnpm lint              # ESLint + Prettier check
pnpm typecheck         # tsc --noEmit
pnpm test:unit         # Vitest: tests/unit
pnpm test:smoke        # Vitest: tests/smoke (health smoke)
pnpm test:integration  # Vitest: tests/integration (нужен запущенный Supabase)
pnpm test:e2e          # Playwright (нужно предварительно: pnpm exec playwright install)
pnpm db:types          # генерация типов базы из схемы (нужен запущенный Supabase)
```

E2E-тесты запускают dev-сервер автоматически через `webServer` в `playwright.config.ts`.

## Структура репозитория

```
app/                      # Next.js App Router (UI + API routes)
  api/health/route.ts     # health smoke endpoint
  page.tsx                # application shell
lib/                       # чистая логика без framework-зависимостей
  service/                 # конвенции сервисного слоя (errors, validation, pagination, transaction)
  supabase/                # клиенты Supabase (browser/server) и сгенерированные типы БД
supabase/                  # миграции, seed, config.toml (Supabase CLI)
tests/unit/                # юнит-тесты (Vitest)
tests/smoke/               # smoke-тесты (Vitest)
tests/integration/         # интеграционные тесты против локального Supabase (Vitest)
e2e/                       # end-to-end тесты (Playwright)
.github/workflows/ci.yml   # CI quality gates
```

## Environments

| Среда        | Описание                                                             |
| ------------ | -------------------------------------------------------------------- |
| `local`      | Supabase CLI (Docker) + `next dev`                                   |
| `test`       | CI: интеграционные тесты против локального Supabase в GitHub Actions |
| `staging`    | Vercel preview + Supabase Cloud `staging`                            |
| `production` | Vercel (`main`) + Supabase Cloud `production`                        |
