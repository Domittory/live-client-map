# 49: Реализовать Dynamics и History UI

**What to build:** Специалист сравнивает версии модели и видит хронологию диагностик, коррекций и объяснённых изменений.

**Goal:** Дать проверяемый ответ на вопрос «что изменилось с прошлого раза».

**Context:** Экран использует immutable snapshots, ModelChange и approved explanations; он не пересчитывает историю на клиенте.

**Blocked by:** 43 — ModelChange/Snapshots; 44 — explainModelChanges.

**Status:** ready-for-agent

## Concrete steps

1. Создать timeline read model для sessions, corrections, follow-ups и ModelChanges.
2. Реализовать snapshot comparison before/after.
3. Показать strengthened, weakened, new, contradicted и priority changes.
4. Добавить navigation к evidence и source event.
5. Покрыть ordering, historical immutability и UI states.

## Acceptance criteria

- [ ] Экран покрывает список изменений раздела 26 SPEC.md.
- [ ] Before/after значения совпадают с сохранёнными snapshots.
- [ ] Historical explanation сохраняет использованные versions.
- [ ] Пустая история отображается без ложных выводов.

## Checks

- [ ] Пройдены chronological ordering и snapshot diff tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
