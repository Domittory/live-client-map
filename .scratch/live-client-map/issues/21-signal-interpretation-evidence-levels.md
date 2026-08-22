# 21: Реализовать интерпретацию Signal и EvidenceLevel

**What to build:** Система нормализует Signal по правилам polarity/test result, сохраняя raw statement и осторожный epistemic status.

**Goal:** Зафиксировать интеллектуально корректное базовое поведение до кластеризации и AI.

**Context:** Критический кейс SPEC.md: positive statement со stress означает stress around access, а не наличие ресурса или доказанный противоположный страх.

**Blocked by:** 20 — DiagnosticSession и manual Signals.

**Status:** resolved

## Decision

- Чистая логика (без миграции): детерминированная функция `interpretSignal(polarity, test_result)` по SPEC §12 + контракт `evidence_level` по SPEC §11 и маппинг confidence из тикета 06.
- `positive + stress` НЕ создаёт Resource и НЕ утверждает противоположную установку — только «стресс вокруг доступа» с осторожными гипотезами (SPEC §4).
- raw statement всегда хранится отдельно и не перезаписывается нормализацией.

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

## Implementation result

**Что сделано:**
- Модуль `lib/service/signal-interpretation.ts` (чистая логика, без миграции):
  - `interpretSignal(polarity, test_result)` — детерминированные правила SPEC §12; `positive+stress` даёт «стресс вокруг доступа» (не Resource, не утверждает противоположную установку — гипотезы помечены «не доказано»); `positive+no_stress` — лишь hint на ресурс; `neutral+stress` — требует исследования контекста.
  - `evidence_level` контракт L0–L7 (SPEC §11); `confidenceFromEvidenceLevel` (маппинг из тикета 06, L0 = 0); `contributesIndependentEvidence` (L0 = false, SPEC §3.5).
- Table-driven unit-тесты: матрица polarity×test_result, SPEC §52 case (positive+stress), evidence levels.

**Изменённые/созданные файлы:**
- `lib/service/signal-interpretation.ts`
- `tests/unit/signal-interpretation.unit.test.ts`

**Пройденные проверки:**
- `pnpm typecheck` — pass
- `pnpm lint` — pass
- Тесты тикета 21 (9 шт.) — pass.

**Note:** raw statement сохраняется отдельно (тикет 20) и не перезаписывается нормализацией — нормализация является производным полем.
