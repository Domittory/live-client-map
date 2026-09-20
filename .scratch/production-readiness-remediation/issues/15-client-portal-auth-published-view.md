# 15: Завершить Client Portal authentication и published view

**What to build:** Дать Client Portal User отдельный time-limited authentication flow и privacy-filtered portal, который показывает только опубликованные summaries, approved DevelopmentTargets и client-visible Recommendations.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными.

**Status:** resolved

- [x] Portal identity входит по ограниченной по времени ссылке и не получает Organization membership.
- [x] Portal User связан ровно с разрешённым Client и не может читать base domain tables напрямую.
- [x] UI показывает только published/client-visible content и скрывает private notes, risks, pending AI output и DifferentialHypotheses.
- [x] Cross-client access запрещён, а revocation portal consent или access действует немедленно.
- [x] Browser tests покрывают login link, expiry/reuse, visible content и RLS denial.

## Implementation result

### Механизм входа (time-limited link)

Выбран **magic link (email OTP), запрашиваемый специалистом на сервере**, с проверкой
через собственный маршрут `/auth/confirm` по `token_hash`:

1. Специалист в разделе «Портал клиента» вводит email. Server action `invitePortalUser`
   вызывает атомарный `create_portal_user` (он же перепроверяет согласие `client_portal`),
   затем `supabase.auth.signInWithOtp({ email, shouldCreateUser: true, emailRedirectTo: <origin>/auth/confirm })`.
2. Supabase (локально — Mailpit на `http://127.0.0.1:54324`) отправляет письмо по шаблону
   `supabase/templates/magic_link.html`, который ведёт на
   `/auth/confirm?token_hash=<...>&type=magiclink` (секция `[auth.email.template.magic_link]`
   в `supabase/config.toml`).
3. `/auth/confirm` вызывает `verifyOtp({ type: "magiclink", token_hash })`, ставит
   SSR-сессию и редиректит на `/portal`; истёкшая/повторно использованная/поддельная
   ссылка ведёт на `/portal/login?error=link_invalid` с понятным русским сообщением.

Почему именно так: письмо запрашивается на сервере от имени специалиста, поэтому PKCE
`code verifier` остаётся в браузере специалиста и недоступен браузеру клиента — обмен
`?code=` на сессию у клиента невозможен. Проверка `token_hash` от этого не зависит и
работает в браузере, который открыл ссылку. Ссылка одноразовая (`otp_expiry`, по умолчанию
1 час): повторное использование отклоняется самим GoTrue.

### Что реализовано

- **Миграция `0049_client_portal_published_view.sql`**: SECURITY DEFINER RPC
  `get_client_portal_overview()` — резолвит portal identity по `auth.uid()`/email в ровно
  один активный `client_portal_users`, перепроверяет `client_portal` consent на каждом
  запросе и возвращает только опубликованные поля (client-visible notes, active
  DevelopmentTargets, approved + client_visible Recommendations, `corrections.client_visible_summary`).
  Внутренний helper `portal_client_id()` отозван у `public/anon/authenticated`. RLS базовых
  таблиц не ослаблен: portal identity по-прежнему не имеет прямого доступа (SPEC §43).
- **Portal UI**: `/portal`, `/portal/[clientId]` (несовпадающий client_id → нейтральный 404),
  `/portal/login` (публичная страница с русским сообщением об истёкшей/повторной ссылке).
  Проекция не содержит `specialist_notes_private`, `rationale`, `risk_notes`,
  `rank_rationale`, pending AI output и DifferentialHypotheses.
- **Управление доступом специалистом**: новый раздел «Портал клиента»
  (`/clients/[id]/portal`) — список portal-пользователей, выдача приглашения и отзыв;
  server actions `app/actions/portal.ts` не дают portal-пользователю становиться member
  организации (membership нигде не создаётся).
- **Auth-инфраструктура**: `app/auth/confirm/route.ts`, публичный путь `/portal/login`,
  `/portal` в allow-list редиректов, middleware направляет неавторизованный `/portal*` на
  `/portal/login`. Origin редиректа берётся из `Host`/`x-forwarded-host`, иначе host-only
  cookie сессии теряется при редиректе на внутренний `localhost`.
- **Сервис `lib/service/client-portal.ts`**: `getPortalOverview()` (путь portal identity),
  `listPortalUsers()`, проекция расширена `publishedSummaries`; `getClientPortal()` (путь
  специалиста) оставлен и синхронизирован.

### Файлы

