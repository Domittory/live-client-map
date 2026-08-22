# 16: Реализовать OntologyVersion и Diagnostic Library

**What to build:** Специалист использует версионируемый каталог DiagnosticDomain и BeliefTemplate, не превращающий шаблоны в evidence.

**Goal:** Создать управляемую онтологическую основу диагностики и snapshots.

**Context:** Использовать системные домены раздела 50 SPEC.md. Organization может расширять библиотеку, но system records остаются различимыми.

**Blocked by:** 03 — domain data dictionary; 10 — Supabase/API foundation.

**Status:** resolved

## Implementation result

**Что сделано:**
- Миграция `0003_ontology_diagnostic_library.sql`: таблицы `ontology_versions` (SPEC §49), `diagnostic_domains` (SPEC §8.34), `belief_templates` (SPEC §8.35); constraints (`(organization_id is null) = is_system`, slug-формат, polarity enum, version >= 1), частичные unique-индексы (system slug глобально, org slug внутри организации).
- RLS: system records читают все authenticated, изменяет только service role; org records — только активные члены своей организации; org-шаблоны привязываются только к system-доменам или доменам своей организации. Также добавлены недостающие grants для таблиц из 0002 (profiles/organizations/organization_members).
- System seed внутри миграции: OntologyVersion `1.0.0` (relation_types из SPEC §8.16, domain_types) + 24 системных домена из SPEC §50.
- BeliefTemplate — не evidence: в таблице принципиально нет evidence/score колонок и связи с signals; strict Zod-схема отклоняет evidence-поля (SPEC §8.35, §3.5).
- Service layer `lib/service/ontology.ts`: `listDomains` / `listBeliefTemplates` (search `q`, фильтры domainGroup/lifeArea/polarity/scope, cursor-пагинация), `createOrgDomain` / `createOrgBeliefTemplate` (organization overrides), `archiveOrgDomain` / `archiveOrgBeliefTemplate` (soft delete).
- API: `GET/POST /api/library/domains`, `GET/POST /api/library/belief-templates` (единый error contract).
- UI `/library`: список доменов с поиском и фильтром по источнику, шаблоны выбранного домена с пометкой «шаблон не является evidence»; ссылка с главной страницы.
- `lib/supabase/database.types.ts` перегенерирован из живой базы (`pnpm db:types`).
- CI: в integration job добавлен `NEXT_PUBLIC_SUPABASE_ANON_KEY` (demo key) для RLS-тестов от имени authenticated пользователей.

**Изменённые/созданные файлы:**
- `supabase/migrations/0003_ontology_diagnostic_library.sql`
- `lib/service/ontology.ts`, `lib/supabase/database.types.ts`
- `app/api/library/domains/route.ts`, `app/api/library/belief-templates/route.ts`
- `app/library/page.tsx`, `app/page.tsx`
- `tests/unit/ontology.unit.test.ts`, `tests/integration/ontology.integration.test.ts`
- `.github/workflows/ci.yml`

**Пройденные проверки:**
- `supabase db reset` — чистая пересборка базы из миграций (0001–0003) OK
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 33 passed (unit + smoke + integration против локального Supabase: seed 24 доменов с ontology version, tenant isolation, неизменяемость system records, no-evidence PGRST204, читаемость архивных версий)
- `pnpm build` — production build OK
- `pnpm test:e2e` — 2 passed

## Concrete steps

1. Реализовать OntologyVersion, DiagnosticDomain и BeliefTemplate.
2. Добавить системные seed-домены и version metadata.
3. Реализовать library list, search, filters и разрешённые organization overrides.
4. Запретить учёт BeliefTemplate как Signal или evidence до реального тестирования.
5. Добавить UI библиотеки, RLS и tests.

## Acceptance criteria

- [ ] Системные seed-домены доступны и имеют явную ontology version.
- [ ] Organization data не изменяет глобальные system records.
- [ ] BeliefTemplate сам по себе не меняет evidence_count или scores.
- [ ] Архивированные версии остаются читаемыми для старых snapshots.

## Checks

- [ ] Пройдены seed, versioning, tenant isolation и no-evidence tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
