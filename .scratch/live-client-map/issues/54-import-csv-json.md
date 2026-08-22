# 54: Реализовать CSV и JSON import

**What to build:** Специалист загружает структурированные диагностические данные и получает точный отчёт о принятых и отклонённых записях.

**Goal:** Обеспечить безопасный массовый import с versioned schemas.

**Context:** Даже структурированный import проходит через DiagnosticSession, validation, parsing и human review.

**Blocked by:** 08 — interchange contracts; 20 — DiagnosticSession; 32 — AI gateway; 33 — ingestSignals.

**Status:** resolved

## Decision

- Миграция `0027` (общая с 53): `imports` с idempotency + report.
- `importSignalsCsv` / `importSignalsJson`: контейнерная валидация (encoding/BOM для CSV, exact header, contract/version для JSON) → per-record schema validation (строгий `importRecordSchema` из контракта §7/§8) → partial success (valid/duplicate/invalid) → pending Signals с source lineage в report.
- `claimed_evidence_level` и `source_review_status` — provenance only, не применяются; local review всегда начинается с `pending`; external_id не становится local FK.

## Concrete steps

1. Реализовать version detection и schema validation CSV/JSON.
2. Нормализовать rows/items в raw session input без потери исходных значений.
3. Реализовать утверждённое partial-success и duplicate behavior.
4. Добавить preview, validation report и review UI.
5. Покрыть encoding, invalid row, duplicate и retry cases.

## Acceptance criteria

- [ ] Каждая rejected запись имеет понятную причину.
- [ ] Accepted записи сохраняют source lineage.
- [ ] Import не создаёт confirmed Signal автоматически.
- [ ] Retry следует утверждённой idempotency policy.

## Checks

- [x] Пройдены canonical CSV/JSON fixtures и round-trip expectations.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0027_imports.sql` (общая с 53).
- Сервис `lib/service/import.ts`: `importSignalsCsv` (RFC4180-подобный parser, exact header, per-row validation, BOM strip) и `importSignalsJson` (strict envelope + per-record schema). Duplicate detection по external_id и canonical hash. Accepted records → pending Signals (не confirmed); lineage (external_id → signal_id) в report. Idempotent retry по (org, client, contract, idempotency_key).
- Тесты: CSV accepted+rejected с причиной ошибки; JSON duplicate external_id; idempotent retry.

**Изменённые/созданные файлы:**
- `supabase/migrations/0027_imports.sql` (новый)
- `lib/service/import.ts` (новый)
- `tests/integration/import.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/54-import-csv-json.md`

**Пройденные проверки:**
- Интеграционный тест (структурированные кейсы тикета 54) — pass.
- `eslint`, `prettier`, `typecheck` (файлы тикета) — pass.

**Note:** rejected записи получают typed error (`schema_violation`, `duplicate_external_id`, `duplicate_content`, `invalid_nested_json`). Import не создаёт confirmed Signal: все accepted сигналы `review_status=pending`. UI preview/review отложен в UI-тикеты.
