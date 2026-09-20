# 09: Создать client workspace с access management

**What to build:** Дать Specialist единый client-scoped workspace с навигацией и управлением assignments/consents, чтобы дальнейшие рабочие экраны открывались только в контексте выбранного Client.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными.

**Status:** resolved

- [x] Specialist открывает workspace конкретного Client и видит доступные разделы без ручного ввода client ID.
- [x] Owner или уполномоченный пользователь управляет ClientAssignments и consent из client context.
- [x] Unauthorized и unassigned пользователи получают безопасный denial без утечки client metadata.
- [x] Supervisor видит только явно назначенных Clients и доступные его роли действия.
- [x] Browser tests покрывают navigation, grant/revoke и немедленную потерю доступа.

## Implementation result

### Что реализовано

**1. Client workspace `/clients/[id]`**

- Общий серверный guard `requireClientWorkspace(clientId)` (`app/clients/[id]/workspace.ts`): проверяет сессию, формат UUID, читает клиента **через RLS** (`getClient`) и запрашивает эффективные права в БД (`is_client_accessible(org, client, false/true)`, `is_org_owner`). Любой отказ — `notFound()`: несуществующий клиент, чужой клиент и клиент без назначения неразличимы.
- `app/clients/[id]/not-found.tsx` — нейтральная страница «Клиент недоступен» без имени, статуса, id и любых других метаданных.
- `ClientWorkspaceHeader` (`app/clients/[id]/workspace-nav.tsx`): имя клиента, статус и навигация по разделам. Раздел показывается только если роль пользователя ей соответствует (`canUseSection`): `read` (обзор, запросы и цели, живая карта, диагностика, ресурсы, цель и смысл, рекомендации), `write` (ревью модели, импорт, согласия), `owner` (доступ). Ручного ввода client ID нет.
- Разделы, принадлежащие следующим тикетам, открыты как рабочие заглушки (навигация работает): `/clients/[id]/diagnostics`, `/import`, `/review`, `/resources`, `/purpose`, `/recommendations` — через `ClientSectionPlaceholder`, который повторяет и guard, и правило раздела.
- Существующие client-scoped страницы `/clients/[id]`, `/requests`, `/map` переведены на тот же guard и общий header, поэтому denial и навигация одинаковы во всём workspace.

**2. Управление доступами и согласиями в контексте клиента**

- `/clients/[id]/access` — Owner видит текущий ростер назначений (`list_client_assignments`) и выдаёт/отзывает доступ; client id приходит из маршрута (скрытое поле). Остальные роли видят нейтральный отказ раздела.
- `/clients/[id]/consent` — пользователь с правом записи (primary/secondary specialist или Owner) видит состояние согласий по типам и выдаёт/отзывает их через атомарные RPC `grant_consent` / `revoke_consent`.
- Организационные страницы `/access` и `/consent` больше не принимают `client_id` вручную: они показывают список доступных клиентов со ссылками в workspace. Список согласий на `/consent` дополнительно ограничен доступными клиентами, чтобы непривязанный участник организации не видел метаданные чужих клиентов.
- Server Actions `app/actions/assignments.ts` и `app/actions/consent.ts` переписаны: организация берётся из строки клиента (не из формы), клиент сначала читается через RLS, поэтому непривязанный/чужой пользователь получает то же нейтральное сообщение, что и при отсутствии клиента; ошибки маппятся по коду `ServiceError`. Из `grantAssignment` убран сервисный вызов `auth.admin.listUsers` (перечисление всех пользователей проекта) — участник ищется по email внутри организации через `organization_members` + `profiles` под RLS.

**3. Слой сервисов и БД (authorization truth — в базе)**

- Миграция `0045_client_workspace_access.sql`: `list_client_assignments(p_org_id, p_client_id)` — `SECURITY DEFINER`, `search_path = public`, только для Owner (то же правило, что у grant/revoke из 0040), с проверкой принадлежности клиента организации; `EXECUTE` только `authenticated`/`service_role`. Без неё ростер нельзя получить честно: RLS `client_assignments` отдаёт пользователю только его собственные строки. Вариант с service-role чтением отклонён — авторизация остаётся в БД.
- `lib/service/client-access.ts` (новый): `getClientAccessContext`, `listClientAssignments`, `findActiveMemberByEmail`, `grantClientAssignment`, `revokeClientAssignment` — все правила доступа живут в вызываемых RPC.
- `lib/service/consent.ts`: добавлены `listClientConsents`, `grantClientConsent`, `revokeClientConsent` (атомарные RPC через `runAtomicRpc`), существующие `hasConsent`/`requireConsent` не тронуты.
- RLS, consent-проверки и права не ослаблялись; ничего не добавлено «только в UI».

### Файлы

Добавлены: `supabase/migrations/0045_client_workspace_access.sql`, `lib/service/client-access.ts`, `app/clients/[id]/workspace.ts`, `app/clients/[id]/workspace-nav.tsx`, `app/clients/[id]/section-placeholder.tsx`, `app/clients/[id]/not-found.tsx`, `app/clients/[id]/access/page.tsx`, `app/clients/[id]/consent/page.tsx`, заглушки `diagnostics|import|review|resources|purpose|recommendations/page.tsx`, `app/access/labels.ts`, `app/consent/labels.ts`, `tests/integration/client-access.integration.test.ts`, `e2e/support/fixtures.ts`, `e2e/client-workspace.spec.ts`.

