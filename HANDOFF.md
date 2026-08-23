# Handoff — «Живая карта клиента»

Дата: 2026-08-23. Обновлено автономным агентом (Claude), работающим по `AUTOPILOT.md`, после закрытия тикетов 35–38, 45–48, 50–55, 57, 59.

## Статус тикетов

- **Resolved: 01–43, 45–48, 50–55, 57, 59** (56 тикетов).
- **Claimed: 44** (`explainModelChanges`) — сейчас делает другой агент (Kimi); в рабочем дереве есть его незакоммиченные файлы: `lib/service/explanations.ts`, `app/actions/explanations.ts`, `app/snapshots/explanations-forms.tsx`, `supabase/migrations/0036_model_explanations.sql`, тесты, правки `app/snapshots/page.tsx`, `lib/supabase/database.types.ts`, `44-explain-model-changes.md`. **Не трогайте эти файлы.**
- **Ready-for-agent: 49, 56, 58, 60–65** — все заблокированы цепочкой через 44:
  ```
  44 (claimed) ─► 49 (dynamics history UI)
              └─► 56 (markdown/pdf report) ─► 58 (consent revocation/erasure)
                                                 └─► 60–65 (RLS audit, security, monitoring, prod)
  ```

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
- Миграции, добавленные в этой сессии (коммичены до `0035`):
  - `0024` — `review_status`+`evidence_refs` в `resources` (AI updateResources, тикет 36)
  - `0025` — `recommendations` + `recommendation_targets` (тикет 37)
  - `0026` — `relationships` + `relationship_dynamics` (тикет 50)
  - `0027` — `imports` (импорт, тикеты 53/54)
  - `0033` — `client_portal_users` (тикет 51)
  - `0034` — `client_feedback_forms` (тикет 52)
  - `0035` — `safety_reviews` (тикет 59)

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

1. Миграции `NNNN_slug.sql`; **перед созданием** `ls supabase/migrations/` — занято до `0035` (плюс незакоммиченная `0036` у Kimi).
2. В каждой миграции: RLS + `grant ... to authenticated` + `grant ... to service_role`.
3. Интеграционные тесты — в `tests/integration/`, подключаются к `.env.local`, пропускаются без Supabase; каждый файл создаёт свою org/client и чистит `auth.admin.deleteUser`.
4. Сервисы типизируют строки локальными интерфейсами, не `Tables<"...">`.

## Gotchas

- **`current_role`** — зарезервировано в Postgres; пишется `"current_role"`.
- **`database.types.ts`** устаревает (не содержит таблицы после `triggers`); из-за этого падал typecheck в `interventions.ts` (`Tables<"intervention_methods">` → `never`). Используйте локальные интерфейсы.
- **PostgREST `not.in`**: `.not("status", "in", "(a,b)")` — без кавычек внутри скобок.
- **Idempotency импорта** (тикеты 53/54): ключ `16–128 printable ASCII` (`/^[ -~]+$/`); gateway кэширует одинаковые входы по `(org, client, contract, idempotency_key)` — в тестах с разными результатами делайте входной payload уникальным.
- **Полный `pnpm test` флакит** при параллельной работе агентов против одной локальной БД — свои файлы проверяйте изолированно.
- **prettier** иногда не доформатирует с первого раза — повторите `prettier --write <file>`.
- **AI-шлюз** (тикет 32): `runAiFunction(client, provider, {functionId, organizationId, clientId, payload})`; для тестов — `FakeAiProvider`/свой stub. Проверяет consent `ai_analysis` и активную `ontology_versions` (seed `0003`).
- **Параллельные агенты правят общие файлы** (`app/page.tsx`, `lib/env.ts`, `.env.example`, `database.types.ts`, `HANDOFF.md`, тикеты `.scratch/`). При ошибке «modified on disk» — перечитайте файл, не перезаписывайте чужие изменения.

## Куда дальше

- Когда **44** станет resolved — продолжить: **49 → 56 → 58 → 60–65**.
- UI-тикеты 45–48 имеют read-model + серверный UI; полноценный SVG-граф/интерактив и detail-экраны — в 49 и далее.
- Пароль восстановления и reset-password callback (тикет 11) всё ещё не завершены.
- `next@15.1.6` имеет CVE (CVE-2025-66478) — стоит обновить.
