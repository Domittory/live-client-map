# 22: Реализовать EvidenceCluster и Context engine

**What to build:** Система группирует семантически близкие Signals и считает независимые контексты без ложного увеличения evidence.

**Goal:** Сделать evidence independence проверяемой до построения Themes.

**Context:** Двадцать похожих Signals одной сессии не равны двадцати независимым подтверждениям. Контекст включает life area, relationship role, trigger type, time, environment и session.

**Blocked by:** 21 — Signal interpretation и EvidenceLevel.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать EvidenceCluster и canonical context representation.
2. Создать deterministic clustering baseline для явно одинаковых context keys.
3. Рассчитывать signals count отдельно от independent weight/count.
4. Добавить UI просмотра состава кластера и контекстов.
5. Покрыть same-session и genuine multi-context examples.

## Acceptance criteria

- [ ] Двадцать синонимичных Signals одной сессии не дают двадцать независимых evidence.
- [ ] Независимые sessions/contexts могут повысить уровень до L3 только по утверждённым правилам.
- [ ] Пользователь видит, почему Signals объединены.
- [ ] Изменение clustering не уничтожает raw Signals.

## Checks

- [ ] Пройдены acceptance cases разделов 53 и 54 SPEC.md.
- [ ] Repository-standard lint, typecheck и tests проходят.
