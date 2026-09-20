# 16: Завершить Client Portal feedback

**What to build:** Завершить двусторонний feedback flow: Specialist создаёт и отправляет client-scoped форму, Client Portal User заполняет только свою форму, а ответ поступает Specialist как pending evidence.

**Blocked by:** 05/Сделать intake, review и import мутации атомарными; 15/Завершить Client Portal authentication и published view.

**Status:** ready-for-agent

- [ ] Specialist создаёт, просматривает и отправляет feedback form из client workspace.
- [ ] Portal User видит и отправляет только принадлежащую ему active, unexpired форму.
- [ ] Submission атомарно завершает форму, создаёт pending self-report Signal и AuditLog.
- [ ] Feedback не увеличивает authoritative evidence/confidence и не подтверждает AI hypothesis автоматически.
- [ ] Browser tests покрывают successful submit, expired form, reuse, cross-client denial и consent revocation.
