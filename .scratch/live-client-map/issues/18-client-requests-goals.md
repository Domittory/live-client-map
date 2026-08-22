# 18: Реализовать ClientRequest и ClientGoal

**What to build:** Специалист ведёт текущие запросы и долгосрочные цели клиента независимо от его профиля.

**Goal:** Дать модели явный текущий запрос, относительно которого позже рассчитывается relevance.

**Context:** ClientRequest и ClientGoal имеют разные назначения и жизненные циклы. Нельзя хранить их как свободные поля Client.

**Blocked by:** 17 — каталог и профиль Client.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать contracts, constraints и state transitions обеих сущностей.
2. Создать service/API operations для списка, создания, изменения статуса и progress.
3. Добавить requests/goals UI в контексте клиента.
4. Подключить assignment, visibility и audit.
5. Покрыть параллельные запросы, завершение и запрещённые переходы.

## Acceptance criteria

- [ ] У клиента может быть несколько запросов и целей с независимой историей.
- [ ] Active, paused, completed и abandoned transitions соответствуют data dictionary.
- [ ] Success criteria и current progress сохраняются без потери истории.
- [ ] Недоступный клиент не раскрывает requests или goals.

## Checks

- [ ] Пройдены lifecycle и authorization tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
