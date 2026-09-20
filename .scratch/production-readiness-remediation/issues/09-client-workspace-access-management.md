# 09: Создать client workspace с access management

**What to build:** Дать Specialist единый client-scoped workspace с навигацией и управлением assignments/consents, чтобы дальнейшие рабочие экраны открывались только в контексте выбранного Client.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными.

**Status:** ready-for-agent

- [ ] Specialist открывает workspace конкретного Client и видит доступные разделы без ручного ввода client ID.
- [ ] Owner или уполномоченный пользователь управляет ClientAssignments и consent из client context.
- [ ] Unauthorized и unassigned пользователи получают безопасный denial без утечки client metadata.
- [ ] Supervisor видит только явно назначенных Clients и доступные его роли действия.
- [ ] Browser tests покрывают navigation, grant/revoke и немедленную потерю доступа.
