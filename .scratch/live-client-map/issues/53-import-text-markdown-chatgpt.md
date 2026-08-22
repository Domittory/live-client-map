# 53: Реализовать импорт plain text, Markdown и ChatGPT analysis

**What to build:** Специалист импортирует текстовые материалы, которые всегда проходят через DiagnosticSession, AI parsing и human review.

**Goal:** Поддержать основные неструктурированные источники без прямой записи conclusions.

**Context:** Форматы и limits берутся из тикета 08. ChatGPT analysis является imported note, а не подтверждённым evidence.

**Blocked by:** 08 — interchange contracts; 20 — DiagnosticSession; 32 — AI gateway; 33 — ingestSignals.

**Status:** ready-for-agent

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

- [ ] Пройдены valid/invalid fixtures каждого формата.
- [ ] Repository-standard lint, typecheck и tests проходят.