Изменены: `app/clients/[id]/page.tsx`, `app/clients/[id]/map/page.tsx`, `app/clients/[id]/requests/page.tsx`, `app/access/page.tsx`, `app/access/access-form.tsx`, `app/consent/page.tsx`, `app/consent/consent-form.tsx`, `app/actions/assignments.ts`, `app/actions/consent.ts`, `lib/service/consent.ts`, `app/globals.css`.

### Проверки

- `export DOCKER_HOST="unix:///Users/dmitryeliseev/.colima/default/docker.sock"; HOME="$TMPDIR/supabase-home" supabase db reset` — все миграции применились, включая `0045_client_workspace_access.sql`, seed выполнен.
- `pnpm typecheck` — успешно (`next typegen && tsc --noEmit`).
- `pnpm lint` — успешно (`eslint .` без замечаний, `prettier --check .` «All matched files use Prettier code style»).
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — **88 files / 604 tests passed** (было 87/593; +11 новых интеграционных тестов в `tests/integration/client-access.integration.test.ts`: access-context по ролям, ростер только для Owner, cross-tenant, поиск участника по email, grant/revoke с немедленной потерей доступа, consent по типам и запрет для supervisor).
- `pnpm test:e2e` — **7 passed (21.2s)** на изолированном dev-сервере из тикета 02:
  - `e2e/client-workspace.spec.ts` › specialist opens the client workspace and navigates sections without typing a client id
  - `e2e/client-workspace.spec.ts` › owner grants an assignment in the client context and the user gains access
  - `e2e/client-workspace.spec.ts` › revoking an assignment removes access on the next load
  - `e2e/client-workspace.spec.ts` › unassigned and foreign users get the same neutral denial
  - `e2e/client-workspace.spec.ts` › supervisor sees only assigned clients and no owner controls
  - `e2e/health.spec.ts` › readiness endpoint reports this application's identity, build and database
  - `e2e/health.spec.ts` › unauthenticated user is redirected to login

### Решения и что стоит проверить

1. **Ростер назначений только для Owner** (и чтение, и изменение). Это самое узкое правило, согласованное с 0040; остальные роли видят «Недостаточно прав». Если нужно, чтобы супервизор видел состав команды, это отдельное расширение RPC.
2. **Строка Owner в ростере** помечена «владелец организации» и не имеет кнопки «Отозвать»: доступ Owner идёт через owner-exception, отзыв его строки ни на что не влияет.
3. **Формы `app/access/access-form.tsx` и `app/consent/consent-form.tsx` переиспользованы на месте** (получили client-scoped props) вместо переноса файлов — чтобы не удалять файлы. Они импортируются из `/clients/[id]/access` и `/clients/[id]/consent`; при желании lead может перенести их в `app/clients/[id]/...`.
4. **RLS на `consent_records`** по-прежнему разрешает любому участнику организации читать согласия всех клиентов организации (политика из тикета 03). Организационная страница теперь фильтрует список по доступным клиентам, но на уровне БД это не закрыто — потенциальный follow-up, если требуется более строгая изоляция.
5. В `app/clients/[id]/evidence/...` guard не менялся (детальная страница вне области тикета): denial там по-прежнему через RLS + `notFound()`.
6. Заглушки разделов (`diagnostics`, `import`, `review`, `resources`, `purpose`, `recommendations`) намеренно пустые и будут заменены тикетами 10–13; guard и пункты навигации уже готовы.

## Ревью ведущего

Независимо проверено после реализации:

- **Guard workspace** (`app/clients/[id]/workspace.ts`) прочитан: проверка формата
  UUID → `getUser()` (иначе редирект на `/login`) → чтение клиента через `getClient`
  под RLS → `notFound()` и для несуществующего, и для недоступного клиента →
  дополнительная проверка `access.canRead` внутри приложения. Метаданные клиента
  не рендерятся до этой проверки, утечки «существует/не существует» нет.
- **Права в БД**: `anon` может выполнять только давний безопасный набор
  (`health_check`, RLS-хелперы, триггерные функции); новая `list_client_assignments`
  доступна только `authenticated`/`service_role`, owner-проверка и tenant-scoping
  внутри RPC.
- **Прогоны**: полный набор 88 файлов / 604 теста — 3 прогона подряд зелёные;
  `pnpm test:e2e` — 7 тестов (5 новых браузерных + 2 health); `pnpm typecheck`,
  `pnpm lint` — зелёные.
- **Побочно устранён флейк тестов**: причина — межфайловая интерференция fault
  injection (общий маркер без привязки к актору). Fault-строки теперь можно
  ограничивать актором (`actor = auth.uid()`), тесты тикета 07 переведены на это.
  Это делает rollback-тесты тикетов 04–08 воспроизводимыми, а не «проходящими
  вхолостую» из-за чужого fault.

### Замечание для владельца продукта (вне scope тикета)

RLS-политика `consent_records` («org members read consent», миграция 0006) разрешает
любому участнику организации читать согласия всех клиентов организации, независимо
от назначения. UI это не показывает, но на уровне БД это шире, чем
client-scoped доступ. Это существующее поведение, не внесённое этим тикетом;
если политика должна быть уже — нужен отдельный тикет на изменение RLS.
