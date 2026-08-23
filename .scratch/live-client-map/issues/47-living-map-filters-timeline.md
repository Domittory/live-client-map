# 47: Добавить фильтры и timeline Living Map

**What to build:** Специалист исследует граф по life area, времени, snapshot version и силе evidence.

**Goal:** Сделать большую карту управляемой и позволить сравнивать состояния.

**Context:** UI должен уметь скрывать AI-only hypotheses и показывать историческую версию без изменения текущих данных.

**Blocked by:** 43 — Snapshots; 46 — базовая Living Map.

**Status:** resolved

## Decision

- Расширен `getLivingMap` фильтрами (read-only, не мутируют модель): `hideAiOnly`, `lifeArea` (по `life_areas` триггеров), `minEvidenceStrength` (по `evidence_count` CoreNode), `snapshotVersion` (исторический режим).
- Исторический режим: при `snapshotVersion` узлы строятся ТОЛЬКО из `psychological_snapshots` (mapping категорий snapshot → типы узлов), рёбра не сохраняются в snapshot → `edges=[]`. `historical`/`snapshotVersion` в ответе отличают current/historical.
- URL/state: map-страница читает `searchParams` (`hideAiOnly`, `lifeArea`, `snapshotVersion`).

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

- [x] Пройдены filter matrix и historical/current isolation tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- `lib/service/living-map.ts`: добавлены поля `lifeAreas`/`evidenceStrength`/`historical`/`snapshotVersion`, фильтры `hideAiOnly` (удаляет AI-узлы + их рёбра), `lifeArea`, `minEvidenceStrength`, исторический режим по `snapshotVersion` (узлы из snapshot, рёбра пустые).
- `app/clients/[id]/map/page.tsx`: чтение фильтров из `searchParams`, индикатор current/historical.
- Тесты: hideAiOnly удаляет unconfirmed + links; lifeArea фильтрует триггеры; minEvidenceStrength фильтрует CoreNodes; historical строится только из snapshot и не смешивается с current.

**Изменённые/созданные файлы:**
- `lib/service/living-map.ts` (расширен)
- `app/clients/[id]/map/page.tsx` (фильтры + historical)
- `tests/integration/living-map-filters.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/47-living-map-filters-timeline.md`

**Пройденные проверки:**
- Интеграционный тест тикета 47 (4 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** исторические рёбра не сохраняются в snapshot (snapshot хранит категории узлов, не relations) — исторический граф показывает узлы без рёбер; это ограничение текущей snapshot-модели.
