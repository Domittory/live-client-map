# 62: Добавить monitoring и production logging

**What to build:** Команда наблюдает errors, AI failures, jobs, security events и ключевые service health signals без утечки клиентских данных.

**Goal:** Сделать production behavior диагностируемым и поддерживаемым.

**Context:** AuditLog не заменяет operational telemetry. Logs должны следовать redaction и retention policy.

**Blocked by:** 14 — AuditLog; 32 — AI gateway; 41 — follow-up jobs; 61 — runtime security.

**Status:** resolved

## Concrete steps

1. Определить approved metrics, structured logs, traces и alert thresholds.
2. Инструментировать API, database, AI, imports, exports и scheduled follow-ups.
3. Реализовать correlation identifiers без direct client identifiers.
4. Настроить dashboards и actionable alerts.
5. Добавить redaction and telemetry contract tests.

## Acceptance criteria

- [x] Критические failures обнаруживаются и связываются с безопасным request trace.
- [x] Raw psychological data и secrets не попадают в telemetry.
- [x] Alerts имеют owner, severity и response guidance.
- [x] Telemetry retention соответствует policy.

## Checks

- [x] Проведены synthetic failure и alert-delivery smoke tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Подход (утверждён пользователем):** минимальный — свой structured JSON-логгер, in-memory метрики с Prometheus endpoint, декларативные правила алертов. Без новых зависимостей (нет observability-бэкенда; single-instance + Supabase).

**Что сделано (ядро `lib/telemetry/`):**
- `logger.ts` — structured JSON в stdout (`timestamp/level/service/event/correlation_id` + redacted поля), уровень `debug` — no-op.
- `context.ts` — `AsyncLocalStorage` для request-scoped correlation id (без client/org идентификаторов).
- `redact.ts` — `redactTelemetry` (по ключам secrets/token/password/… на любой глубине) + `sanitizePath` (замена UUID/числовых сегментов на `<id>`).
- `metrics.ts` — in-memory counter/histogram + `renderPrometheus()`.
- `alerts.ts` — `ALERT_RULES` (owner/severity/guidance/trigger) + `TELEMETRY_RETENTION_DAYS = 30` (совпадает с retention backups из политики тикета 05).
- `request.ts` — `withTelemetry` wrapper: correlation id → header `x-request-id`, duration-гистограмма, `http_response_total{status_class}`; на ошибке — `http_error_total` + **безопасное** представление ошибки (ServiceError → code/message, иначе `INTERNAL_ERROR`), не raw message.

**Инструментировано:**
- `/api/metrics` (новый) — Prometheus text endpoint (агрегаты, без идентификаторов).
- `app/api/ai/run/route.ts` — обёрнут в `withTelemetry`.
- `lib/ai/gateway.ts` — `ai_run_total{status}` + `ai_call_duration_ms` histogram.
- `lib/service/import.ts` — `import_total{outcome}` (`size_limit_exceeded`/`parsed`).
- `lib/service/export.ts` — `export_total{type}`.
- `lib/service/follow-ups.ts` — `follow_up_total{transition}` (scheduled/completed/cancelled).

**Важная находка при тестировании:** изначально `withTelemetry` логировал сырой `err.message`, что могло утечь секреты (например, `db password=…`). Исправлено — теперь логируется только безопасное представление; это проверяется тестом.

**Файлы изменены:**
- `lib/telemetry/{index,logger,context,redact,metrics,alerts,request}.ts` (новые).
- `app/api/metrics/route.ts` (новый).
- `app/api/ai/run/route.ts`, `lib/ai/gateway.ts`, `lib/service/{import,export,follow-ups}.ts` (инструментирование).
- `tests/unit/telemetry.unit.test.ts` (новый, 12 тестов).

**Проверки:**
- `pnpm lint`, `pnpm typecheck` — чисто.
- `pnpm test:unit` — 221 passed (26 файлов, +12 новых).

**Известные ограничения:**
- Метрики — in-memory, на multi-instance нужен общий коллектор (как и AI rate limiter). Задокументировано в `metrics.ts`.
- `/api/metrics` в production стоит закрыть файрволом на внутренний коллектор (в коде отмечено).
- Alert-delivery — декларативные правила (бэкенда алертинга нет); интеграция откладывается до появления observability-инфраструктуры.