Изменены/добавлены: `supabase/migrations/0049_client_portal_published_view.sql`,
`supabase/config.toml`, `supabase/templates/magic_link.html`, `lib/service/client-portal.ts`,
`app/auth/confirm/route.ts`, `app/actions/portal.ts`, `app/portal/*`,
`app/clients/[id]/portal/*`, `app/clients/[id]/workspace.ts`, `lib/auth/onboarding.ts`,
`lib/supabase/middleware.ts`, `tests/integration/client-portal.integration.test.ts`,
`tests/unit/portal-auth.unit.test.ts`, `e2e/portal.spec.ts`, `e2e/support/portal.ts`.

### Проверки

- `supabase db reset` — миграция 0049 применена.
- `pnpm typecheck` — успешно.
- `pnpm lint` (eslint + prettier --check) — успешно.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` —
  **99 файлов / 703 теста** зелёные.
- `pnpm test:e2e` — **30 тестов** зелёные, включая новые `e2e/portal.spec.ts`:
  1. `signs in through the time-limited link and shows only published content`
  2. `rejects a reused sign-in link with a clear Russian message`
  3. `rejects an expired or tampered link`
  4. `denies cross-client access`
  5. `loses access on the next request after revocation`
  6. `the portal browser session cannot read base domain tables`

### Замечания для ведущего (ticket 16)

- Шаблон письма применяется при **старте** Supabase: `supabase db reset` перезапускает
  контейнеры, но не перечитывает `config.toml` — требуется `supabase stop && supabase start`.
  В CI стоит `supabase start`, поэтому там шаблон применяется. E2E-хелпер на всякий случай
  умеет перенаправлять и дефолтную `/verify`-ссылку на `/auth/confirm`.
- В `.github/workflows/ci.yml` шаг **E2E tests** не передаёт `SUPABASE_SERVICE_ROLE_KEY`
  (в шаге integration он есть), а `e2e/support/fixtures.ts` без него бросает ошибку — это
  существовавший до ticket 15 разрыв, который стоит закрыть, иначе browser-тесты не
  выполняются в CI.
- `last_login_at` не обновляется (не требовалось). Если ticket 16 захочет показывать
  «последний вход», понадобится отдельный guarded-путь.
- Feedback-путь не тронут: `submit_feedback_form` по-прежнему авторизует активную portal
  identity по email, RLS-политика `client_feedback_forms` на чтение своих sent/completed
  форм сохранена; ticket 16 может строить UI поверх этой же сессии `/portal`.

## Ревью ведущего

- **Права проверены в БД**: `get_client_portal_overview` — `SECURITY DEFINER`,
  `anon` выполнять не может, доступен `authenticated`; внутренний
  `portal_client_id` недоступен никому из клиентских ролей. Общий список
  anon-доступных функций не изменился (8). RLS базовых таблиц не расширялся:
  портал получает только спроецированные «опубликованные/client-visible» поля, а
  прямой доступ к `signals`/`themes`/`core_nodes`/`differential_hypotheses`/
  `audit_log` для portal-идентичности запрещён — это отдельный браузерный тест.
- **Механизм входа**: magic-link (email OTP), запрашиваемый сервером, с проверкой
  через собственный `/auth/confirm` по `token_hash`. Это корректно для локального
  Supabase: PKCE-verifier остаётся в браузере специалиста и не может быть
  предъявлен браузером клиента. Ссылка одноразовая и истекает; повторное
  использование и подделанный токен отклоняются с русским сообщением.
- **Исправлен пробел в CI** (найден агентом, вне исходного скоупа): шаг
  `E2E tests` не передавал `SUPABASE_SERVICE_ROLE_KEY`, а новые (и уже
  существовавшие с тикета 09) браузерные фикстуры без него не работают — то есть
  в CI браузерные тесты не могли выполниться. Ключ добавлен в env шага; порядок
  шагов и остальные джобы не менялись.
- **Прогоны**: полный набор 99 файлов / 703 теста — зелёный; `pnpm test:e2e` —
  **30 тестов** (6 новых portal + 24 прежних); `pnpm typecheck`, `pnpm lint` —
  зелёные.
- **Замечание для эксплуатации**: локальный Supabase читает шаблон письма из
  `supabase/config.toml` только при `supabase start`; `supabase db reset`
  контейнеры перезапускает, но конфиг не перечитывает. В CI `supabase start`
  запускается с нуля, поэтому шаблон применяется; при локальной проверке после
  правки конфига нужен `supabase stop && supabase start`.
