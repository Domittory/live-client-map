# 04: Утвердить authentication, onboarding и Client Portal UX

**What to build:** Определить пользовательские потоки входа, приглашений и контролируемого доступа к Client Portal.

**Goal:** Устранить неопределённость вокруг identity flows до реализации Auth и портала.

**Context:** SPEC.md описывает роли и доступные клиенту данные, но не определяет способы входа, onboarding, восстановление доступа, приглашение клиента и структуру feedback forms.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Concrete steps

1. Выбрать способы authentication для organization members и клиентов.
2. Описать создание первого Owner и приглашение участников.
3. Описать отдельный identity flow Client Portal без organization membership.
4. Утвердить правила публикации данных клиенту и отзыва portal access.
5. Определить поля, статусы и маршрутизацию client feedback forms.

## Acceptance criteria

- [ ] Для каждой роли описан полный путь входа, выхода и восстановления доступа.
- [ ] Client Portal не требует прямого членства в Organization.
- [ ] Feedback forms имеют однозначный data и workflow contract.
- [ ] Решение одобрено владельцем проекта.

## Checks

- [ ] Потоки не дают клиенту доступ к private notes или base business tables.
- [ ] Тикеты 11, 12, 51 и 52 не требуют дополнительных UX-решений.

## Resolution

Решение одобрено владельцем проекта 2026-08-22.

**Способы входа (Supabase Auth):**

- Members (Owner/Specialist/Supervisor): email + пароль; восстановление — письмо со ссылкой сброса. OAuth в текущей версии не добавляется.
- Клиенты портала: только magic link на email; ссылка одноразовая, TTL 1 час; пароля у клиента нет.

**Onboarding:**

- Регистрация специалиста → создание организации → пользователь становится Owner.
- Приглашённые members — по потоку из тикета 02 (токен 7 дней).

**Client Portal identity:**

- Отдельная таблица `client_portal_users`: `id`, `client_id`, `email`, `status` (`active`/`revoked`), `invited_at`, `last_login_at`, `revoked_at`. Никакого membership в организации; один portal user = ровно один `client_id`.
- Доступ создаёт специалист с assignment; предусловие — активный `ConsentRecord` типа `client_portal`.
- Отзыв: выставление `revoked_at` мгновенно гасит все сессии клиента; данные клиента не удаляются.
- RLS: portal-сессия видит только записи своего `client_id` с `visibility = client_visible`. Private notes, raw AI hypotheses, hidden CoreNodes, risk assessments недоступны по определению (тикет 03, enum visibility).

**Client feedback forms:**

- Таблица `client_feedback_forms`: `id`, `client_id`, `created_by`, `title`, `questions` (jsonb: `{key, label, type, required}`; типы `scale_1_10`/`text`/`yes_no`), `answers` (jsonb), `status` (`draft`/`sent`/`completed`/`expired`), `sent_at`, `completed_at`, `expires_at` (default 14 дней).
- Workflow: специалист создаёт и отправляет → клиент заполняет в портале → ответы порождают Signals с `source_type = follow_up`, `epistemic_type = self_report`, `review_status = pending`. Автоматически в модель не попадают — только после review специалистом.

Тикеты 11, 12, 51 и 52 реализуются по этим потокам.
