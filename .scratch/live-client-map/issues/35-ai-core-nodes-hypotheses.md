# 35: Реализовать AI-обновление CoreNodes и гипотез

**What to build:** AI предлагает новые или изменённые CoreNodes, DifferentialHypotheses, relations и contradictions для human review.

**Goal:** Автоматизировать аналитический слой, не позволяя AI молча менять подтверждённую модель.

**Context:** Объединяет updateCoreNodes, generateDifferentialHypotheses и detectContradictions как отдельные contracts, а не mega-prompt.

**Blocked by:** 25 — CoreNodes; 26 — differential/contradictions; 27 — relations; 28 — scoring; 34 — AI classify.

**Status:** resolved

## Decision

- Без новой миграции: `core_nodes.status` уже содержит `under_review` (pending human review), а `differential_hypotheses.status='hypothesis'` — неподтверждённое состояние. Отдельный `review_status` для этих сущностей был бы избыточен и конфликтовал бы с lifecycle из тикета 25.
- AI-созданный CoreNode получает `status='under_review'`, counts остаются 0 (AI не раздувает evidence/contexts/rootness — SPEC §3.5).
- `action: update` применяется ТОЛЬКО к неподтверждённому узлу; подтверждённый (`active` и далее по lifecycle) не перезаписывается (SPEC §3.4) — human approval обязателен.
- `detectContradictions` персистится только как осторожная `contradicts` связь между двумя CoreNode (`core_node_relations`), никогда `causes`/`causes_confirmed` (SPEC §8.16). Противоречия между не-CoreNode сущностями advisory.

## Concrete steps

1. Реализовать три независимых AI services и их schemas.
2. Передавать independent evidence, existing model, contradictions и versions.
3. Создавать proposed Model mutations в pending review.
4. Запретить overwrite confirmed CoreNode без explicit review action.
5. Покрыть competing hypotheses, medical language и self-evidence cases.

## Acceptance criteria

- [ ] AI предлагает несколько объяснений при неоднозначности.
- [ ] Confirmed entities не меняются до human approval.
- [ ] AI-generated hypothesis не повышает собственные counts/scores.
- [ ] Forbidden causes relation отклоняется validation layer.

## Checks

- [x] Пройдены acceptance cases 51.1, 51.4, 51.5 и 55.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Сервисный слой `lib/service/ai-model.ts` с тремя независимыми AI-функциями (не mega-prompt): `updateCoreNodes`, `generateDifferentialHypotheses`, `detectContradictions` — каждый идёт через safe AI gateway и персистит только неподтверждённые мутации.
- `updateCoreNodes`: создаёт CoreNode со `status='under_review'` и counts=0 (AI не раздувает evidence — SPEC §3.5, acceptance 51.1); `action: update` пропускает подтверждённые узлы (acceptance «confirmed не меняются до human approval»); линкует themes.
- `generateDifferentialHypotheses`: несколько конкурирующих гипотез сосуществуют без winner (SPEC §55); confidence понижается детерминированно по `confidenceWithContradictions` (SPEC §51.4).
- `detectContradictions`: персистит только `contradicts` связи между CoreNode, никогда `causes` (acceptance «forbidden causes отклоняется»); не-CoreNode противоречия advisory (acceptance 51.5 «данных недостаточно»).

**Изменённые/созданные файлы:**
- `lib/service/ai-model.ts` (новый)
- `tests/integration/ai-model.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/35-ai-core-nodes-hypotheses.md`

**Пройденные проверки:**
- Интеграционный тест тикета 35 (4 шт.) — pass (under-review без inflate counts; confirmed не перезаписывается; 3 competing hypotheses + понижение confidence −2×10; contradicts-only relation).
- `pnpm exec eslint` на файлах тикета — pass.
- `prettier --write` на файлах тикета — pass.
- `pnpm typecheck` — файлы тикета чистые; note: глобальные ошибки в `lib/service/interventions.ts` (ticket 38, другой агент) и `lib/service/ai-cluster.ts:137` (предсуществующий null-narrowing в ticket 34).

**Note:** подтверждённый CoreNode (`active` и далее по lifecycle тикета 25) не перезаписывается AI — изменение требует явного human review-действия.
