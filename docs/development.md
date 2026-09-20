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
pnpm typecheck:scripts   # tsc по scripts/ и lib/ (tsconfig.scripts.json)
pnpm test:unit           # Vitest: tests/unit (включая `pnpm audit:writes`)
pnpm test:smoke          # Vitest: tests/smoke (health smoke)
pnpm test:acceptance     # Vitest: tests/acceptance
pnpm test:integration    # Vitest: tests/integration (нужен запущенный Supabase)
pnpm test:integration:release  # то же, но serialized (--no-file-parallelism)
pnpm test:e2e            # Playwright (нужно предварительно: pnpm exec playwright install)
pnpm db:types            # генерация типов базы из схемы (нужен запущенный Supabase)
pnpm db:types:check      # проверка, что database.types.ts не устарел
pnpm audit:rpc-permissions  # права на RPC и search_path (нужна запущенная база)
pnpm release:ai-gate     # production AI выключен без approved decision
pnpm release:checklist   # release-checklist не заявляет готовность без подписи
pnpm verify              # три проверки выше одной командой (нужна запущенная база)
```

E2E-тесты запускают dev-сервер автоматически через `webServer` в `playwright.config.ts`.

## Release gate (`pnpm release:check`)

Одна команда для релиза: все блокирующие проверки выполняются в фиксированном порядке и падают на
первой ошибке (fail fast). Она печатает и записывает evidence: точный release SHA, sha256
`pnpm-lock.yaml`, timestamp и результат каждого gate.

```bash
# локально (нужен запущенный Supabase):
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"   # macOS + colima
supabase start
pnpm release:check

# только статические gates (быстро, без базы):
pnpm release:check:static

# только gates с базой:
pnpm release:check:database

# посмотреть порядок gate'ов:
node scripts/release-check.mjs --list
```

Требования к окружению: запущенный локальный Supabase (`supabase start`) и установленный браузер
Playwright (`pnpm exec playwright install chromium`, один раз). Gate сам подставляет Supabase CLI
временный `HOME` (CLI пишет telemetry в `$HOME/.supabase`, который может быть read-only), поэтому
настоящий `HOME` остаётся у Playwright и его кэш браузеров находится. Если у вас несколько
Docker-контекстов, задайте `DOCKER_HOST` до запуска; переопределить временный `HOME` для CLI можно
через `SUPABASE_GATE_HOME`.

Порядок и состав:

| Фаза       | Gates (по порядку)                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `static`   | `lockfile-install` → `dependency-audit` → `invariant-audit-writes` → `production-ai-disabled` → `checklist-integrity` → `documentation-integrity` → `lint` → `typecheck` → `typecheck:scripts` → `unit` → `smoke` → `acceptance` → `build` |
| `database` | `supabase-preflight` → `migration-clean-rebuild` → `migration-dry-run` → `schema-seed-rebuild` → `db-types-current` → `rpc-permissions` → `integration` → `e2e`                                                                            |

Почему именно так:

- **Install проверяется ровно зафиксированным lockfile** (`pnpm install --frozen-lockfile`), поэтому
  релиз нельзя собрать на скрытом dependency drift.
- **Production dependency audit** (`pnpm security:audit`, тикет 03) блокирует critical/high в
  production-дереве; детали — в [`dependency-security.md`](./dependency-security.md).
- **Invariant gates** (тикет 21) — `audit:writes`, `audit:rpc-permissions`, `db:types:check`.
- **`migration-clean-rebuild`** пересобирает локальную базу **только из миграций**
  (`supabase db reset --no-seed`) и сверяет `supabase_migrations.schema_migrations` с файлами
  `supabase/migrations/*.sql` — ни одной лишней, пропущенной или переименованной миграции.
- **`migration-dry-run`** выполняет `supabase db push --dry-run --local` — это ровно та команда,
  которую перед релизом прогоняют против staging и production (`--project-ref`), и она не должна
  показывать pending-миграций. Target-environment dry-run остаётся ручным gate с логом в
  [release-checklist.md](./ops/release-checklist.md), потому что требует secrets.
- **`integration`** запускается serialized (`pnpm test:integration:release` →
  `vitest run --no-file-parallelism`) и **валит gate, если vitest сообщает о skipped тестах**:
  общий локальный Postgres не выдерживает конкуренции параллельных файлов, а «пропущено» не должно
  выглядеть как «зелено».
- **`e2e`** — полный браузерный journey; в CI Playwright делает до 2 retry на инфраструктурных
  сбоях (это осознанная и ограниченная политика, `trace: on-first-retry`), локально retries = 0.

Evidence пишется в `.release/` (каталог в `.gitignore`):

- `.release/latest.json` — полный прогон `pnpm release:check`;
- `.release/latest-static.json` / `.release/latest-database.json` — фазовые прогоны (CI);
- `.release/<sha12>-<phase>-<timestamp>.json` — каждый прогон отдельно.

Evidence всегда **unsigned**: `signatureStatus: "unsigned"`, `humanSignature: null`, а все ручные
gates — `pending`. Генератор физически не умеет записать подпись. Подпись ставит человек в
[`docs/ops/release-checklist.md`](./ops/release-checklist.md) (тикет 24), а
`pnpm release:checklist` проверяет, что чек-лист не выглядит completed без timestamped evidence и
подписи. `pnpm release:checklist:complete` — строгий режим для приёмки релиза.

### Ограничение: production AI выключен

`AI_PRODUCTION_ENABLED` по умолчанию `false` (`lib/env.ts`), а `lib/ai/gateway.ts` в
`NODE_ENV=production` возвращает `blocked_environment`, пока переменная явно не равна `"true"`.
Gate `production-ai-disabled` (`scripts/check-production-ai.mjs`) дополнительно проверяет, что ни
один workflow/конфиг/caller не включает AI в обход, и что дефолт остаётся выключенным.

Чтобы production AI стало **можно** включить, должно измениться всё перечисленное:

1. появиться подписанное решение `docs/ops/ai-production-decision.md` со всеми полями: `Status:
approved`, `Approved by`, `Date`, `Provider`, `Data region`, `Retention`, `Processing agreement`,
   `Cross-border transfer`, `Production evaluation run (non-real data)`;
2. включение стать явным (значение `true` в deployment-окружении или изменённый дефолт), а не
   «случайным»;
3. runtime-гейт в `lib/ai/gateway.ts` сохраниться.

До этого non-AI части продукта работают, но пользователю должно быть явно видно ограничение.

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
scripts/                   # gate-скрипты: release-check, checklist, production-ai, audit-*
docs/ops/                  # deployment, backup/restore, release-readiness, release-checklist
.release/                  # evidence release gate (генерируется, в .gitignore)
.github/workflows/ci.yml   # CI quality gates (те же gates, что pnpm release:check)
```

## Environments

| Среда        | Описание                                                             |
| ------------ | -------------------------------------------------------------------- |
| `local`      | Supabase CLI (Docker) + `next dev`                                   |
| `test`       | CI: интеграционные тесты против локального Supabase в GitHub Actions |
| `staging`    | Vercel preview + Supabase Cloud `staging`                            |
| `production` | Vercel (`main`) + Supabase Cloud `production`                        |
