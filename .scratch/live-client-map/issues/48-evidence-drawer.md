# 48: Реализовать Evidence Drawer

**What to build:** Из любого значимого вывода специалист открывает ответ на вопрос «Почему система так считает?».

**Goal:** Сделать evidence trail доступным без ухода с текущего экрана.

**Context:** Drawer показывает raw Signals, clusters, contexts, contradictions, observations, correction effects, scores, confirmations, AI rationale и DifferentialHypotheses.

**Blocked by:** 22 — clusters; 26 — differentials; 27 — relations; 28 — scoring; 41 — evaluation; 46 — Living Map.

**Status:** ready-for-agent

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

- [ ] Пройдены full-lineage, missing-reference и visibility tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
