# 17: Завершить password recovery

**What to build:** Завершить безопасный password recovery journey от запроса письма до проверенной recovery session, смены пароля и входа с новым credential.

**Blocked by:** 02/Изолировать E2E-сервер и проверять service identity; 03/Закрыть critical/high production vulnerabilities.

**Status:** resolved

- [x] Recovery request задаёт явный allowlisted callback target и не раскрывает существование account.
- [x] Callback проверяет recovery session перед показом password-update form.
- [x] Expired, malformed и reused links приводят к безопасному понятному состоянию.
- [x] После успеха старый пароль не работает, новый работает, а navigation не допускает open redirect.
- [x] Browser tests проходят через локальный email capture service.

## Implementation result

### Что сделано

**Recovery request (`/forgot-password`).** Форма вынесена в клиентский компонент `forgot-password-form.tsx`, страница стала серверной и умеет показывать безопасное состояние `?error=link_invalid`. Server Action `resetPassword` больше не передаёт произвольный redirect: он берёт `Origin`/`Host` запроса и прогоняет его через явный allowlist (`lib/auth/recovery.ts`). Только разрешённый origin уходит в Supabase как `redirectTo`; недоверенный origin отбрасывается, и Supabase использует собственный `site_url`. Ответ всегда нейтральный (`sent: true`) независимо от того, существует аккаунт или нет; ошибки Supabase логируются только на сервере. `/forgot-password` добавлен в `PUBLIC_AUTH_PATHS`, иначе middleware уводил неаутентифицированного пользователя на `/login` (ссылка «Забыли пароль?» не работала).

**Callback (`/auth/confirm`).** Маршрут из ticket 15 расширен веткой `type=recovery` вместо второй, более слабой точки входа. Он вызывает `verifyOtp({ type: "recovery", token_hash })`; при успехе ставит recovery session и редиректит на фиксированный `/reset-password`, при ошибке (истёк, переиспользован, подделан токен) — на `/forgot-password?error=link_invalid`. `type` сверяется точно: recovery-токен не может открыть портал, magic-link-токен — форму пароля. `next` из query string в recovery-ветке не читается вообще, поэтому маршрут не может стать open redirect. Origin для редиректа берётся из proxy-заголовков (`x-forwarded-host`/`host`), как в ticket 15, чтобы cookie не терялась на `127.0.0.1`.

**Выпуск письма.** Добавлен шаблон `supabase/templates/recovery.html`, зарегистрированный в `supabase/config.toml` как `[auth.email.template.recovery]`. Письмо ведёт на `{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` (или на `{{ .SiteURL }}`, если `.RedirectTo` пуст). Путь callback’а зашит в шаблоне, а из приложения передаётся только allowlisted origin — это устойчиво к тому, что локальный GoTrue переписывает недоверенный redirect на `site_url` и отбрасывает путь. Изменение `config.toml` вступает в силу только после `supabase stop && supabase start` (выполнено).

**Password update (`/reset-password`).** Серверная страница сначала проверяет `auth.getUser()`: без сессии форма не рендерится (плюс сам маршрут не публичный, middleware требует вход). Форма шлёт Server Action `updatePassword`, который ещё раз проверяет сессию, минимальную длину и совпадение паролей, вызывает `updateUser({ password })` и делает редирект только на внутренний путь, прогнанный через `safeAuthRedirectPath`. `next` из query string санитизируется и на странице, и в действии.

**Авторизация.** Никаких миграций, RPC, membership или RLS-изменений нет: recovery меняет только пароль `auth.users`, поэтому сам по себе не выдаёт ни членство в организации, ни доступ к порталу. Это проверено браузерным тестом (состав `organization_members` и `client_portal_users` после сброса не меняется).

**E2E-инфраструктура.** Логика захвата писем вынесена из `e2e/support/portal.ts` в общий `e2e/support/mailpit.ts` (`waitForAuthLink`, `authConfirmUrl`); portal-хелперы стали тонкими обёртками с прежними именами. Новый спек `e2e/password-recovery.spec.ts` ходит в Mailpit (`:54324`) и проверяет полный journey.

### Files changed

