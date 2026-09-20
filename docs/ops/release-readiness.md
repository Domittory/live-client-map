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

## Release gate (тикет 23)

Единственная команда, определяющая готовность релиза:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"   # macOS + colima
supabase start
pnpm release:check
```

Нужен запущенный локальный Supabase и установленный браузер Playwright (`pnpm exec playwright
install chromium`). Supabase CLI внутри gate получает временный `HOME`, поэтому кэш браузеров
Playwright (в настоящем `HOME`) не затрагивается.

Она выполняет все блокирующие проверки в фиксированном порядке и падает на первой ошибке:

| Фаза       | Gates (по порядку)                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `static`   | `lockfile-install` → `dependency-audit` → `invariant-audit-writes` → `production-ai-disabled` → `checklist-integrity` → `documentation-integrity` → `lint` → `typecheck` → `typecheck:scripts` → `unit` → `smoke` → `acceptance` → `build` |
| `database` | `supabase-preflight` → `migration-clean-rebuild` → `migration-dry-run` → `schema-seed-rebuild` → `db-types-current` → `rpc-permissions` → `integration` → `e2e`                                                                            |

- **Release SHA и lockfile фиксируются**: evidence содержит `releaseSha`, `releaseRef`, sha256
  `pnpm-lock.yaml` и `package.json`, версии node/pnpm и timestamp. `pnpm install --frozen-lockfile`
  гарантирует, что сборка идёт ровно по закоммиченному lockfile.
- **Remote CI фиксируется для того же commit**: evidence содержит `remoteCi` (URL GitHub Actions run,
  job, SHA). Локальный прогон не может знать результат remote CI, поэтому поле остаётся
  `not-observed`, а gate `remote-ci` в
  [release-checklist.md](./release-checklist.md) требует URL зелёного run'а для того же SHA.
- **Миграции**: `migration-clean-rebuild` пересобирает локальную базу только из
  `supabase/migrations` (`supabase db reset --no-seed`) и сверяет
  `supabase_migrations.schema_migrations` с файлами; `migration-dry-run` прогоняет
  `supabase db push --dry-run --local`. Target-environment dry-run для staging/production требует
  secrets и остаётся ручным gate (`target-migration-dry-run`) — частично он выполняется
  автоматически в `deploy-staging.yml` на pull request в `main`.
- **Rollback policy**: forward-only миграции, откат приложения через redeploy предыдущего деплоя
  Vercel, откат базы через restore из бэкапа — описано в [deployment.md](./deployment.md) § «Откат»
  и [backup-restore.md](./backup-restore.md). Gate `documentation-integrity` падает, если этот
  раздел исчезает.
- **Evidence**: `.release/latest.json` (и `.release/<sha12>-<phase>-<timestamp>.json`). Генератор
  всегда пишет `signatureStatus: "unsigned"` и `humanSignature: null`; он не умеет записать подпись.
  Подписи живут только в [release-checklist.md](./release-checklist.md).

CI (`.github/workflows/ci.yml`) запускает те же gates: job `quality` → `pnpm release:check:static`,
job `integration` → `pnpm release:check:database`; вместе они покрывают весь список, и каждый job
выгружает свой evidence-артефакт. Поэтому зелёный CI означает, что прошли те же gates, что и
локальный `pnpm release:check`.

## Release decision — критерии допуска real client data

Real client data (реальные психологические данные) запрещены, пока не выполнено **всё**
перечисленное:

1. `pnpm release:check` зелёный на точном release SHA (обе фазы, все blocking gates).
2. `pnpm release:checklist` зелёный, и все ручные gates в
   [release-checklist.md](./release-checklist.md) имеют timestamped evidence и подпись:
   remote CI, staging deployment + smoke, target migration dry-run, target integration, restore
   drill, rollback drill, logging/redaction/metrics/alerts, production smoke.
3. Remote CI (`.github/workflows/ci.yml`) зелёный на том же SHA: оба job'а, тот же lockfile.
   Push release-коммита и запуск CI — решение ведущего, не агента.
4. Итоговый gate `release-decision` подписан ответственным лицом: либо «real client data
   разрешены», либо явный отказ с причиной.

Пока хотя бы один пункт не выполнен, продукт можно показывать и тестировать **только на synthetic
data**.

## Известные ограничения

1. **Production AI выключен.** `AI_PRODUCTION_ENABLED=false` по умолчанию, а
   `lib/ai/gateway.ts` в production возвращает `blocked_environment` до явного
   `AI_PRODUCTION_ENABLED=true`. Gate `production-ai-disabled` проверяет дефолт, `.env.example`,
   workflow/конфиги и отсутствие обхода из кода. Чтобы включить production AI, нужны
   одновременно: (а) подписанное решение `docs/ops/ai-production-decision.md` с полями `Status:
approved`, `Approved by`, `Date`, `Provider`, `Data region`, `Retention`, `Processing
agreement`, `Cross-border transfer`, `Production evaluation run (non-real data)`; (б) явное
   включение в deployment-окружении; (в) сохранённый runtime-гейт. До этого non-AI части работают,
   и это ограничение должно быть видно пользователю.
2. **Облачное provisioning** (Vercel + Supabase Cloud) и **живые drill'ы** (staging smoke, restore,
   rollback, logging/alerts, production smoke) не выполнялись агентом и требуют владельца/облака;
   структура и evidence-формат подготовлены тикетом 23, подпись — тикет 24.
3. **`remote-ci` gate нельзя закрыть локально**: чтобы он стал `done`, release SHA нужно
   запушить и дождаться зелёного CI. Push не входит в объём агентской работы.

Всё остальное из remediation-программы реализовано: атомарные мутации и audit (тикеты 04–08, 21),
Specialist workflow и Client Portal (09–16), password recovery (17), полный archive contract и
retention (18–20), изолированный E2E (02), dependency security (03), браузерный journey (22).
Baseline: 110 файлов / 852 Vitest-теста и 42 Playwright-теста.
