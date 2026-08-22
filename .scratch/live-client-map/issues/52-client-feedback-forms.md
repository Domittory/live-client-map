# 52: Реализовать client feedback forms

**What to build:** Клиент отправляет согласованный feedback, а специалист видит его как отдельный источник follow-up данных.

**Goal:** Добавить controlled client input без автоматического изменения психологической модели.

**Context:** Поля и lifecycle берутся из решения 04. Feedback должен сохранять source и epistemic status и ожидать professional interpretation.

**Blocked by:** 04 — feedback contract; 13 — consent; 41 — FollowUp; 51 — Client Portal.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать approved feedback form contract и lifecycle.
2. Привязать submission к client, correction/follow-up и portal identity.
3. Добавить portal UI заполнения и подтверждения отправки.
4. Добавить specialist review UI без automatic model mutation.
5. Покрыть replay, duplicate, revoke и visibility cases.

## Acceptance criteria

- [ ] Feedback имеет однозначный source и submission timestamp.
- [ ] Клиент видит и отправляет только собственные forms.
- [ ] Submission не подтверждает hypothesis без review.
- [ ] Specialist может использовать feedback в FollowUp evaluation.

## Checks

- [ ] Пройдены ownership, idempotency и review-boundary tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
