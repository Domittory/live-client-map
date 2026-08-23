# Release readiness

Сквозная оценка готовности (тикет 65). Отображает каждый пункт Definition of Done из SPEC §59 на
конкретное evidence (тест или сервис). Это не заменяет CI — это traceability между требованиями и
проверками.

## Definition of Done — evidence

| Пункт §59 DoD                              | Evidence                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| все основные сущности реализованы          | 52 business-таблицы в `supabase/migrations/`, сервисный слой `lib/service/*.ts`                      |
| история клиента сохраняется                | `audit_log` (append-only, тикет 14), `model_changes` + snapshots (тикеты 43–44)                      |
| client requests работают                   | `requests.integration.test.ts`, `createRequest`/`changeRequestStatus`                                |
| evidence independence реализована          | `tests/acceptance/51-criteria.test.ts` (51.2), `tests/acceptance/52-56-cases.test.ts` (§53, §54)     |
| AI hypothesis не подтверждает сама себя    | `tests/acceptance/51-criteria.test.ts` (51.1), `production-journey.integration.test.ts` (L0/pending) |
| RLS защищает каждого клиента               | `access-matrix.integration.test.ts` (тикет 60), `production-journey.integration.test.ts` (cross-org) |
| consent реализован                         | `consent.integration.test.ts`, `production-journey.integration.test.ts` (blocked_consent)            |
| purpose layer работает                     | `purpose.integration.test.ts`                                                                        |
| resource/development layer работает        | `resources.integration.test.ts`, `development-targets.integration.test.ts`                           |
| CoreNodes имеют evidence                   | `evidence.integration.test.ts`, `core-nodes.integration.test.ts`                                     |
| DifferentialHypotheses работают            | `hypotheses.integration.test.ts`, `tests/acceptance/52-56-cases.test.ts` (§55)                       |
| Corrections поддерживают несколько targets | `corrections.integration.test.ts`                                                                    |
| BehavioralMarkers работают                 | `observations.integration.test.ts` (behavioral markers)                                              |
| FollowUps обновляют модель                 | `follow-ups.integration.test.ts`, `tests/acceptance/51-criteria.test.ts` (51.9)                      |
| Reactivation определяется                  | `reactivation.integration.test.ts`, `scoring.unit.test.ts` (reactivation config)                     |
| Snapshots версионируются                   | `snapshots.integration.test.ts`, `snapshots.unit.test.ts`                                            |
| scoring versioned                          | `scoring.unit.test.ts` (`SCORING_MODEL_VERSION`)                                                     |
| model changes объяснимы                    | `explanations.integration.test.ts`, `explanations.unit.test.ts`                                      |
| recommendation ranking объясним            | `recommendations.unit.test.ts`, `ai-recommendations.ts` (deterministic scoring)                      |
| medical causality ограничена               | `safety.unit.test.ts`, `tests/acceptance/52-56-cases.test.ts` (§56)                                  |
| relationship privacy работает              | `relationships.integration.test.ts`, `supervision-export.integration.test.ts`                        |
| import/export работает                     | `import.integration.test.ts`, `export.integration.test.ts`, `production-journey.integration.test.ts` |
| audit trail работает                       | `audit.integration.test.ts`, `erasure.integration.test.ts` (anonymization)                           |
| acceptance tests проходят                  | `pnpm test:acceptance` (24 теста, `tests/acceptance/`)                                               |

## Интегрированный journey

`production-journey.integration.test.ts` проходит сквозной путь без ручного изменения базы:
onboarding → consent → request → диагностическая сессия → signals → AI ingest (pending/L0) →
core node → hypothesis + contradiction → export → erasure, плюс RLS-изоляция и consent-gate.

## Release decision

- Качество: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:acceptance` зелёные.
- Пайплайны деплоя и бэкапы описаны в [deployment.md](./deployment.md) и
  [backup-restore.md](./backup-restore.md) (тикет 63).
- Известные ограничения см. ниже.

## Известные ограничения (требуют владельца / облака)

1. **Облачное provisioning** (Vercel + Supabase Cloud) и **живые drill'ы** (restore/rollback,
   production smoke) не выполнялись агентом — описаны пошагово в `docs/ops/`; подпись
   ответственного лица см. [release-checklist.md](./release-checklist.md).
2. **Export-файлы/retention** (`export_requests` + 30-дневный retention) — отложены отдельным
   тикетом; `erasure_requests.backup_marker` уже фиксирует данные для этого.
3. **Пароль восстановления / reset-password callback** (тикет 11) — не завершены.
4. **`next@15.1.6`** имеет CVE (CVE-2025-66478) — требуется обновление.
5. Пункты «Staging smoke», «restore drill», «release checklist» подписываются ответственным
   человеком (см. [release-checklist.md](./release-checklist.md)) — это не автоматизируется агентом.
