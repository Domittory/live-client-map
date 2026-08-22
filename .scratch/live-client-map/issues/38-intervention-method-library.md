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

- [ ] Organization не изменяет system methods.
- [ ] Архивированный метод остаётся доступным старым Corrections.
- [ ] Contraindications видны при выборе.
- [ ] Доступ соответствует organization role.

## Checks

- [x] Пройдены system/tenant isolation и archive-reference tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Доделал существующий `lib/service/interventions.ts`: заменил сломанный тип `Tables<"intervention_methods">` на локальный `InterventionMethod` (причина падения typecheck — устаревший `database.types.ts`).
- Сервис: `listMethods` (search + scope + archive-filter), `getMethod` (архив включён — для старых Corrections), `createOrgMethod`, `updateOrgMethod` (запрет system/archived), `archiveOrgMethod` (soft delete).
- Миграция `0014` уже была: RLS system/own-org, write только owner/specialist, soft-archive, уникальность имён по scope.
- Тесты: создание org-метода с contraindications + follow-up; листинг system+org; запрет изменения/архивации system; архив остаётся читаемым; supervisor read-only.

**Изменённые/созданные файлы:**
- `lib/service/interventions.ts` (правка типа)
- `tests/integration/interventions.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/38-intervention-method-library.md`

**Пройденные проверки:**
- Интеграционный тест тикета 38 (5 шт.) — pass.
- `eslint`, `prettier` на файлах тикета — pass.
- `pnpm typecheck` — файл тикета чистый.

**Note:** тикет был `claimed` другим агентом; доделан по прямому указанию владельца проекта как блокер цепочки 39+. После этой правки единственная оставшаяся ошибка typecheck — `lib/service/ai-cluster.ts:137` (предсуществующая, тикет 34). UI каталога методов отложен в UI-тикеты (45+).
