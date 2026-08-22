# 20: Реализовать DiagnosticSession и ручной ввод Signal

**What to build:** Специалист создаёт диагностическую сессию, сохраняет raw input и вручную выделяет атомарные Signals.

**Goal:** Создать рабочий диагностический путь без зависимости от AI.

**Context:** Raw input должен сохраняться. Каждый Signal имеет source, epistemic type, polarity, test result, context, visibility и review status.

**Blocked by:** 16 — Diagnostic Library; 17 — Client.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать DiagnosticSession и Signal contracts из SPEC.md.
2. Создать service/API operations для сессии и её Signals.
3. Добавить UI создания сессии, raw input и ручного Signal.
4. Подключить DiagnosticDomain/BeliefTemplate только как источник формы, не evidence.
5. Применить consent, assignments, RLS, audit и tests.

## Acceptance criteria

- [ ] Raw input сохраняется неизменным рядом с нормализованными Signals.
- [ ] Один Signal представляет одну атомарную evidence unit.
- [ ] Manual Signal имеет валидные source_type и epistemic_type.
- [ ] Создание Signal не подтверждает Theme или CoreNode автоматически.

## Checks

- [ ] Пройдены manual session, validation и access tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
