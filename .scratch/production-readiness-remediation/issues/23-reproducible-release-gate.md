# 23: Собрать воспроизводимый production-readiness gate

**What to build:** Объединить обязательные автоматические проверки в одну документированную release command/CI workflow, связанную с точным commit и lockfile, чтобы production decision не зависел от ручной последовательности или старых readiness claims.

**Blocked by:** 03/Закрыть critical/high production vulnerabilities; 21/Удалить небезопасные mutation-then-audit пути; 22/Расширить browser-to-database production journey.

**Status:** ready-for-agent

- [ ] Gate фиксирует release SHA, dependency lockfile identity и результат remote CI для того же commit.
- [ ] Dependency audit, lint, typecheck, unit, smoke, acceptance, integration, E2E и production build являются blocking checks.
- [ ] Database migrations проверяются с clean rebuild и target-environment dry-run, а rollback policy остаётся явной.
- [ ] Gate проверяет, что production AI выключен без отдельного approved provider/data-processing decision.
- [ ] Release checklist не может выглядеть completed без timestamped evidence и human signature для ручных gates.
- [ ] README, development guide и release-readiness documentation описывают фактические команды, ограничения и критерии допуска real client data.
