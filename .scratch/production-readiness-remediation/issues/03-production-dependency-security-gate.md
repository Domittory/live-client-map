# 03: Закрыть critical/high production vulnerabilities

**What to build:** Обновить Next.js и затронутые production dependencies до поддерживаемых patched versions и превратить fresh audit release lockfile в обязательный security gate.

**Blocked by:** 02/Изолировать E2E-сервер и проверять service identity.

**Status:** ready-for-agent

- [ ] Fresh production-only audit release lockfile не содержит известных critical или high vulnerabilities.
- [ ] Любое временное исключение явно документирует owner, срок и основание и автоматически истекает.
- [ ] Authentication, middleware, Server Actions, images и RSC проходят regression coverage после framework upgrade.
- [ ] Dependency gate блокирует CI/release при новом critical/high finding.
- [ ] Устанавливается ровно зафиксированный lockfile без скрытого dependency drift.
