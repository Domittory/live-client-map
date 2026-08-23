# Handoff — «Живая карта клиента»

Дата: 2026-08-23. Обновлено автономным агентом (Claude) после закрытия тикетов 49 (другим агентом), 56, 58, 63, 64 и 65.

## Статус тикетов

- **Resolved: 01–65** — все тикеты закрыты.
  - Последние закрытые: 60 (`RLS privilege audit`), 61 (`runtime security/rate limits`), 62 (`monitoring/logging`), 63 (`backup/staging/production`), 64 (`universal acceptance tests`), 65 (`production readiness journey`).

## Окружение (важно после перезагрузки)

- **Homebrew** `/opt/homebrew/bin`, **colima** (Docker), **Supabase CLI**, **docker CLI** установлены.
- Локальный Supabase: `colima start` → `supabase start`. Применить новую миграцию без `db reset`: `docker exec -i supabase_db_supabase psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/NNNN.sql` (`psql` напрямую не установлен).
- **pnpm** в `~/.local/bin/pnpm` — `export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"`.
- Node v24 (engines `>=20`); CI использует Node 20.
- `.env.local` (gitignored) содержит ключи локального Supabase.
- Playwright chromium установлен, `pnpm test:e2e` локально проходит.

## Стек и ключевые решения

- Next.js 15 App Router + TypeScript, Supabase (Postgres), pnpm, `@supabase/ssr` (cookie-auth), `zod`, Vitest, Playwright.
- **Tenant boundary**: все доменные таблицы `organization_id` + `client_id` (FK → `clients`); RLS через `is_client_accessible(org_id, client_id, require_write)`.
- AI-created: `review_status=pending`, `evidence_level=L0_AI_ONLY`, `source_type=ai_hypothesis` (SPEC §3.5). Детерминированные правила — authority для counts/scores.
- Сервисный слой `lib/service/*.ts`: zod `validate`, `recordAudit`/`withAudit` для мутаций, `ServiceError`, cursor-пагинация. Строки типизируют локальными интерфейсами, **не** `Tables<"...">` (`database.types.ts` устаревает).
- PDF-отчёт (тикет 56): `pdf-lib` + `@pdf-lib/fontkit`, шрифт Noto Sans в `assets/fonts/`, раскладка в чистом движке `lib/report/layout.ts`. Доставка синхронная.
- Erasure (тикет 58): hard delete каскадом от `clients` через service_role; `audit_log` обезличивается (`anonymize_client_audit`), `ai_runs` очищается отдельно (`purge_client_ai_runs`); `legal_hold` — колонка `clients`.

## Миграции (коммичены)

- `0024`–`0027`, `0033`–`0035` — см. предыдущий handoff (ресурсы, рекомендации, relationships, imports, portal, feedback, safety).
- `0036` — `model_explanations` (тикет 44).
- `0037` — `erasure_requests` + `clients.legal_hold` + переопределение триггеров `audit_log_immutable`/`block_mutation` под session-флаг `app.data_erasure` (тикет 58).
- `0038` — `rls_privilege_audit` (тикет 60).
- **Следующая миграция — `0039`** (проверяйте `ls supabase/migrations/` перед созданием). Тикет 63 миграций не добавлял — бэкапы через Supabase managed.

## Команды

```bash
pnpm lint              # eslint + prettier --check
pnpm typecheck         # tsc --noEmit
pnpm test:unit         # vitest tests/unit
pnpm test:integration  # vitest tests/integration (нужен запущенный Supabase)
pnpm test:e2e          # playwright
pnpm db:types          # генерация lib/supabase/database.types.ts
supabase db reset      # пересборка локальной БД из миграций
```

## Конвенции (соблюдать дальше)

1. Миграции `NNNN_slug.sql`; в каждой — RLS + `grant ... to authenticated` + `grant ... to service_role`.
2. Интеграционные тесты — в `tests/integration/`, подключаются к `.env.local`, пропускаются без Supabase; каждый файл создаёт свою org/client и чистит `auth.admin.deleteUser`. **Audit-запросы скопать по `organization_id`**, иначе `.single()` падает на строках из прошлых запусков (орги в БД остаются).
3. Сервисы типизируют строки локальными интерфейсами, не `Tables<"...">`.
4. Привилегированные мутации (hard delete, обход RLS) — через `getServiceClient()` (service_role); авторизацию и audit — через auth-клиент, т.к. `auth.uid()` под service_role = null.

## Gotchas

- **`current_role`** — зарезервировано в Postgres; пишется `"current_role"`.
- **`database.types.ts`** устаревает (не содержит таблицы после `triggers`); используйте локальные интерфейсы.
- **PostgREST `not.in`**: `.not("status", "in", "(a,b)")` — без кавычек внутри скобок.
- **Idempotency импорта** (тикеты 53/54): ключ `16–128 printable ASCII` (`/^[ -~]+$/`); gateway кэширует по `(org, client, contract, idempotency_key)`.
- **Полный `pnpm test` флакит** при параллельной работе агентов против одной локальной БД — свои файлы проверяйте изолированно.
- **prettier** иногда не доформатирует с первого раза — повторите `prettier --write <file>`.
- **AI-шлюз** (тикет 32): `runAiFunction(client, provider, {functionId, organizationId, clientId, payload})`; проверяет consent `ai_analysis` и активную `ontology_versions` (seed `0003`).
- **append-only триггеры**: `audit_log_immutable` (UPDATE/DELETE) и `block_mutation` (ai_runs). После тикета 58 оба пропускают операции только при `current_setting('app.data_erasure') = 'on'` (ставится внутри `anonymize_client_audit`/`purge_client_ai_runs`). Не «лечите» их удалением триггеров.
- **Параллельные агенты правят общие файлы** (`app/page.tsx`, `lib/env.ts`, `.env.example`, `database.types.ts`, `HANDOFF.md`, тикеты `.scratch/`). При ошибке «modified on disk» — перечитайте файл, не перезаписывайте чужие изменения.

## Открытые хвосты

- **Export-файлы/retention (§10 контракта)** всё ещё не реализованы: доставка экспортов (JSON/CSV/report) синхронная, нет таблицы `export_requests`, файлового хранилища и 30-дневного retention. В тикете 63 решено **вынести отдельным тикетом** — завести его следующим после 63; `erasure_requests.backup_marker` уже фиксирует для этого данные.
- **Пароль восстановления и reset-password callback** (тикет 11) не завершены.
- **`next@15.1.6`** имеет CVE (CVE-2025-66478) — обновить.

## Куда дальше

- Основная цепочка 01–65 закрыта — автономной реализации больше нет. Осталось только человеческое
  подписание production-готовности и разовые облачные шаги.
- **Владельцу (разово, требует облака и подписи):**
  1. Создать проекты Vercel + Supabase Cloud (`staging`, `production`) и завести секреты —
     `docs/ops/deployment.md`.
  2. Прогнать и подписать staging smoke, restore drill и release checklist —
     `docs/ops/release-checklist.md`.
  3. Закрыть открытые хвосты ниже.
- **Открытые хвосты:** export-файлы/retention (`export_requests` + 30 дней), reset-password
  callback (тикет 11), CVE `next@15.1.6`.
