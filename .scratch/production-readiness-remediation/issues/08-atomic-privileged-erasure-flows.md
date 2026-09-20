# 08: Сделать privileged и erasure flows атомарными

**What to build:** Закрыть транзакционные разрывы в privileged, safety и erasure flows так, чтобы авторизованная операция либо завершала весь согласованный cleanup и audit, либо оставляла исходное состояние доступным для безопасного повтора.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** ready-for-agent

- [ ] Privileged RPCs подтверждают Owner/actor context до обхода обычного RLS и имеют минимальные grants.
- [ ] Erasure не оставляет частично удалённые client data, AI runs или неанонимизированный AuditLog.
- [ ] Legal hold и consent constraints проверяются до необратимой части операции.
- [ ] Повтор после failure имеет определённый идемпотентный или recoverable результат.
- [ ] Fault injection проверяет failures на каждой транзакционно значимой стадии без удаления unrelated data.
