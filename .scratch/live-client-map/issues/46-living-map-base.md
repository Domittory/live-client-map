# 46: Построить базовую Living Map

**What to build:** Специалист видит интерактивный граф CoreNodes, Themes, Resources, Triggers, Corrections и DevelopmentTargets.

**Goal:** Дать целостное визуальное представление текущей модели клиента.

**Context:** Graph edges должны происходить из сохранённых relations и links, а не вычисляться UI самостоятельно.

**Blocked by:** 27 — relations; 29 — Resources; 30 — DevelopmentTargets; 39 — Corrections; 43 — Snapshots.

**Status:** ready-for-agent

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

- [ ] Пройдены node/edge mapping и permission tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
