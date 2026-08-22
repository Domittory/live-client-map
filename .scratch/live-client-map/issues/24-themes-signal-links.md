# 24: Реализовать Theme и SignalThemeLink

**What to build:** Специалист объединяет Signals в Themes и видит rationale каждой связи.

**Goal:** Создать первый проверяемый слой психологической модели поверх независимого evidence.

**Context:** Theme должна хранить confidence, counts, contexts, trend, status и visibility. Связь с Signal содержит relevance и rationale.

**Blocked by:** 22 — EvidenceCluster/Context engine; 23 — human review.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать Theme и SignalThemeLink contracts.
2. Создать services для create/update/archive Theme и link/unlink Signal.
3. Пересчитывать агрегаты только из допустимого evidence.
4. Добавить Themes UI со списком Signals, clusters и contexts.
5. Подключить RLS, audit и aggregate tests.

## Acceptance criteria

- [ ] Theme имеет evidence trail до raw Signals.
- [ ] AI-only и rejected Signals не увеличивают confirmed counts.
- [ ] Link rationale и relevance доступны специалисту.
- [ ] Archive не переписывает историю старых snapshots.

## Checks

- [ ] Пройдены aggregate, unlink и authorization tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
