# 16: Реализовать OntologyVersion и Diagnostic Library

**What to build:** Специалист использует версионируемый каталог DiagnosticDomain и BeliefTemplate, не превращающий шаблоны в evidence.

**Goal:** Создать управляемую онтологическую основу диагностики и snapshots.

**Context:** Использовать системные домены раздела 50 SPEC.md. Organization может расширять библиотеку, но system records остаются различимыми.

**Blocked by:** 03 — domain data dictionary; 10 — Supabase/API foundation.

**Status:** claimed

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
