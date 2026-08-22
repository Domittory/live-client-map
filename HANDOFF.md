# Handoff — «Живая карта клиента»

Дата: 2026-08-22. Автор: автономный агент (Claude), работающий по `AUTOPILOT.md`.

## Статус тикетов

- **Resolved: 01–34** (34 тикета).
- **Claimed (не я): 38** — intervention-method-library, делает другой агент (его файл
  `lib/service/interventions.ts` сейчас в незавершённом виде: type-ошибки + неотформатирован).
- **Ready-for-agent (следующие): 35, 36, 37, 39–65.**
- Следующий незаблокированный по порядку — **35** (AI CoreNodes + hypotheses; блокеры 25/26/27/28/34 — все resolved).

## Окружение (важно после перезагрузки)

- **Homebrew** `/opt/homebrew/bin`, **colima** (Docker), **Supabase CLI**, **docker CLI** установлены.
- Локальный Supabase запускается: `colima start` → `supabase start` (папка `supabase/`).
- **pnpm** в `~/.local/bin/pnpm` (не в системном PATH — ставьте `PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"`).
- Node установлен v24 (engines в package.json — `>=20`); CI использует Node 20.
- `.env.local` (gitignored) содержит локальные ключи Supabase (`supabase start` их печатает).

## Стек и ключевые решения

- Next.js 15 App Router + TypeScript, Supabase (Postgres), pnpm, `@supabase/ssr` (cookie-auth), `zod`, Vitest, Playwright.
- Auth: cookie-based через `@supabase/ssr` (решение в тикете 11 `## Decision`); сервисный ключ — только `lib/supabase/admin.ts` (`getServiceClient`).
- **Tenant boundary**: все доменные таблицы содержат `organization_id` + `client_id` (FK → `clients`). RLS через `is_client_accessible(org_id, client_id, require_write)` (membership AND assignment + owner exception) из тикета 12.
- **Forward-reference**: `client_id` в тикетах 12/13 был UUID без FK; FK добавлен в тикете 17 (`0008_clients.sql`).
- AI-created сущности: `review_status = pending`, `evidence_level = L0_AI_ONLY`, `source_type = ai_hypothesis` (SPEC §3.5). Детерминированные правила (тикеты 21/22/28) — authority для counts/scores.

## Команды

```bash
pnpm lint              # eslint + prettier --check
pnpm typecheck         # tsc --noEmit
pnpm test:unit         # vitest tests/unit
pnpm test:smoke        # vitest tests/smoke
pnpm test:integration  # vitest tests/integration (нужен запущенный Supabase)
pnpm test:e2e          # playwright (не запускался локально)
pnpm db:types          # генерация lib/supabase/database.types.ts
supabase db reset      # пересборка локальной БД из миграций
supabase start/stop    # локальный Supabase
```

## Конвенции (соблюдать дальше)

1. Миграции нумеруются `NNNN_slug.sql`; **перед созданием проверяйте `ls supabase/migrations/`** — параллельные агенты занимают номера (я переносил 0009→0010 и 0014→0015).
2. В каждой миграции: RLS + `grant ... to authenticated` + `grant ... to service_role` (иначе тесты/админ падают с `permission denied`).
3. Сервисный слой в `lib/service/*.ts`: zod-schema (`validate`), `recordAudit` для мутаций, `ServiceError` для ошибок.
4. Тесты интеграционные — в `tests/integration/`, подключаются к `.env.local`, пропускаются без Supabase.
5. Каждый тестовый файл создаёт свою организацию/клиента и чистит `auth.admin.deleteUser`.

## Gotchas

- **`current_role`** — зарезервированное слово Postgres; в SQL пишется `"current_role"`.
- **Полный `pnpm test` флакит** при параллельном запуске ~18 файлов против одной локальной БД (ресурсный конкурс) — гоняйте файлы по отдельности (`pnpm test:integration` — тоже норм, но бывают флаки ontology/admin). Свои файлы проверяйте изолированно.
- **Параллельные агенты правят общие файлы** (`app/page.tsx`, `lib/env.ts`, `.env.example`, `database.types.ts`, `ci.yml`). Не перезаписывайте их изменения; не форматируйте чужие файлы; не фиксите их ошибки.
- **prettier** иногда «не доформатирует» файл с первого раза — повторите `prettier --write <file>`.
- AI-шлюз (тикет 32): `runAiFunction(client, provider, {functionId, organizationId, clientId, payload})`; для тестов — `FakeAiProvider` / свой stub. Gateway проверяет consent `ai_analysis` и активную `ontology_versions` (seed в `0003`).

## Куда дальше

- Тикет 35: `ai.update-core-nodes.v1` + `ai.generate-differential-hypotheses.v1` + `ai.detect-contradictions.v1` (см. `lib/ai/contracts.ts`) — pending CoreNode/hypothesis proposals, запрет `causes` (тикет 27), confirmed entities не меняются без human review.
- UI-тикеты (45–49) ещё почти не тронуты; пароль восстановления и reset-password callback не завершены (тикет 11).
- `next@15.1.6` имеет CVE (CVE-2025-66478) — стоит обновить до патченной версии.
