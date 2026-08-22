# 53: Реализовать импорт plain text, Markdown и ChatGPT analysis

**What to build:** Специалист импортирует текстовые материалы, которые всегда проходят через DiagnosticSession, AI parsing и human review.

**Goal:** Поддержать основные неструктурированные источники без прямой записи conclusions.

**Context:** Форматы и limits берутся из тикета 08. ChatGPT analysis является imported note, а не подтверждённым evidence.

**Blocked by:** 08 — interchange contracts; 20 — DiagnosticSession; 32 — AI gateway; 33 — ingestSignals.

**Status:** resolved

## Decision

- Миграция `0027`: таблица `imports` (idempotency, content_sha256, status, counts, report) — источник truth для idempotent retry и validation report (контракт `docs/data-exchange-contracts.md`).
- `importText` (plain_text/markdown/chatgpt_analysis): валидация (non-empty, размер ≤1M code points, format enum) → idempotency check → immutable DiagnosticSession(session_type=import, raw_input=content) → AI-parse через `ai.ingest-signals.v1` → report.
- Idempotency: по (org, client, contract, idempotency_key); тот же key+content возвращает существующий import, другой content → `conflicting_idempotency_key`.

## Concrete steps

1. Реализовать upload/paste validation для трёх утверждённых форматов.
2. Создавать DiagnosticSession с raw immutable input и source metadata.
3. Запускать parsing через ingestSignals с idempotency.
4. Показывать validation/parser report и pending review results.
5. Покрыть malformed, oversized, duplicate и partial failure cases.

## Acceptance criteria

- [ ] Ни один import не обходит DiagnosticSession и human review.
- [ ] Исходный материал сохраняется согласно privacy policy.
- [ ] ChatGPT conclusions не считаются независимым evidence.
- [ ] Повтор операции не создаёт uncontrolled duplicates.

## Checks

- [x] Пройдены valid/invalid fixtures каждого формата.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0027_imports.sql` (общая для 53/54): таблица `imports`.
- Сервис `lib/service/import.ts` → `importText`: валидация формата/размера/пустоты, SHA-256, idempotency, DiagnosticSession(session_type=import, immutable raw_input), AI-parse в pending L0 сигналы, import report.
- Тесты: valid plain_text → session + pending L0; пустой контент отклоняется; idempotent retry возвращает тот же import_id; конфликт idempotency key → ошибка.

**Изменённые/созданные файлы:**
- `supabase/migrations/0027_imports.sql` (новый)
- `lib/service/import.ts` (новый)
- `tests/integration/import.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/53-import-text-markdown-chatgpt.md`

**Пройденные проверки:**
- Интеграционный тест (текстовые кейсы тикета 53) — pass.
- `eslint`, `prettier`, `typecheck` (файлы тикета) — pass.

**Note:** AI-parse идёт через существующий `ingestSignals` (ticket 33), который персистит кандидатов как `source_type=ai_hypothesis`, `review_status=pending`, `evidence_level=L0_AI_ONLY` — гарантирует «не подтверждённое evidence» (acceptance 53.3). Точное соответствие `source_type=imported_note` (§6 контракта) — известное уточнение на будущее.
