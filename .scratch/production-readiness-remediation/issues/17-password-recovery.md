# 17: Завершить password recovery

**What to build:** Завершить безопасный password recovery journey от запроса письма до проверенной recovery session, смены пароля и входа с новым credential.

**Blocked by:** 02/Изолировать E2E-сервер и проверять service identity; 03/Закрыть critical/high production vulnerabilities.

**Status:** ready-for-agent

- [ ] Recovery request задаёт явный allowlisted callback target и не раскрывает существование account.
- [ ] Callback проверяет recovery session перед показом password-update form.
- [ ] Expired, malformed и reused links приводят к безопасному понятному состоянию.
- [ ] После успеха старый пароль не работает, новый работает, а navigation не допускает open redirect.
- [ ] Browser tests проходят через локальный email capture service.
