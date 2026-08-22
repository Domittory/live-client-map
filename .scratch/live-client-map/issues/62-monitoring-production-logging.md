# 62: Добавить monitoring и production logging

**What to build:** Команда наблюдает errors, AI failures, jobs, security events и ключевые service health signals без утечки клиентских данных.

**Goal:** Сделать production behavior диагностируемым и поддерживаемым.

**Context:** AuditLog не заменяет operational telemetry. Logs должны следовать redaction и retention policy.

**Blocked by:** 14 — AuditLog; 32 — AI gateway; 41 — follow-up jobs; 61 — runtime security.

**Status:** ready-for-agent

## Concrete steps

1. Определить approved metrics, structured logs, traces и alert thresholds.
2. Инструментировать API, database, AI, imports, exports и scheduled follow-ups.
3. Реализовать correlation identifiers без direct client identifiers.
4. Настроить dashboards и actionable alerts.
5. Добавить redaction and telemetry contract tests.

## Acceptance criteria

- [ ] Критические failures обнаруживаются и связываются с безопасным request trace.
- [ ] Raw psychological data и secrets не попадают в telemetry.
- [ ] Alerts имеют owner, severity и response guidance.
- [ ] Telemetry retention соответствует policy.

## Checks

- [ ] Проведены synthetic failure и alert-delivery smoke tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
