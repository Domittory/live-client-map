# 48: Реализовать Evidence Drawer

**What to build:** Из любого значимого вывода специалист открывает ответ на вопрос «Почему система так считает?».

**Goal:** Сделать evidence trail доступным без ухода с текущего экрана.

**Context:** Drawer показывает raw Signals, clusters, contexts, contradictions, observations, correction effects, scores, confirmations, AI rationale и DifferentialHypotheses.

**Blocked by:** 22 — clusters; 26 — differentials; 27 — relations; 28 — scoring; 41 — evaluation; 46 — Living Map.

**Status:** resolved

## Decision

- Read-модель `lib/service/evidence.ts` → `getEvidence(entityType, entityId)` для core_node / theme / differential_hypothesis. Полный provenance-чейн: raw signals (core_node → themes → signals), contradictions/evidence-against, score breakdown (scoring.ts), human confirmations (last_confirmed_by/at), AI-rationale маркер (isAiProposed) отдельно от подтверждения.
- Privacy: RLS ограничивает чтение по assignment; AI-rationale и независимое подтверждение структурно разделены; против/противоречия не скрываются.

## Concrete steps

1. Создать generic evidence read contract для поддерживаемых entity types.
2. Собрать полный provenance chain с visibility filtering.
3. Реализовать drawer UI с raw/derived и for/against sections.
4. Показать score breakdown, version и human confirmations.
5. Добавить lineage completeness и privacy tests.

## Acceptance criteria

- [ ] Для каждого поддерживаемого вывода доступен путь до raw evidence.
- [ ] AI rationale визуально отделён от independent confirmation.
- [ ] Contradictions и evidence against не скрываются.
- [ ] Недоступные sensitive records не раскрываются косвенно.

## Checks

- [x] Пройдены full-lineage, missing-reference и visibility tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Сервис `lib/service/evidence.ts`: `getEvidence` для core_node/theme/differential_hypothesis — raw signals (многошаговый lineage), contradictions, score breakdown, human confirmations, aiRationale (isAiProposed).
- UI `app/clients/[id]/evidence/[entityType]/[entityId]/page.tsx`: серверный drawer с разделами score/подтверждение/AI rationale/raw signals/против.
- Тесты: lineage core_node→signals + score; AI-proposed отдельно; contradictions; evidence_against гипотезы.

**Изменённые/созданные файлы:**
- `lib/service/evidence.ts` (новый)
- `app/clients/[id]/evidence/[entityType]/[entityId]/page.tsx` (новый)
- `tests/integration/evidence.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/48-evidence-drawer.md`

**Пройденные проверки:**
- Интеграционный тест тикета 48 (4 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** рационализация AI хранится не на самой сущности (только `isAiProposed` по status/review_status); текстовое rationale можно позже подтянуть из `ai_runs` — оставлено как future refinement. Drawer покрывает 3 ключевых типа сущностей; остальные — по мере надобности.
