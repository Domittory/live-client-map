# 18: Реализовать ClientRequest и ClientGoal

**What to build:** Специалист ведёт текущие запросы и долгосрочные цели клиента независимо от его профиля.

**Goal:** Дать модели явный текущий запрос, относительно которого позже рассчитывается relevance.

**Context:** ClientRequest и ClientGoal имеют разные назначения и жизненные циклы. Нельзя хранить их как свободные поля Client.

**Blocked by:** 17 — каталог и профиль Client.

**Status:** resolved

## Decision

- `client_requests` и `client_goals` добавляют `organization_id` (tenant boundary, тикет 03) + `client_id` (FK → clients).
- RLS: read = `is_client_accessible(org, client, false)`, write = `is_client_accessible(org, client, true)`.
- Переходы статусов валидируются на сервисном уровне (готового data-dictionary документа из тикета 03 нет): request `active→paused/completed/abandoned`, `paused→active/completed/abandoned`, `abandoned→active`, `completed` терминальный; goal `active→completed/archived`, `completed→archived`, `archived→active`.

## Concrete steps

1. Реализовать contracts, constraints и state transitions обеих сущностей.
2. Создать service/API operations для списка, создания, изменения статуса и progress.
3. Добавить requests/goals UI в контексте клиента.
4. Подключить assignment, visibility и audit.
5. Покрыть параллельные запросы, завершение и запрещённые переходы.

## Acceptance criteria

- [ ] У клиента может быть несколько запросов и целей с независимой историей.
- [ ] Active, paused, completed и abandoned transitions соответствуют data dictionary.
- [ ] Success criteria и current progress сохраняются без потери истории.
- [ ] Недоступный клиент не раскрывает requests или goals.

## Checks

- [ ] Пройдены lifecycle и authorization tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0010_client_requests_goals.sql` (номер 0010 — `0009` заняла параллельная работа по AI gateway): таблицы `client_requests` (title, life_areas, priority, status active/paused/completed/abandoned, success_criteria, current_progress, started_at/completed_at) и `client_goals` (title, importance, target_state, status active/completed/archived); RLS через `is_client_accessible(org, client, false/true)`; права.
- Сервисный слой `lib/service/requests.ts`: create/list для обеих сущностей, `changeRequestStatus`/`changeGoalStatus` с валидацией переходов, audit через `recordAudit`.
- Серверные действия create request/goal + смена статуса; UI `/clients/[id]/requests`.
- Тесты: несколько запросов/целей с независимой историей, запрещённый переход, отказ доступа без assignment.

**Изменённые/созданные файлы:**
- `supabase/migrations/0010_client_requests_goals.sql`
- `lib/service/requests.ts`
- `app/actions/requests.ts`, `app/clients/[id]/requests/page.tsx`, `app/clients/[id]/requests/requests-forms.tsx`
- `tests/integration/requests.integration.test.ts`

**Пройденные проверки:**
- `pnpm typecheck` — pass
- Тесты тикета 18 (3 шт.) — pass изолированно. Note: полный `pnpm test` (18 файлов параллельно) даёт флаки из-за ресурсного конкурса против одной локальной БД — это затрагивает тесты всех агентов, не только мои; изолированно мои 19 тестов (12/13/17/18) проходят.
- `pnpm lint` — файлы этого тикета проходят; 2 ошибки в `ai-gateway.integration.test.ts` — параллельная работа.
