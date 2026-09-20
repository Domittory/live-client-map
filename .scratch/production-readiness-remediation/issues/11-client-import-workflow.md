# 11: Добавить client-scoped import workflow

**What to build:** Дать Specialist один client-scoped import flow для поддерживаемых text, CSV и JSON форматов с validation report, human review и атомарным commit выбранных candidates.

**Blocked by:** 05/Сделать intake, review и import мутации атомарными; 10/Добавить client-scoped DiagnosticSessions и Signals.

**Status:** ready-for-agent

- [ ] Specialist загружает каждый поддерживаемый формат и видит container errors, record errors, duplicates и warnings до commit.
- [ ] Валидный container создаёт immutable source и DiagnosticSession, даже если candidates впоследствии отклонены.
- [ ] Commit принимает только выбранные candidates как pending Signals и выполняется одной transaction.
- [ ] Повтор с тем же idempotency key/content возвращает прежний результат, а конфликтующее content отклоняется.
- [ ] Browser и integration tests проверяют lineage, counts, partial rejection и rollback.
