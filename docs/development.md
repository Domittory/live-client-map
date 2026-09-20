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
pnpm lint                # ESLint + Prettier check
pnpm audit:writes        # запрет mutation-then-audit в сервисном слое (без базы)
pnpm typecheck           # tsc --noEmit
pnpm test:unit           # Vitest: tests/unit (включая `pnpm audit:writes`)
pnpm test:smoke          # Vitest: tests/smoke (health smoke)
pnpm test:integration    # Vitest: tests/integration (нужен запущенный Supabase)
pnpm test:e2e            # Playwright (нужно предварительно: pnpm exec playwright install)
pnpm db:types            # генерация типов базы из схемы (нужен запущенный Supabase)
pnpm db:types:check      # проверка, что database.types.ts не устарел
pnpm audit:rpc-permissions  # права на RPC и search_path (нужна запущенная база)
pnpm verify              # три проверки выше одной командой (нужна запущенная база)
```

E2E-тесты запускают dev-сервер автоматически через `webServer` в `playwright.config.ts`.

## Аудит и атомарность мутаций

Правило (SPEC §44, миграция `0039_atomic_business_mutation.sql`): **составная бизнес-мутация
коммитит domain-строки, дочерние строки и запись AuditLog внутри одной транзакции** — одним
`SECURITY DEFINER` RPC, который сервис вызывает через `runAtomicRpc()`
(`lib/service/transaction.ts`). Причина: у Supabase JS нет клиентской транзакции, поэтому два
отдельных вызова (сначала `insert`, потом `recordAudit`) могут разорваться — строка останется
закоммиченной без записи аудита.

Что запрещено и что разрешено:

- **Запрещено**: писать domain state, а затем отдельно вызывать `recordAudit()`/`withAudit()`.
  Обёртка `withAudit()` удалена в тикете 21; `recordAudit()` остался только для путей, которые
  ничего не коммитят до аудита.
- **Разрешено (allowlist)**: read-only пути, где запись аудита — единственная запись вообще
  (экспорт CSV/архива, supervision-export, отчёт по snapshot). Если такой путь упадёт, коммитить
  нечего, поэтому unaudited-состояния не возникает. Каждый пункт перечислен с обоснованием в
  `scripts/check-unsafe-audit-writes.mjs` (`ALLOWED_READ_ONLY_AUDITS`).
- Новый `recordAudit(`/`withAudit(` без записи в allowlist **валит** `pnpm audit:writes` и
  `pnpm test:unit`. Комментарий allowlist-записи обязан объяснять, почему до аудита ничего не
  коммитится; ослабить проверку ради зелёного CI нельзя.
- Новый atomic RPC должен следовать конвенции 0039–0053: `security definer`,
  `set search_path = public`, актор из `auth.uid()`, проверки tenant/assignment/consent **внутри**
  RPC, `revoke all ... from public, anon` и минимальные `grant execute`, внутренние helper-функции
  не выдаются ролям клиента.

Проверки:

| Проверка                       | Где запускается                    | Что ловит                                                            |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------- |
| `pnpm audit:writes`            | CI job `quality`, `pnpm test:unit` | mutation-then-audit и незадокументированный `recordAudit()`          |
| `pnpm audit:rpc-permissions`   | CI job `integration`               | EXECUTE у `anon`, `search_path` у SECURITY DEFINER, helper у клиента |
| `pnpm db:types:check`          | CI job `integration`               | устаревший `lib/supabase/database.types.ts`                          |
| `atomic-*.integration.test.ts` | CI job `integration`               | rollback при сбое промежуточной записи и записи AuditLog             |

## Типы базы и контракты строк

- `lib/supabase/database.types.ts` **генерируется** (`pnpm db:types`) и не редактируется руками.
  Дрейф виден через `pnpm db:types:check` и тест
  `tests/integration/schema-verification.integration.test.ts`.
- Локальные интерфейсы строк в `lib/service/*.ts` остаются осознанной границей сервиса: они уже,
  чем полная строка таблицы (только нужные колонки). Их корректность проверяет компилятор во время
  `pnpm typecheck`, а не кодогенерация, поэтому `as any` для «подгонки» под сгенерированные типы
  недопустим.

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
