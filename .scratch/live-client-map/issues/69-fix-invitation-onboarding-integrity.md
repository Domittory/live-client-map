# 69: Исправить целостность onboarding по приглашению

**What to build:** Приглашённый участник проходит цепочку регистрации или входа без потери
invite token, принимает приглашение и не остаётся в необратимом состоянии без Organization.

**Goal:** Восстановить надёжный invitation onboarding для новых и существующих пользователей,
сохранив текущие authentication, RLS и owner-only границы.

**Context:** Code review изменений `origin/main...HEAD` выявил два связанных дефекта в commit
`c2f65a3` (`fix: preserve invitation through auth flow`). В переходе
`/invite/<token> → /login → /signup` весь путь `/invite/<token>` передаётся как `inviteToken`, хотя
RPC `accept_invitation` ожидает только `<token>`. Кроме того, `signUp` создаёт Auth-пользователя до
проверки/принятия приглашения; ошибка token, срока действия или email оставляет пользователя без
Organization и без понятного recovery flow.

**Blocked by:** 02, 04, 11, 15

**Status:** needs-triage

## Requirements

- Сохранить утверждённый flow: незарегистрированный пользователь регистрируется по invite-ссылке
  и становится member приглашавшей Organization.
- Email пользователя должен совпадать с email приглашения; token имеет TTL 7 дней.
- Не ослаблять RLS, owner-only управление приглашениями и audit внутри `accept_invitation`.
- Не передавать service-role key в браузер и не раскрывать через публичную проверку существование
  конкретного email или Organization.
- Ошибка onboarding не должна оставлять пользователя в необратимом состоянии: он должен иметь
  безопасный способ повторить принятие действительного приглашения без повторной регистрации.

## Reproduction

1. Неавторизованным пользователем открыть `/invite/<token>`.
2. Нажать «войдите».
3. На `/login?redirectTo=/invite/<token>` нажать «Нет аккаунта? Зарегистрироваться».
4. Signup получает `invite=/invite/<token>`, затем отправляет это значение как `p_token`.
5. `accept_invitation` не находит приглашение, потому что ожидает `<token>`.

Отдельный failure case: открыть signup с просроченным, неверным или предназначенным другому email
token. Auth account создаётся раньше, чем RPC отклоняет приглашение.

## Decision required

Исправление затрагивает authentication/security, поэтому до реализации владелец должен выбрать и
зафиксировать подход.

### Вариант A — recoverable two-step flow (рекомендуется)

- Централизованно преобразовывать invite token и `/invite/<token>`; не смешивать эти значения.
- После signup/login/email confirmation возвращать пользователя на `/invite/<token>`.
- Принимать приглашение отдельным authenticated действием.
- Если принятие не удалось, сохранять аккаунт как допустимую identity без membership и показывать
  безопасный recovery: войти и открыть новое действительное приглашение.

Плюсы: не нужен service role в signup flow, существующий audited RPC остаётся источником истины,
ошибка восстанавливаема. Минус: создание identity и membership не является одной транзакцией.

### Вариант B — server-side pre-validation и компенсация

- До signup проверять token/email на сервере через привилегированный клиент.
- Если принятие приглашения после создания Auth-пользователя не удалось, удалять только что
  созданную identity как compensating action.

Плюс: сильнее приближает flow к атомарному. Минусы: service-role участвует в authentication path,
есть race conditions и destructive rollback; требуется отдельный security review.

## Acceptance criteria

- [ ] Цепочка `/invite/<token> → login → signup` передаёт в `accept_invitation` исходный `<token>`.
- [ ] Новый пользователь после регистрации принимает действительное приглашение и получает
      ожидаемые Organization membership и role.
- [ ] Существующий пользователь после входа возвращается к тому же приглашению и может его принять.
- [ ] Email confirmation, если включён, не теряет invite destination.
- [ ] Неверный, просроченный и email-mismatched token не дают membership и приводят к безопасному,
      понятному recovery state.
- [ ] Повторная попытка с новым действительным приглашением не требует создавать ещё один аккаунт.
- [ ] Redirect принимается только для внутренних разрешённых маршрутов; `/invite-anything` и
      `/login-copy` не становятся публичными из-за совпадения строкового prefix.
- [ ] Новый flow покрыт regression-тестами на уровне route/server action и integration test RPC.
- [ ] Существующие RLS, owner-only permissions и invitation audit не ослаблены.

## Checks

- [ ] Целевые regression-тесты воспроизводят оба дефекта до исправления и проходят после него.
- [ ] `pnpm lint` проходит.
- [ ] `pnpm typecheck` проходит.
- [ ] `pnpm test:unit` и `pnpm test:acceptance` проходят.
- [ ] `pnpm test:integration` проходит против запущенного локального Supabase.
- [ ] `pnpm build` проходит.
- [ ] `git diff --check` проходит.

## Comments

- Источник: двухосевое code review локальных восьми commits относительно `origin/main`,
  2026-09-06.
- Связанные требования: тикет 02 — регистрация по приглашению сразу создаёт membership; тикет 11 —
  partial onboarding не оставляет неконсистентные записи; тикет 15 — email приглашения должен
  совпадать и acceptance проходит через защищённый RPC.
