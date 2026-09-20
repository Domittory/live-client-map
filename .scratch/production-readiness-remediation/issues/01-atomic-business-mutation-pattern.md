# 01: Ввести шаблон атомарной business mutation

**What to build:** Ввести расширяемый least-privilege RPC-шаблон, в котором одна показательная business mutation, связанные записи и AuditLog фиксируются одной PostgreSQL-транзакцией, чтобы следующие миграционные партии могли переходить на него без изменения публичных service contracts.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Показательная compound mutation и её AuditLog либо коммитятся вместе, либо не оставляют ни одной записи.
- [ ] RPC проверяет tenant, ClientAssignment, consent и authenticated actor там, где они применимы, и использует фиксированный search path и минимальные grants.
- [ ] Публичный service input сохраняет camel-case convention, а database payload использует schema column names.
- [ ] Fault injection на промежуточной записи и AuditLog append доказывает полный rollback через публичную service boundary.
- [ ] Существующие callers продолжают работать без одновременной миграции всего service layer.
