# 21: Реализовать интерпретацию Signal и EvidenceLevel

**What to build:** Система нормализует Signal по правилам polarity/test result, сохраняя raw statement и осторожный epistemic status.

**Goal:** Зафиксировать интеллектуально корректное базовое поведение до кластеризации и AI.

**Context:** Критический кейс SPEC.md: positive statement со stress означает stress around access, а не наличие ресурса или доказанный противоположный страх.

**Blocked by:** 20 — DiagnosticSession и manual Signals.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать детерминированные правила раздела 12 SPEC.md.
2. Сохранить raw statement отдельно от normalized meaning и inferred opposite.
3. Реализовать evidence levels L0–L7 как валидируемый contract.
4. Показать специалисту raw и normalized значения рядом.
5. Добавить table-driven tests, включая раздел 52.

## Acceptance criteria

- [ ] Positive + stress не создаёт Resource и не утверждает противоположную установку.
- [ ] Raw statement никогда не перезаписывается нормализацией.
- [ ] Neutral + stress требует дополнительного исследования.
- [ ] L0 AI-only не повышает evidence или confidence.

## Checks

- [ ] Пройден positive statement stress acceptance case.
- [ ] Пройдена матрица polarity × test result и repository quality gates.
