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

**Status:** resolved

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

### Решение для реализации

Выбран вариант A — recoverable two-step flow. Signup/login/email confirmation сохраняют invite
destination, а membership создаётся только отдельным authenticated вызовом существующего RPC.

## Acceptance criteria

- [x] Цепочка `/invite/<token> → login → signup` передаёт в `accept_invitation` исходный `<token>`.
- [x] Новый пользователь после регистрации принимает действительное приглашение и получает
      ожидаемые Organization membership и role.
- [x] Существующий пользователь после входа возвращается к тому же приглашению и может его принять.
- [x] Email confirmation, если включён, не теряет invite destination.
- [x] Неверный, просроченный и email-mismatched token не дают membership и приводят к безопасному,
      понятному recovery state.
- [x] Повторная попытка с новым действительным приглашением не требует создавать ещё один аккаунт.
- [x] Redirect принимается только для внутренних разрешённых маршрутов; `/invite-anything` и
      `/login-copy` не становятся публичными из-за совпадения строкового prefix.
- [x] Новый flow покрыт regression-тестами на уровне route/server action и integration test RPC.
- [x] Существующие RLS, owner-only permissions и invitation audit не ослаблены.

## Checks

- [x] Целевые regression-тесты воспроизводят оба дефекта до исправления и проходят после него.
- [x] `pnpm lint` проходит.
- [x] `pnpm typecheck` проходит.
- [x] `pnpm test:unit` и `pnpm test:acceptance` проходят.
- [x] `pnpm test:integration` проходит против запущенного локального Supabase.
- [x] `pnpm build` проходит.
- [x] `git diff --check` проходит.

## Implementation result

- Реализован вариант A: signup/login сохраняют `/invite/<token>` как redirect destination, а
  принятие invitation выполняется отдельным authenticated действием с raw UUID token.
- Добавлен общий normalization helper для invite token/path и route-boundary checks, чтобы
  `/invite-anything` и `/login-copy` не проходили как public/redirect routes.
- Signup больше не вызывает `accept_invitation` напрямую и не создаёт Auth identity для malformed
  invite path values; при email confirmation flow возвращает пользователя на login с сохранённым
  invite destination.
- Failed acceptance теперь показывает безопасный recovery state без раскрытия email или
  Organization existence.
- Изменены файлы: `lib/auth/onboarding.ts`, `app/actions/auth.ts`, `app/actions/admin.ts`,
  `app/login/page.tsx`, `app/signup/page.tsx`, `lib/supabase/middleware.ts`,
  `app/auth/callback/route.ts`, `tests/unit/auth-onboarding.unit.test.ts`,
  `tests/integration/admin.integration.test.ts`.
- Проверки: `pnpm lint`, `pnpm run typecheck`, `pnpm test:unit`, `pnpm test:acceptance`,
  `pnpm test:integration`, `pnpm build`, `git diff --check`, `pnpm test`.

## Comments

- Источник: двухосевое code review локальных восьми commits относительно `origin/main`,
  2026-09-06.
- Связанные требования: тикет 02 — регистрация по приглашению сразу создаёт membership; тикет 11 —
  partial onboarding не оставляет неконсистентные записи; тикет 15 — email приглашения должен
  совпадать и acceptance проходит через защищённый RPC.
- Реализация: выбран вариант A. Signup/login сохраняют `/invite/<token>` как destination, но RPC
  получает только UUID token через отдельное authenticated acceptance действие. Невалидные route
  prefix collisions отклоняются до auth signup; failed acceptance остаётся recoverable через новое
  действительное приглашение.
