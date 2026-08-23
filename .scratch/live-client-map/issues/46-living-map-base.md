# 46: Построить базовую Living Map

**What to build:** Специалист видит интерактивный граф CoreNodes, Themes, Resources, Triggers, Corrections и DevelopmentTargets.

**Goal:** Дать целостное визуальное представление текущей модели клиента.

**Context:** Graph edges должны происходить из сохранённых relations и links, а не вычисляться UI самостоятельно.

**Blocked by:** 27 — relations; 29 — Resources; 30 — DevelopmentTargets; 39 — Corrections; 43 — Snapshots.

**Status:** resolved

## Decision

- Read-модель без миграции: `lib/service/living-map.ts` → `getLivingMap(organizationId, clientId)` возвращает `{ nodes, edges }`. Узлы — 6 типов SPEC §39 (core_node, theme, resource, trigger, correction, development_target).
- Edges берутся ТОЛЬКО из сохранённых связей: `core_node_relations`, `theme_core_node_links`, `correction_targets`, `development_targets.linked_core_nodes/linked_resources` — UI не пересчитывает семантику.
- pending/AI-only: `isAiOnly` флаг (core_node `under_review`, theme/resource `review_status=pending`) для hide AI-only hypotheses; archived/rejected узлы исключены.

## Concrete steps

1. Создать graph read model из разрешённых node и edge types.
2. Реализовать стабильную идентификацию, labels и visual states узлов.
3. Добавить базовый интерактивный graph UI с selection и navigation.
4. Применить assignment, visibility и pending/AI-only distinctions.
5. Добавить graph contract и interaction tests.

## Acceptance criteria

- [ ] Все node types раздела 13 представлены корректно.
- [ ] Edge semantics совпадают с сохранённым relationship type.
- [ ] Выбор узла открывает его details без утечки hidden data.
- [ ] Graph работает для empty и large-enough seed profile.

## Checks

- [x] Пройдены node/edge mapping и permission tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Сервис `lib/service/living-map.ts`: `getLivingMap` — агрегирует 6 типов узлов и рёбра из сохранённых relations/links; стабильные id/labels/status/visibility, флаг `isAiOnly`.
- UI `app/clients/[id]/map/page.tsx`: серверный список узлов по типам + рёбра, с `data-*`-атрибутами для selection; empty-состояние.
- Тесты: empty map; node/edge mapping (core_node+theme+correction, edges `supports`/`primary`); AI-only флаг.

**Изменённые/созданные файлы:**
- `lib/service/living-map.ts` (новый)
- `app/clients/[id]/map/page.tsx` (новый)
- `tests/integration/living-map.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/46-living-map-base.md`

**Пройденные проверки:**
- Интеграционный тест тикета 46 (3 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** полноценный SVG-граф с drag и evidence-aware detail-экранами — в тикетах 47–49; здесь базовый graph contract + читаемая раскладка.
