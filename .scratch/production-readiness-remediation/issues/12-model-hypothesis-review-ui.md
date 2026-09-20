# 12: Добавить review workflow для Themes, CoreNodes и DifferentialHypotheses

**What to build:** Дать Specialist client-scoped интерфейс для анализа и human review Themes, CoreNodes, DifferentialHypotheses и contradictions с полным Evidence Trail.

**Blocked by:** 06/Сделать мутации психологической модели атомарными; 10/Добавить client-scoped DiagnosticSessions и Signals.

**Status:** ready-for-agent

- [ ] Specialist просматривает Themes и их Signal links, CoreNodes и несколько competing DifferentialHypotheses.
- [ ] Каждая conclusion показывает supporting/contradicting evidence и ограничения данных.
- [ ] AI proposals остаются pending/L0 до явного approve/reject и не меняют confirmed entity молча.
- [ ] Contradictions видимы и не удаляются при подтверждении одной из competing hypotheses.
- [ ] Browser tests проходят review path и проверяют persisted model, audit и unauthorized denial.