- `lib/auth/recovery.ts` (new) — allowlist origin’ов, `recoveryRedirectTarget`, извлечение origin из заголовков.
- `lib/auth/onboarding.ts` — `/forgot-password` добавлен в публичные auth-пути.
- `app/auth/confirm/route.ts` — ветка `type=recovery`.
- `app/actions/auth.ts` — переписан `resetPassword`, добавлен `updatePassword`.
- `app/forgot-password/page.tsx` + `app/forgot-password/forgot-password-form.tsx` (new) — безопасное состояние `link_invalid`.
- `app/reset-password/page.tsx` (new) + `app/reset-password/reset-password-form.tsx` (new).
- `supabase/config.toml` + `supabase/templates/recovery.html` (new) — recovery email template.
- `e2e/support/mailpit.ts` (new), `e2e/support/portal.ts` — общий захват писем.
- `e2e/password-recovery.spec.ts` (new) — 6 браузерных тестов.
- `tests/unit/password-recovery.unit.test.ts` (new) — 13 unit-тестов.
- `tests/unit/portal-auth.unit.test.ts` — ожидание переведено на recovery-ветку.

### Validation

- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` → **101 файл / 736 тестов passed** (было 100/723; +1 файл и +13 тестов).
- `pnpm test:e2e` → **41 passed** (35 прежних + 6 новых). Новые: `resets the password through the emailed link and signs in with the new credential`; `does not reveal whether an account exists`; `rejects a reused reset link with a clear Russian message`; `rejects an expired or tampered reset link`; `never shows the password form without a verified recovery session`; `refuses to follow an external redirect after the password update`.
- `pnpm typecheck` → passed.
- `pnpm lint` → passed.
- `supabase stop && supabase start` → выполнено для перечитывания `config.toml` с новым шаблоном; ссылка из письма проверена вручную в Mailpit.

### Judgement calls / на проверку

1. **Production env:** allowlist читает `APP_ORIGIN` (или `NEXT_PUBLIC_APP_ORIGIN`). Если переменная не задана в production, `redirectTo` не передаётся и Supabase использует свой `site_url` — безопасно, но lead должен подтвердить, что в production `APP_ORIGIN` выставлен и совпадает с canonical-доменом.
2. **Путь callback’а живёт в шаблоне**, а не в действии (только origin передаётся в Supabase). Это сделано из-за поведения локального GoTrue: недоверенный/неполный redirect переписывается на `site_url` с потерей пути. Шаблон обязательно должен быть задеплоен вместе с приложением.
3. **Нейтральный ответ при ошибке:** `resetPassword` возвращает «письмо отправлено» даже при ошибке Supabase (логируется на сервере), чтобы гарантировать non-enumeration. Цена — реальный сбой отправки пользователю не виден.
4. **Recovery session остаётся активной** после смены пароля (стандартный UX). Отказ от open redirect проверяется через `next`.
5. **`/reset-password` доступен любому аутентифицированному пользователю**, а не только recovery-сессии: обычный пользователь тоже может сменить пароль. Дополнительных прав это не даёт (RLS/membership не меняются); отличать recovery-сессию по AMR не стали, т.к. acceptance criteria этого не требуют.

## Ревью ведущего

- **Защита от open redirect проверена по коду**: `normalizeOrigin` принимает только
  абсолютный `http(s)` origin без credentials/пути/query/fragment; в production
  доверяются только явно настроенные `APP_ORIGIN`/`NEXT_PUBLIC_APP_ORIGIN`
  (loopback — только вне production, чтобы работали dev и изолированный E2E).
  `next`/`redirectTo` из query string не читается; переход после смены пароля идёт
  через `safeAuthRedirectPath`, который возвращает только внутренние allowlisted
  пути. Путь callback'а зашит в шаблон письма, в Supabase уходит только origin.
- **Non-enumeration**: ответ на запрос восстановления одинаков для существующего и
  несуществующего адреса.
- **Сессия recovery проверяется до показа формы**: `/auth/confirm` сверяет
  `type=recovery`, форма пароля рендерится только при наличии сессии, действие
  перепроверяет сессию. Recovery сам по себе не выдаёт ни membership, ни доступ в
  портал; RLS не менялся.
- **Прогоны**: полный набор 101 файл / 736 тестов — зелёный; `pnpm test:e2e` —
  **41 тест** (6 новых recovery + 35 прежних); `pnpm typecheck`, `pnpm lint` —
  зелёные.
- **Действие для эксплуатации (важно)**: в production нужно задать `APP_ORIGIN`
  (canonical-домен приложения) и убедиться, что `site_url` в конфигурации Supabase
  совпадает. Если `APP_ORIGIN` не задан, приложение не передаёт `redirectTo`, и
  Supabase использует свой `site_url` — это безопасно, но ссылка может вести не на
  тот домен. Также шаблон письма (`supabase/templates/recovery.html`) должен
  деплоиться вместе с приложением; локально конфиг перечитывается только после
  `supabase stop && supabase start`.
