# 50: Реализовать Relationship и RelationshipDynamic

**What to build:** Специалист анализирует relationship между двумя клиентами, не раскрывая приватные данные одного другому.

**Goal:** Добавить relationship layer с отдельной consent и visibility boundary.

**Context:** Relationship analysis требует соответствующих assignments и consent обоих клиентов. Автоматическое раскрытие установки партнёра запрещено.

**Blocked by:** 05 — privacy policy; 13 — consent gates; 17 — Client; 27 — graph semantics.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать Relationship и RelationshipDynamic contracts.
2. Проверять tenant, assignments и consent для обоих clients.
3. Создать service, который формирует privacy-filtered evidence view.
4. Добавить specialist UI для relationship и dynamics.
5. Покрыть asymmetric permissions, revoke и leakage tests.

## Acceptance criteria

- [ ] Relationship связывает только разрешённых клиентов одной допустимой области.
- [ ] Dynamic не раскрывает private evidence клиента без его scope.
- [ ] Отзыв consent прекращает новые analyses и скрывает запрещённое.
- [ ] Client Portal никогда не получает данные партнёра напрямую.

## Checks

- [ ] Пройдены two-client permission matrix и indirect-leak tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
