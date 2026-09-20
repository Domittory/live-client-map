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

## Подготовлено к выполнению человеком (не агент)

Этот тикет автоматически **не выполняется**: он требует ответственного человека с
доступом к staging/production и правами подписи. Всё автоматическое для него уже
подготовлено в рамках тикета 23:

1. **Автоматические проверки** — одна команда `pnpm release:check` (21 blocking gate:
   lockfile, dependency audit, инварианты тикетов 21, lint, typecheck, unit, smoke,
   acceptance, production build, clean-миграции, dry-run миграций, schema-verification,
   integration детерминированно и сквозной браузерный journey). Последний локальный
   прогон: **PASSED, 21/21, 332.7 с**, evidence —
   `.release/<sha>-all-<timestamp>.json` (внутри точный release SHA, sha256
   `pnpm-lock.yaml` и `package.json`, версии toolchain, статус и вывод каждой проверки,
   `signatureStatus: "unsigned"`).
2. **Чек-лист с подписью** — `docs/ops/release-checklist.md`: машинный JSON-блок и
   10 ручных gates (`remote-ci`, `staging-release`, `staging-smoke`,
   `target-migration-dry-run`, `target-integration`, `restore-drill`, `rollback-drill`,
   `logging-alerts`, `production-smoke`, `release-decision`). Для каждого нужно
   заполнить `status: "done"`, `evidence`, `timestamp`, `signed_by`, `signed_at`,
   `signature`; `pnpm release:checklist` отклоняет незаполненную или
   противоречивую подпись, а генератор evidence физически не может поставить подпись.
3. **Гейт production AI** — `pnpm release:ai-gate` требует
   `docs/ops/ai-production-decision.md` с утверждёнными провайдером, регионом,
   retention, processing agreement, cross-border transfer и прогоном на
   не-реальных данных. Пока этого нет, production AI выключен.

**Что нужно от человека по шагам:** (1) запушить release-коммит и дождаться
зелёного remote CI на том же SHA; (2) развернуть этот же artifact на staging и
прогнать service-identity smoke + target integration + migration dry-run;
(3) выполнить restore drill и rollback drill в согласованное recovery window;
(4) проверить logging/redaction/metrics/alerts на синтетических сбоях;
(5) выполнить production smoke без real PII; (6) датировать и подписать каждый
пункт в чек-листе и выставить `release_status: "completed"`.

**До подписи real client data загружать запрещено.** Автоматическая часть зелёная,
но это не заменяет подпись: тикет остаётся `ready-for-human`.
