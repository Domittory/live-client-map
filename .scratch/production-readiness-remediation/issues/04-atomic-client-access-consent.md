# 04: Сделать Organization, Client, access и consent мутации атомарными

**What to build:** Перевести Organization, Client, membership, ClientAssignment и consent lifecycle на атомарные RPCs, сохранив текущие роли, RLS и публичные service contracts.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** ready-for-agent

- [ ] Создание и изменение Client фиксируется вместе с обязательным AuditLog либо полностью откатывается.
- [ ] Invite, membership role/status, ClientAssignment grant/revoke и consent grant/revoke атомарны и сохраняют least privilege.
- [ ] Supervisor не получает organization-wide доступ и видит только явно назначенных Clients.
- [ ] AuditLog failure и промежуточная database failure покрыты rollback tests для каждого типа compound mutation.
- [ ] Access matrix и onboarding regression suites остаются зелёными.
