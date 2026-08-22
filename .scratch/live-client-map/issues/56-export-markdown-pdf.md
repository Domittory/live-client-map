# 56: Реализовать Markdown report и PDF snapshot

**What to build:** Специалист формирует читаемый отчёт и визуальный snapshot только из разрешённой версии модели.

**Goal:** Дать переносимый human-readable результат без новых AI-выводов.

**Context:** Layout и content contract определены тикетом 08. Historical export должен использовать выбранный immutable snapshot.

**Blocked by:** 08 — report contracts; 43 — Snapshots; 44 — approved explanations.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать общий privacy-filtered report read model.
2. Создать deterministic Markdown renderer.
3. Создать PDF renderer с устойчивой пагинацией и Unicode.
4. Добавить выбор snapshot и specialist export UI.
5. Добавить content, rendering и forbidden-field tests.

## Acceptance criteria

- [ ] Markdown и PDF представляют одну и ту же выбранную snapshot version.
- [ ] Report содержит evidence-aware explanations без private hidden data.
- [ ] PDF корректно отображает русский текст и длинные разделы.
- [ ] Генерация не меняет business state.

## Checks

- [ ] Выполнена visual QA canonical PDF fixtures.
- [ ] Repository-standard lint, typecheck и tests проходят.
