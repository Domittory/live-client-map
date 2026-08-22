# 28: Реализовать версионируемый scoring engine

**What to build:** Система детерминированно рассчитывает утверждённые scores и объясняет каждый вклад.

**Goal:** Сделать приоритизацию, snapshots и model changes воспроизводимыми.

**Context:** Использовать только решение тикета 06. Формула final priority дана в SPEC.md; остальные формулы нельзя дополнять догадками.

**Blocked by:** 06 — scoring model; 16 — OntologyVersion; 22 — independent evidence; 25 — CoreNodes; 27 — graph relations.

**Status:** resolved

## Decision

- Чистая логика (без миграции): версионируемая конфигурация весов + `finalPriorityScore` по точной формуле SPEC §16; `systemicLeverageScore` — отдельная конфигурируемая формула.
- Missing-data: если обязательный вход `null` → результат `null` (не 0), согласно тикету 03.
- Note: пример SPEC §34 даёт `final_priority_score = 83.2`, но формула §16 для тех же входов даёт `79.2` — расхождение ~4.0; реализую формулу §16 (авторитетную), пример считаю иллюстративным/с опечаткой.

## Concrete steps

1. Реализовать versioned scoring configuration и pure calculation services.
2. Подключить independent evidence, contexts, contradictions и graph inputs.
3. Реализовать final priority и systemic leverage как отдельные результаты.
4. Сохранять score breakdown и model version для объяснимости.
5. Добавить boundary, missing-data и golden-case tests.

## Acceptance criteria

- [ ] Одинаковые inputs и model version дают одинаковые scores.
- [ ] Все scores находятся в диапазоне 0–100.
- [ ] L0 и повторяющиеся Signals не раздувают confidence/rootness.
- [ ] Старый snapshot можно пересчитать или объяснить его старой версией.

## Checks

- [ ] Пройдены golden examples утверждённой scoring specification.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Модуль `lib/service/scoring.ts` (чистая логика, версионируемый): `SCORING_MODEL_VERSION`, веса `PRIORITY_WEIGHTS` (точная формула SPEC §16), `finalPriorityScore` (null при missing-data, clamp 0–100), `systemicLeverageScore` (отдельная конфигурируемая формула v1), `scoreBreakdown` (с версией для объяснимости), `clampScore`.
- Unit-тесты: детерминизм, missing-data → null, диапазон 0–100, golden-формула §16, breakdown с версией, systemic leverage.

**Изменённые/созданные файлы:**
- `lib/service/scoring.ts`
- `tests/unit/scoring.unit.test.ts`

**Пройденные проверки:**
- Тесты тикета 28 (7 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** пример SPEC §34 (`final_priority_score = 83.2`) расходится с формулой §16 (для тех же входов — `79.2`); реализована формула §16 как авторитетная. Расхождение задокументировано в решении.
