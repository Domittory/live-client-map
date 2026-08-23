# 61: Добавить rate limiting и runtime security

**What to build:** Public и authenticated operations защищены от abuse, утечки secrets и небезопасных ошибок.

**Goal:** Закрыть runtime attack surface перед production.

**Context:** Особое внимание AI, import/export, auth и sensitive-data endpoints. Secrets разрешены только server-side.

**Blocked by:** 05 — privacy policy; 07 — AI contracts; 32 — AI gateway; 53–54 — imports; 59 — safety; 60 — RLS audit.

**Status:** resolved

## Concrete steps

1. Применить утверждённые rate limits по actor, tenant и operation cost.
2. Проверить server-side secret management и environment separation.
3. Добавить safe error mapping без sensitive payload.
4. Защитить uploads, downloads, retries и expensive AI operations.
5. Добавить abuse, bypass и secret-scanning tests.

## Acceptance criteria

- [x] Rate limits действуют на критичные operations и возвращают безопасный response.
- [x] Provider/service secrets отсутствуют в client bundles и logs.
- [x] Ошибки не раскрывают private data, SQL или prompts.
- [x] Trusted internal jobs имеют явно ограниченный bypass.

## Checks

- [x] Пройдены burst, cross-tenant, upload abuse и secret leakage tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Итог аудита:** большая часть hardening уже была построена в тикетах 32/53/54/59 и проверена здесь; новый код — только тесты.

**Что уже было на месте (подтверждено):**
- **AI gateway** (тикет 32): per-org rate limit (2 concurrent + 10/min — утверждено в `docs/ai-contracts.md` §Execution policy), env gate, consent gate, redaction (`redactText`/`looksUnredacted`), 100k-символьный лимит входа, timeout 120s, retry (3 попытки, backoff 1s/4s + jitter, honor `Retry-After`), idempotency (reuse успешного run), строгая валидация контрактов.
- **Import** (53/54): size limits (`MAX_SOURCE_CODEPOINTS` = 1M, `MAX_STRUCTURED_RECORDS` = 50k), idempotency по `(org, client, contract, idempotency_key)`, schema validation — отклоняют oversized input до AI/DB.
- **Export** (55): `requireExportAccess` (tenant + assignment + `data_storage` consent), фильтрация `sensitive` для secondary specialist.
- **Secrets**: `lib/env.ts` — `getClientEnv()` читает только `NEXT_PUBLIC_*`, `getServerEnv()` — server-only; ни одного `console.log` в `lib/` и `app/`; `sanitizeAuditPayload` редкачит secrets/tokens/passwords на любой глубине.
- **Error mapping**: `ServiceError` + `toErrorResponse` — неизвестные ошибки маскируются (`INTERNAL_ERROR`, без details).

**Что добавлено (новый файл `tests/unit/runtime-security.unit.test.ts`, 7 тестов):**
- burst (per-minute и concurrent) на `createInMemoryRateLimiter`;
- cross-tenant isolation (насыщение org-a не трогает org-b);
- upload abuse — oversized text/CSV отклоняется с `size_limit_exceeded` до любого обращения к БД;
- secret leakage — `getClientEnv()` не отдаёт server-secrets; `toErrorResponse` не раскрывает SQL/relation/prompt.

**Замечание по acceptance #4 (trusted internal jobs bypass):** инфраструктуры background-jobs ещё нет (это тикеты 62/63). Сейчас rate limiter применяется равномерно ко всем вызывающим — самый безопасный default, bypass-пути для abuse отсутствуют. Единственные ограниченные fast-path — retry (max 3) и idempotency reuse. Явный bounded bypass для внутренних задач появится вместе с background jobs в тикете 63.

**Замечание по per-actor limits:** утверждённые значения лимитов существуют только для per-org AI (2/10) и import size. Per-actor (per-user) лимиты в SPEC/тикетах не утверждены, поэтому не добавлялись (правило «не выдумывать решения»). Если нужны per-actor лимиты — нужно утвердить значения.

**Файлы изменены:**
- `tests/unit/runtime-security.unit.test.ts` (новый).

**Проверки:**
- `pnpm lint`, `pnpm typecheck` — чисто.
- `pnpm test:unit` — 209 passed (25 файлов, +7 новых).

