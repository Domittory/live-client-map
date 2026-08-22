# 11: Реализовать вход и создание Organization

**What to build:** Owner может безопасно войти и создать изолированное рабочее пространство Organization.

**Goal:** Получить первый демонстрируемый authenticated tenant flow.

**Context:** Использовать решения 02 и 04. Нельзя добавлять client data или расширенные роли до появления assignment policies.

**Blocked by:** 02 — platform contracts; 04 — auth UX; 10 — Supabase/API foundation.

**Status:** resolved

## Decision

**Авторизация (согласовано с владельцем проекта, вариант A):** `@supabase/ssr` для Next.js App Router. Сессия хранится в httpOnly-cookie; вход проверяется серверным middleware (`createServerClient` + `cookies()`); клиентские компоненты используют `createBrowserClient`; серверные действия — `createServerClient`. Сервисный ключ (service role) используется только в `getServiceClient` для привилегированных серверных операций (health-check) и не попадает в браузер.

## Concrete steps

1. Реализовать утверждённый sign-up, sign-in, sign-out и recovery flow.
2. Создать Organization и Owner membership атомарно.
3. Ограничить tenant-scoped reads и writes текущей Organization.
4. Добавить минимальный onboarding UI и authenticated landing state.
5. Покрыть tenant isolation и failure cases integration tests.

## Acceptance criteria

- [ ] Новый Owner создаёт Organization и попадает только в своё пространство.
- [ ] Неаутентифицированный пользователь не читает business data.
- [ ] Пользователь одной Organization не получает данные другой.
- [ ] Ошибка частичного onboarding не оставляет неконсистентные записи.

## Checks

- [ ] Пройдены auth smoke и cross-tenant denial tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Auth через `@supabase/ssr` (cookie-based, решение из раздела Decision): серверные действия sign-in / sign-up / sign-out / reset-password, middleware для защиты маршрутов.
- Миграция `0002_auth_organization.sql`: таблицы `profiles` (+триггер автосоздания), `organizations`, `organization_members`; RLS (изоляция по организации); RPC `create_organization` (создаёт организацию и членство Owner атомарно, `security definer` + `set search_path = public`); GRANT прав для ролей anon/authenticated.
- UI: `/login`, `/signup` (регистрация + создание организации), `/forgot-password`, защищённая главная `/` с authenticated landing.
- Integration-тесты: unauthenticated deny (создание и чтение), атомарное создание org+membership, cross-tenant denial.

**Изменённые/созданные файлы:**
- `supabase/migrations/0002_auth_organization.sql`, `lib/supabase/{client,server,admin,middleware}.ts`, `middleware.ts`
- `app/actions/auth.ts`, `app/{login,signup,forgot-password}/page.tsx`, `app/page.tsx`, `app/globals.css`
- `lib/service/health.ts` (переключён на `admin.ts`)
- `tests/integration/auth.integration.test.ts`, `e2e/health.spec.ts`
- `package.json` (+`@supabase/ssr`)

**Пройденные проверки:**
- `pnpm typecheck` — pass
- `pnpm test` — 29 passed (unit + smoke + integration; включая 4 auth/cross-tenant теста)
- `pnpm lint` — файлы этого тикета проходят; note: в репозитории появились 3 файла параллельной работы по другому тикету, не отформатированных prettier (не относятся к этому тикету)
