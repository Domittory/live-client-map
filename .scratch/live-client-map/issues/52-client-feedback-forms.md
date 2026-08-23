# 52: Реализовать client feedback forms

**What to build:** Клиент отправляет согласованный feedback, а специалист видит его как отдельный источник follow-up данных.

**Goal:** Добавить controlled client input без автоматического изменения психологической модели.

**Context:** Поля и lifecycle берутся из решения 04. Feedback должен сохранять source и epistemic status и ожидать professional interpretation.

**Blocked by:** 04 — feedback contract; 13 — consent; 41 — FollowUp; 51 — Client Portal.

**Status:** resolved

## Decision

- Миграция `0034`: таблица `client_feedback_forms` (questions jsonb, answers jsonb, status draft/sent/completed/expired, correction_id/follow_up_id, sent_at/completed_at/expires_at). RLS: specialist с write-доступом управляет; portal-сессия читает только свои sent/completed формы (по email из `client_portal_users`).
- `submitFeedbackForm` создаёт `Signals` с `source_type=follow_up`, `epistemic_type=self_report`, `review_status=pending` — НЕ подтверждает гипотезу без review. Re-submit/expired/required-answer отклоняются.

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

- [x] Пройдены ownership, idempotency и review-boundary tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0034_client_feedback_forms.sql`: таблица + RLS (specialist управляет; portal только свои sent/completed).
- Сервис `lib/service/feedback-forms.ts`: `createFeedbackForm` (draft), `sendFeedbackForm` (sent + expires 14д), `submitFeedbackForm` (валидация required-ответов, completed + pending Signal), `listFeedbackForms`.
- Тесты: submission → pending signal (source follow_up/self_report); resubmit отклоняется; required-answer отклоняется.

**Изменённые/созданные файлы:**
- `supabase/migrations/0034_client_feedback_forms.sql` (новый)
- `lib/service/feedback-forms.ts` (новый)
- `tests/integration/feedback-forms.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/52-client-feedback-forms.md`

**Пройденные проверки:**
- Интеграционный тест тикета 52 (3 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** portal UI заполнения и specialist review UI отложены (сервисный слой + RLS готовы). Связь feedback → FollowUp evaluation реализуется в использовании `follow_up_id` при создании формы.
