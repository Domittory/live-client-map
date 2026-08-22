# 54: Реализовать CSV и JSON import

**What to build:** Специалист загружает структурированные диагностические данные и получает точный отчёт о принятых и отклонённых записях.

**Goal:** Обеспечить безопасный массовый import с versioned schemas.

**Context:** Даже структурированный import проходит через DiagnosticSession, validation, parsing и human review.

**Blocked by:** 08 — interchange contracts; 20 — DiagnosticSession; 32 — AI gateway; 33 — ingestSignals.

**Status:** ready-for-agent

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

- [ ] Пройдены canonical CSV/JSON fixtures и round-trip expectations.
- [ ] Repository-standard lint, typecheck и tests проходят.
