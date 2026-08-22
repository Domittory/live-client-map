# 33: Реализовать ingestSignals

**What to build:** Специалист отправляет raw input сессии на AI-разбор и получает валидированные pending Signals для проверки.

**Goal:** Ускорить ввод диагностики, сохраняя raw source и human control.

**Context:** Использовать exact contract тикета 07 и правила Signal из тикета 21. AI result не является независимым evidence до подтверждения.

**Blocked by:** 21 — Signal interpretation; 32 — safe AI gateway.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать ingestSignals service поверх отдельного gateway contract.
2. Привязать input/output к Client и DiagnosticSession.
3. Валидировать polarity, result, scores, life areas и evidence level.
4. Создавать только pending review Signals с сохранённым raw input.
5. Добавить review UI и contract/golden tests.

## Acceptance criteria

- [ ] Пример раздела 28 возвращает корректную осторожную нормализацию.
- [ ] Все AI-created Signals имеют pending review.
- [ ] L0/AI origin не повышает evidence до независимого подтверждения.
- [ ] Rejected result не влияет на модель.

## Checks

- [ ] Пройдены positive-stress, invalid JSON и review workflow tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
