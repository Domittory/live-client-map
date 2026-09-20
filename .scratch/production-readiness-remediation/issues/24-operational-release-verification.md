# 24: Провести и подписать operational release verification

**What to build:** Провести один accountable release candidate, построенный из точного прошедшего remote CI commit, через staging и production operational checks с synthetic data и подписать итоговое решение человеком.

**Blocked by:** 23/Собрать воспроизводимый production-readiness gate.

**Status:** ready-for-human

- [ ] Финальный release SHA и lockfile pushed, а remote CI для этого SHA полностью зелёный.
- [ ] Один и тот же release artifact проходит staging deployment, service-identity smoke, target integration tests и migration dry-run.
- [ ] Restore drill доказывает usable backup, а rollback drill укладывается в согласованное recovery window.
- [ ] Logging, redaction, metrics и alerts проверены synthetic failures без client information.
- [ ] Production smoke подтверждает service identity и database readiness без real PII.
- [ ] Ответственное лицо датирует и подписывает staging smoke, restore, rollback и production smoke; до этого real client data запрещены.
