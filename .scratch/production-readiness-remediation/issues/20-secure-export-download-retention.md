# 20: Защитить download и автоматизировать 30-дневный expiry

**What to build:** Выдавать готовый export только после повторной authorization/privacy проверки непосредственно перед download и автоматически удалять private artifacts через 30 дней с полной audit evidence.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными; 19/Ввести асинхронное создание ExportRequest.

**Status:** ready-for-agent

- [ ] Перед каждым download повторно проверяются tenant, assignment, role, consent, visibility и relationship privacy.
- [ ] Revoked access или consent запрещает delivery ранее подготовленного artifact и создаёт denial audit event.
- [ ] Successful download аудируется без filename identifiers, signed URL или raw content.
- [ ] Через 30 дней artifact удаляется, ExportRequest переходит в expired state и событие аудируется.
- [ ] Expiry/deletion process идемпотентен и безопасно повторяется после частичного operational failure.
- [ ] Time-controlled contract tests проверяют download, denial, expiry и отсутствие доступа к удалённому object.
