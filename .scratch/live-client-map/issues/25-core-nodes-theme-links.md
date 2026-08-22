# 25: Реализовать CoreNode и ThemeCoreNodeLink

**What to build:** Специалист создаёт корневую рабочую гипотезу и связывает её с поддерживающими Themes.

**Goal:** Представить CoreNode как проверяемую гипотезу, а не диагноз или вечную истину.

**Context:** CoreNode имеет сложный lifecycle, scores, evidence counts, visibility и human confirmation. Theme link хранит relationship type, confidence и rationale.

**Blocked by:** 24 — Themes и Signal links.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать CoreNode и ThemeCoreNodeLink contracts.
2. Реализовать разрешённые lifecycle transitions из data dictionary.
3. Создать services для ручного создания, review, link и archive.
4. Добавить CoreNodes UI с supporting и contradicting evidence.
5. Покрыть status, evidence lineage, visibility и permission tests.

## Acceptance criteria

- [ ] CoreNode отображается как рабочая гипотеза с confidence.
- [ ] Статус integrated нельзя установить только по факту Correction.
- [ ] Каждый Theme link имеет rationale и author.
- [ ] Rejected/archived узлы сохраняются в истории.

## Checks

- [ ] Пройдены lifecycle и evidence-lineage tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
