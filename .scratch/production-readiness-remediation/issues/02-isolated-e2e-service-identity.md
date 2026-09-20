# 02: Изолировать E2E-сервер и проверять service identity

**What to build:** Сделать browser tests воспроизводимыми: harness должен запускать или выбирать отдельный экземпляр именно этого приложения и подтверждать его identity/version, а не принимать любой HTTP-ответ на стандартном порту.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] E2E запускается против изолированного application instance и чистого локального Supabase окружения.
- [ ] Readiness contract сообщает identity приложения и проверяемый build/release identifier.
- [ ] Тест с посторонним процессом на default development port выбирает другой порт или завершается с явной диагностикой.
- [ ] Harness не переиспользует неизвестный существующий сервер ни локально, ни в CI.
- [ ] Auth redirect и health browser checks проходят в новом режиме.
