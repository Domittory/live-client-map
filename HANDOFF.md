# Handoff — «Живая карта клиента»

Дата: 2026-08-23. Обновлено агентом (Kimi), работающим по `AUTOPILOT.md`, после закрытия тикета 39.

## Статус тикетов

- **Resolved: 01–39, 50, 53, 54** (42 тикетов).
- **Ready-for-agent: 40–49, 51, 52, 55–65** (23 тикета).
- Следующий незаблокированный по порядку — **40** (Observations / behavioral markers; блокеры 37–39 — resolved).

## Окружение (важно после перезагрузки)

- **Homebrew** `/opt/homebrew/bin`, **colima** (Docker), **Supabase CLI**, **docker CLI** установлены.
- Локальный Supabase запускается: `colima start` → `supabase start`; перед supabase-командами — `export PATH="/opt/homebrew/bin:$PATH"`.
- **pnpm** в `~/.local/bin/pnpm` (не в системном PATH — ставьте `PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"`).
- Node установлен v24 (engines в package.json — `>=20`); CI использует Node 20.
- `.env.local` (gitignored) содержит локальные ключи Supabase (`supabase start` их печатает).
- Playwright chromium установлен, `pnpm test:e2e` локально проходит (2 теста).

## Стек и ключевые решения

- Next.js 15 App Router + TypeScript, Supabase (Postgres), pnpm, `@supabase/ssr` (cookie-auth), `zod`, Vitest, Playwright.
- Auth: cookie-based через `@supabase/ssr` (решение в тикете 11 `## Decision`); сервисный ключ — только `lib/supabase/admin.ts` (`getServiceClient`).
- **Tenant boundary**: все доменные таблицы содержат `organization_id` + `client_id` (FK → `clients`). RLS через `is_client_accessible(org_id, client_id, require_write)` (membership AND assignment + owner exception) из тикета 12.
- **Forward-reference**: `client_id` в тикетах 12/13 был UUID без FK; FK добавлен в тикете 17 (`0008_clients.sql`).
- AI-created сущности: `review_status = pending`, `evidence_level = L0_AI_ONLY`, `source_type = ai_hypothesis` (SPEC §3.5). Детерминированные правила (тикеты 21/22/28) — authority для counts/scores.
- Библиотека методов (тикет 38): `intervention_methods` — system-записи (`organization_id null`) неизменяемы для тенантов, write только owner/specialist, soft-archive (архив читаем для старых Corrections). UI — `/methods`, API — `/api/intervention-methods`.

## Команды

```bash
pnpm lint              # eslint + prettier --check
pnpm typecheck         # tsc --noEmit
pnpm test:unit         # vitest tests/unit
pnpm test:smoke        # vitest tests/smoke
pnpm test:integration  # vitest tests/integration (нужен запущенный Supabase)
pnpm test:e2e          # playwright
pnpm db:types          # генерация lib/supabase/database.types.ts
supabase db reset      # пересборка локальной БД из миграций
supabase start/stop    # локальный Supabase
```

## Конвенции (соблюдать дальше)

1. Миграции нумеруются `NNNN_slug.sql`; **перед созданием проверяйте `ls supabase/migrations/`** — параллельные агенты занимают номера (занято до 0027).
2. В каждой миграции: RLS + `grant ... to authenticated` + `grant ... to service_role` (иначе тесты/админ падают с `permission denied`).
3. Сервисный слой в `lib/service/*.ts`: zod-schema (`validate`), `withAudit`/`recordAudit` для мутаций, `ServiceError` для ошибок, cursor-пагинация (`pageQuerySchema`, `toPage`).
4. Тесты интеграционные — в `tests/integration/`, подключаются к `.env.local`, пропускаются без Supabase.
5. Каждый тестовый файл создаёт свою организацию/клиента (рандомные slug/email — идемпотентность) и чистит `auth.admin.deleteUser`.
6. Сервисы типизируют строки локальными интерфейсами (supabase-клиент без generic), не через `Tables<"...">`.

## Gotchas

- **`current_role`** — зарезервированное слово Postgres; в SQL пишется `"current_role"`.
- **Полный `pnpm test` флакит** при параллельной работе нескольких агентов против одной локальной БД (ресурсный конкурс) — свои файлы проверяйте изолированно, потом повторяйте полный прогон. После тикета 39 полный прогон зелёный: 43 файла, 208 тестов.
- **Параллельные агенты правят общие файлы** (`app/page.tsx`, `lib/env.ts`, `.env.example`, `database.types.ts`, тикеты в `.scratch/`). Перед `Edit` перечитывайте файл при ошибке «modified on disk»; не перезаписывайте чужие изменения.
- **Нетипизированный supabase-клиент**: `data` из запросов — `any`; присваивание `any` не сужает union-типы (`let x: string | null` + `x = data.id` остаётся `string | null`) — так падал typecheck в `ai-cluster.ts` (исправлено).
- **prettier** иногда «не доформатирует» файл с первого раза — повторите `prettier --write <file>`.
- AI-шлюз (тикет 32): `runAiFunction(client, provider, {functionId, organizationId, clientId, payload})`; для тестов — `FakeAiProvider` / свой stub. Gateway проверяет consent `ai_analysis` и активную `ontology_versions` (seed в `0003`).

## Куда дальше

- **Тикет 40**: Observations и behavioral markers — фиксация наблюдений специалиста и поведенческих маркеров до/после Correction.
- UI-тикеты (45–49) почти не тронуты; пароль восстановления и reset-password callback не завершены (тикет 11).
- `next@15.1.6` имеет CVE (CVE-2025-66478) — стоит обновить до патченной версии.
