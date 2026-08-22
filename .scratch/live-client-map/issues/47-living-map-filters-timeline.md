# 47: Добавить фильтры и timeline Living Map

**What to build:** Специалист исследует граф по life area, времени, snapshot version и силе evidence.

**Goal:** Сделать большую карту управляемой и позволить сравнивать состояния.

**Context:** UI должен уметь скрывать AI-only hypotheses и показывать историческую версию без изменения текущих данных.

**Blocked by:** 43 — Snapshots; 46 — базовая Living Map.

**Status:** ready-for-agent

## Concrete steps

1. Добавить filters life area, evidence strength и AI-only visibility.
2. Добавить timeline и выбор snapshot version.
3. Обеспечить URL/state persistence согласованным способом.
4. Показать понятное отличие current и historical mode.
5. Добавить filter combination и snapshot switching tests.

## Acceptance criteria

- [ ] Фильтры комбинируются без изменения underlying model.
- [ ] Historical graph строится только из выбранного snapshot.
- [ ] Hide AI-only исключает неподтверждённые hypotheses и links.
- [ ] Возврат к current version восстанавливает актуальную карту.

## Checks

- [ ] Пройдены filter matrix и historical/current isolation tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
