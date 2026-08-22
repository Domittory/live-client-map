# 43: Реализовать ModelChange и PsychologicalSnapshot

**What to build:** Система фиксирует значимые изменения психологической модели и создаёт неизменяемые versioned snapshots.

**Goal:** Дать специалисту воспроизводимую историю состояния клиента.

**Context:** ModelChange не равен AuditLog. Snapshot должен хранить model hash, scoring, ontology, AI model и prompt versions.

**Blocked by:** 16 — OntologyVersion; 28 — scoring; 31 — Purpose; 37 — Recommendations; 41 — evaluation; 42 — reactivation.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать ModelChange и PsychologicalSnapshot contracts.
2. Создать deterministic snapshot assembler и model hash.
3. Генерировать ModelChange только для значимых model transitions.
4. Добавить service для получения версии и сравнения с предыдущей.
5. Покрыть immutability, version metadata и repeatability tests.

## Acceptance criteria

- [ ] Старый snapshot никогда не переписывается.
- [ ] Snapshot содержит все категории из раздела 25 SPEC.md.
- [ ] Одинаковая модель и versions дают одинаковый model hash.
- [ ] ModelChange содержит previous/new state, reason и evidence refs.

## Checks

- [ ] Пройдены snapshot immutability и deterministic hash tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
