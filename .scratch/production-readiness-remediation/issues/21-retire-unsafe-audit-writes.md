# 21: Удалить небезопасные mutation-then-audit пути

**What to build:** Завершить contract-фазу атомарного refactor: инвентаризировать все production writes, удалить оставшиеся небезопасные compound paths и зафиксировать проверяемую политику допустимых single-statement исключений.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными; 05/Сделать intake, review и import мутации атомарными; 06/Сделать мутации психологической модели атомарными; 07/Сделать Corrections, observations и model history атомарными; 08/Сделать privileged и erasure flows атомарными; 15/Завершить Client Portal authentication и published view; 16/Завершить Client Portal feedback; 19/Ввести асинхронное создание ExportRequest; 20/Защитить download и автоматизировать 30-дневный expiry.

**Status:** ready-for-agent

- [ ] Ни одна compound business mutation не коммитит domain state отдельно от обязательных child rows, ModelChange или AuditLog.
- [ ] Оставшиеся direct single-statement writes перечислены и доказуемо не могут оставить unaudited committed state.
- [ ] Automated check или reviewable inventory предотвращает повторное появление unsafe mutation-then-audit patterns.
- [ ] RPC permissions, fixed search paths, tenant/assignment/consent checks и actor attribution повторно проверены.
- [ ] Generated database types обновлены, а service row contracts остаются локальными и проходят schema verification.
- [ ] Полный fault-injection suite подтверждает rollback при intermediate и AuditLog failures.
