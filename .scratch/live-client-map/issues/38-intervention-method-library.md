# 38: Реализовать InterventionMethod library

**What to build:** Специалист выбирает метод коррекции из управляемого каталога с противопоказаниями и сроком follow-up.

**Goal:** Отделить reusable method metadata от конкретной Correction.

**Context:** Каталог содержит system и organization methods. Contraindications должны быть видимы до планирования коррекции.

**Blocked by:** 10 — Supabase/API foundation; 13 — consent gates.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать InterventionMethod contract.
2. Поддержать system records и organization-scoped additions.
3. Создать list/search/create/edit/archive services и UI.
4. Показывать contraindications и default follow-up days.
5. Добавить RLS, audit и version-safe archive tests.

## Acceptance criteria

- [ ] Organization не изменяет system methods.
- [ ] Архивированный метод остаётся доступным старым Corrections.
- [ ] Contraindications видны при выборе.
- [ ] Доступ соответствует organization role.

## Checks

- [ ] Пройдены system/tenant isolation и archive-reference tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
