# 19: Ввести асинхронное создание ExportRequest

**What to build:** Ввести идемпотентный asynchronous ExportRequest lifecycle, который собирает утверждённый artifact, публикует только полностью завершённый файл в private storage и сохраняет auditable state transitions.

**Blocked by:** 18/Собрать полный privacy-safe archive contract.

**Status:** ready-for-agent

- [ ] Request фиксирует Client, format, exact contract version, audience, optional snapshot version и idempotency key.
- [ ] Lifecycle различает requested, generating, available, failed и denied states с actor/timestamps.
- [ ] Повтор эквивалентного request возвращает прежний export, а conflicting idempotency input отклоняется.
- [ ] Artifact сохраняется в private storage под opaque filename без direct identifiers.
- [ ] Partial или failed file никогда не получает downloadable state.
- [ ] Request, completion, denial и failure имеют AuditLog без raw export content.
