# 05: Сделать intake, review и import мутации атомарными

**What to build:** Перевести DiagnosticSession, Signal, review, import и feedback intake на транзакционные write paths, чтобы evidence никогда не появлялось частично или без audit trail.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** ready-for-agent

- [ ] DiagnosticSession и связанные Signals создаются вместе с AuditLog в одной транзакции.
- [ ] Import commit сохраняет весь выбранный набор либо ничего и остаётся идемпотентным по утверждённому operation key.
- [ ] Review decision атомарно меняет pending evidence и фиксирует actor/reason.
- [ ] Feedback submission одновременно завершает форму, создаёт pending Signal и пишет audit либо полностью откатывается.
- [ ] Fault-injection tests проверяют child-row и AuditLog failures через публичные service boundaries.
