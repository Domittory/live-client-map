# 38: Реализовать InterventionMethod library

**What to build:** Специалист выбирает метод коррекции из управляемого каталога с противопоказаниями и сроком follow-up.

**Goal:** Отделить reusable method metadata от конкретной Correction.

**Context:** Каталог содержит system и organization methods. Contraindications должны быть видимы до планирования коррекции.

**Blocked by:** 10 — Supabase/API foundation; 13 — consent gates.

**Status:** resolved

## Decision

- Сервис уже был написан предыдущим агентом, но падал typecheck из-за устаревшего `database.types.ts` (нет таблицы `intervention_methods` → `Tables<"intervention_methods">` резолвился в `never`). Заменил на локальный интерфейс `InterventionMethod`, как в остальных сервисах (`core-nodes.ts`, `hypotheses.ts`).
- Миграция `0014` (уже была): `intervention_methods` с `organization_id null` для system-записей, RLS «system всем / own-org только членам», write только для owner/specialist, soft-archive.
- Организация не может изменять/архивировать system-методы (проверка `is_system` на сервисе + отсутствие write-политики для system).

## Concrete steps

1. Реализовать InterventionMethod contract.
2. Поддержать system records и organization-scoped additions.
3. Создать list/search/create/edit/archive services и UI.
4. Показывать contraindications и default follow-up days.
5. Добавить RLS, audit и version-safe archive tests.

## Acceptance criteria

- [x] Organization не изменяет system methods.
- [x] Архивированный метод остаётся доступным старым Corrections.
- [x] Contraindications видны при выборе.
- [x] Доступ соответствует organization role.

## Checks

- [x] Пройдены system/tenant isolation и archive-reference tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0014_intervention_methods.sql`: таблица `intervention_methods` (`organization_id null` = system, contraindications, default_follow_up_days 1–365, soft-archive), уникальность имён по scope, RLS: read — system всем + членам своей org (archived тоже читаемы), write — только active owner/specialist; system-записи без write-пути.
- Сервис `lib/service/interventions.ts`: `listMethods` (поиск q, фильтры scope/category, archive-filter, cursor-пагинация), `getMethod` (архив включён — для старых Corrections), `createOrgMethod`, `updateOrgMethod` (запрет system/archived), `archiveOrgMethod` (soft delete); mutations через `withAudit`/`recordAudit` (`intervention_method.create/update/archive` в `audit_log`).
- API `app/api/intervention-methods/route.ts`: GET (list) + POST (create), ошибки через `toErrorResponse`.
- UI `app/methods/` (`page.tsx` + `forms.tsx`) + server actions `app/actions/methods.ts`: список с поиском/scope, contraindications и default follow-up видны в карточке метода, create/edit/archive для org-методов (кнопки только у owner/specialist). Ссылка добавлена на главную `app/page.tsx`.
- Побочно: починен предсуществующий typecheck в `lib/service/ai-cluster.ts:137` (`any` не сужал `string | null` — добавлена проверка перед push), иначе репозиторий не проходил `tsc`.
- `lib/supabase/database.types.ts` регенерирован из живой базы (миграции 0001–0027 применяются чисто через `db reset`).

**Изменённые/созданные файлы:**
- `supabase/migrations/0014_intervention_methods.sql` (новая)
- `lib/service/interventions.ts` (новый)
- `app/api/intervention-methods/route.ts`, `app/actions/methods.ts`, `app/methods/page.tsx`, `app/methods/forms.tsx` (новые)
- `app/page.tsx` (ссылка), `lib/service/ai-cluster.ts` (typecheck-фикс), `lib/supabase/database.types.ts` (регенерация)
- `tests/unit/interventions.unit.test.ts` (9 тестов: схемы, strict, границы follow-up 1–365)
- `tests/integration/interventions.integration.test.ts` (7 тестов: create с contraindications/follow-up; list system+org; запрет update/archive system; архив читаем + скрыт из active-листа; supervisor read-only; tenant isolation — чужая org не видит методы, system видны; audit create/update/archive)
- `.scratch/live-client-map/issues/38-intervention-method-library.md`

**Пройденные проверки:**
- `pnpm format`, `pnpm lint`, `pnpm typecheck` — чисто.
- `pnpm test` — 41 файл, 189 тестов, все pass (включая 16 тестов тикета).
- `pnpm build` — pass, `/methods` собирается.
- `pnpm test:e2e` — 2/2 pass.
