# 29: Реализовать Resource

**What to build:** Специалист отдельно ведёт способности и опоры клиента с собственным evidence и динамикой.

**Goal:** Не смешивать problem reduction с resource development.

**Context:** Ослабление CoreNode не означает автоматическое усиление Resource. Positive + stress также не создаёт ресурс.

**Blocked by:** 17 — Client; 21 — Signal interpretation.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать Resource contract, lifecycle и visibility.
2. Создать services для ручного создания, evidence linking и обновления.
3. Добавить Resources UI с strength, confidence, trend и evidence summary.
4. Запретить автоматическое создание из ослабления проблемы.
5. Покрыть independence, evidence и permissions tests.

## Acceptance criteria

- [ ] Resource существует как самостоятельная сущность.
- [ ] Каждое изменение strength/confidence имеет evidence или human reason.
- [ ] CoreNode activation down не меняет Resource автоматически.
- [ ] Client visibility применяется отдельно от specialist view.

## Checks

- [ ] Пройдены no-automatic-resource regression tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
