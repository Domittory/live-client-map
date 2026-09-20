# 06: Сделать мутации психологической модели атомарными

**What to build:** Перевести изменения Themes, CoreNodes, DifferentialHypotheses, Relations, Resources, DevelopmentTargets, Purpose и Recommendations на атомарные RPCs, не ослабляя human-in-the-loop semantics.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** ready-for-agent

- [ ] Каждая compound mutation сохраняет entity, child links, Evidence Trail, ModelChange где применимо и AuditLog одной транзакцией.
- [ ] AI-created entities и relations остаются pending/L0 и не изменяют confirmed entity без явного human review.
- [ ] Rejected или failed proposal не оставляет links, authoritative evidence или confidence changes.
- [ ] Tenant, assignment, consent и actor checks выполняются внутри transaction boundary.
- [ ] Fault-injection integration tests доказывают rollback model row, child rows и audit.
