# 13: Реализовать ConsentRecord и consent gates

**What to build:** Специалист видит действующие согласия клиента, а защищённые операции блокируются при их отсутствии или отзыве.

**Goal:** Сделать consent исполняемым правилом, а не информационной записью.

**Context:** Использовать утверждённую policy из тикета 05 и типы согласий из SPEC.md.

**Blocked by:** 05 — privacy policy; 12 — assignments и RLS.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать versioned ConsentRecord с scope, grant и revoke.
2. Создать service guard для операций хранения, AI, supervisor, portal и relationship analysis.
3. Добавить UI просмотра, выдачи и отзыва согласия.
4. Записывать consent actions в audit boundary.
5. Покрыть отсутствующее, истёкшее и отозванное согласие.

## Acceptance criteria

- [ ] Каждая защищённая операция проверяет нужный consent type.
- [ ] История согласий не переписывается при новой версии документа.
- [ ] Отзыв блокирует новые запрещённые операции.
- [ ] UI ясно показывает scope и текущее состояние.

## Checks

- [ ] Пройдены allow/deny tests для всех consent types.
- [ ] Repository-standard lint, typecheck и tests проходят.
