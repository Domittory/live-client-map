# 55: Реализовать JSON archive и CSV Signals export

**What to build:** Owner экспортирует переносимый архив разрешённых данных, а специалист — Signals в утверждённом CSV.

**Goal:** Обеспечить data portability с проверяемой полнотой и privacy filtering.

**Context:** Форматы берутся из тикета 08. Export обязан учитывать tenant, assignments, consent, visibility и relationship privacy.

**Blocked by:** 05 — privacy policy; 08 — export contracts; 43 — Snapshots; 50 — Relationships.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать versioned JSON archive assembler.
2. Реализовать CSV Signals projection с source и epistemic metadata.
3. Добавить authorization, consent и privacy filters.
4. Создать export request/status/download UI с audit.
5. Покрыть completeness, forbidden fields и large dataset behavior.

## Acceptance criteria

- [ ] Архив соответствует утверждённой schema version.
- [ ] CSV не теряет raw statement, source и review status.
- [ ] Пользователь не экспортирует неназначенного клиента.
- [ ] Export action и результат имеют audit trail.

## Checks

- [ ] Пройдены schema validation и sensitive-field exclusion tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
