# 32: Создать безопасный AI gateway

**What to build:** Все AI-вызовы проходят через единый server-side gateway со strict schemas, privacy controls, versioning и audit.

**Goal:** Не допустить прямых model calls из UI и разрозненных mega-prompts.

**Context:** Реализация следует решениям 05 и 07. Secrets остаются server-side; invalid output не попадает в business tables.

**Blocked by:** 07 — AI contracts; 10 — API foundation; 13 — consent gates; 14 — AuditLog.

**Status:** resolved

## Implementation result

**Что сделано:**
- Миграция `0009_ai_gateway.sql`: append-only таблица `ai_runs` (actor, request_id, idempotency_key, contract/prompt/ontology/scoring versions, provider, model snapshot, reasoning effort, input/output hashes, redaction version, status по typed failure states, token usage, latency). RLS: читают члены org, insert только с actor = auth.uid(); UPDATE/DELETE запрещены триггером всем. Raw prompt/response не хранятся.
- `lib/ai/contracts.ts`: strict request/response envelopes + отдельные versioned Zod-контракты для всех 11 AI-функций из docs/ai-contracts.md (unknown fields, invalid enums, scores вне 0–100 отклоняются; envelope mismatch contract_version/request_id отклоняется).
- `lib/ai/redact.ts`: стабильные placeholders (PERSON_1, ORGANIZATION_1, PLACE_1, DATE_1, AUTO_n для email/phone/ISO-date); mapping остаётся в памяти и не логируется; `looksUnredacted` — safety pre-check.
- `lib/ai/provider.ts`: интерфейс `AiProvider` (domain services не зависят от SDK), OpenAI Responses adapter (pinned snapshot gpt-5.5-2026-04-23, store=false, reasoning high, HMAC safety_identifier, без silent fallback), `FakeAiProvider` с инъекцией сбоев для тестов.
- `lib/ai/limiter.ts`: per-org лимиты (2 concurrent, 10/min), in-memory для single-instance dev.
- `lib/ai/gateway.ts` `runAiFunction`: env gate (production AI выключен без AI_PRODUCTION_ENABLED) → tenant/assignment check (`is_client_accessible`) → consent gate (`has_consent` ai_analysis) → redaction → 100k limit → rate limit → idempotency (reuse successful run по ключу без повторного вызова) → retry policy (3 attempts, 1s/4s + jitter, honor Retry-After; validation/consent/safety не retry) → strict output validation → persist run. Gateway не делает business mutations; `safety.review_required` → статус `needs_review`.
- API `POST /api/ai/run` — единственная серверная точка; provider secret читается из server env и не попадает в браузер.
- `lib/env.ts` + `.env.example`: `AI_PROVIDER` (default fake), `OPENAI_API_KEY`, `AI_PRODUCTION_ENABLED` (default false).

**Изменённые/созданные файлы:**
- `supabase/migrations/0009_ai_gateway.sql`
- `lib/ai/{contracts,redact,provider,limiter,gateway}.ts`, `lib/env.ts`, `.env.example`
- `app/api/ai/run/route.ts`
- `tests/unit/ai.unit.test.ts`, `tests/integration/ai-gateway.integration.test.ts`
- `lib/supabase/database.types.ts` (регенерирован)

**Пройденные проверки:**
- `supabase db reset` — чистая пересборка (0001–0010) OK
- `pnpm lint` / `pnpm typecheck` / `pnpm build` — pass; `pnpm test:e2e` — 2 passed
- `pnpm test` — 99 passed, включая gateway: no-consent (provider не вызывается), success + version metadata, malformed/unknown-fields → invalid_output без retry и без mutations, timeout → bounded retries → provider_timeout, 429 → provider_rate_limited, model unavailable → provider_model_unavailable, idempotency reuse (1 вызов вместо 2), safety → needs_review, per-org rate limit

## Concrete steps

1. Реализовать provider adapter и отдельный contract для каждой AI function.
2. Добавить consent check, redaction, schema validation и unknown-field rejection.
3. Реализовать timeout, retry, idempotency и structured failure states.
4. Сохранять model, prompt, schema versions и безопасную telemetry.
5. Добавить fake provider и contract/integration tests.

## Acceptance criteria

- [ ] UI никогда не получает provider secret.
- [ ] Invalid JSON, enum или score отклоняется до business mutation.
- [ ] Каждый вызов связан с consent, actor и version metadata.
- [ ] AI failure не оставляет partially confirmed entities.

## Checks

- [ ] Пройдены malformed output, timeout, retry и no-consent tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
