# 19: Реализовать LifeEvent и Trigger

**What to build:** Специалист отдельно фиксирует объективные жизненные события и события, активировавшие внутренний паттерн.

**Goal:** Сохранить различие LifeEvent != Trigger во всех слоях.

**Context:** LifeEvent может быть связан с Trigger, но не обязан им становиться. Source, visibility, intensity и timing должны сохраняться.

**Blocked by:** 17 — каталог и профиль Client.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать отдельные storage contracts и nullable link Trigger → LifeEvent.
2. Создать CRUD services с assignment, visibility и audit.
3. Добавить UI списка событий и явного создания Trigger из события или отдельно.
4. Показать связь без автоматической психологической интерпретации.
5. Добавить lifecycle, authorization и linkage tests.

## Acceptance criteria

- [ ] LifeEvent существует без Trigger.
- [ ] Trigger может существовать без LifeEvent или ссылаться на один LifeEvent.
- [ ] Создание LifeEvent не создаёт Trigger автоматически.
- [ ] Intensity, source и visibility валидируются.

## Checks

- [ ] Пройдены independent и linked entity scenarios.
- [ ] Repository-standard lint, typecheck и tests проходят.
