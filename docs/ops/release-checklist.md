# Release checklist

Это человеко-подписываемая половина release gate (тикет 23). Автоматическая половина — команда
[`pnpm release:check`](../development.md#release-gate-pnpm-releasecheck): она собирает код, гоняет
тесты и чистую пересборку базы и пишет **unsigned** evidence. Здесь фиксируются только те проверки,
которые физически выполняет и подписывает человек: staging smoke, restore drill, rollback drill,
проверка logging/alerts, production smoke и итоговое решение о допуске real client data.

**Пока не заполнены evidence, timestamp и подпись для каждого ручного gate, real client data
запрещены.** Тикет 24 владеет подписью; тикет 23 построил структуру и автоматическую часть.

## Как заполнять

1. Прогнать автоматические gates на точном release-коммите:
   ```bash
   pnpm release:check
   ```
   Команда печатает release SHA, sha256 `pnpm-lock.yaml`, timestamp и результат каждого gate, а в
   конце пишет `.release/latest.json` (unsigned) и печатает его sha256.
2. Скопировать в машинный блок ниже:
   - `release_sha` — release SHA из вывода;
   - `lockfile_sha256` — sha256 lockfile из вывода (или `shasum -a 256 pnpm-lock.yaml`);
   - `automated_evidence` — `{ "path": ".release/latest.json", "sha256": "<sha256 из вывода>" }`.
3. Выполнить ручные gates из таблицы и для каждого, который **реально** пройден, заполнить в
   машинном блоке `status: "done"`, `evidence`, `timestamp`, `signed_by`, `signed_at`, `signature`.
4. Только после всех подписанных gates поставить `release_status: "completed"`, `released_at`,
   `released_by`.
5. Проверить структуру:
   ```bash
   pnpm release:checklist              # формат + запрет незаполненной «готовности»
   pnpm release:checklist --require-complete   # для тикета 24: требует completed
   ```
   `pnpm release:check` вызывает `pnpm release:checklist` как blocking gate, поэтому чек-лист,
   который «выглядит completed» без evidence и подписи, валит релиз.

Чего делать нельзя:

- отмечать `done` без timestamped evidence и подписи — gate это отклонит;
- писать `signature`/`signed_by` в ещё не выполненный gate — gate это отклонит;
- вписывать подпись в `.release/latest.json`: генератор пишет только unsigned evidence, а
  «подписанный» evidence-файл считается сфабрикованным и валит проверку;
- заменять evidence на «уже проверяли раньше» — timestamp и ссылка обязательны для каждого gate.

## Автоматические gates (не подписываются руками)

| Gate                                     | Что доказывает                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `lockfile-install`                       | `pnpm install --frozen-lockfile` — lockfile и package.json согласованы |
| `dependency-audit`                       | нет critical/high в production-зависимостях                            |
| `invariant-audit-writes`                 | нет mutation-then-audit (тикет 21)                                     |
| `production-ai-disabled`                 | production AI выключен без approved decision                           |
| `checklist-integrity`                    | этот чек-лист не заявляет «готово» без подписей                        |
| `documentation-integrity`                | rollback policy и команды задокументированы                            |
| `lint`, `typecheck`, `typecheck:scripts` | статические проверки                                                   |
| `unit`, `smoke`, `acceptance`            | Vitest-наборы                                                          |
| `build`                                  | production-сборка Next.js                                              |
| `supabase-preflight`                     | локальный Supabase запущен                                             |
| `migration-clean-rebuild`                | чистая пересборка из одних миграций + совпадение истории               |
| `migration-dry-run`                      | `supabase db push --dry-run --local` без pending-миграций              |
| `db-types-current`, `rpc-permissions`    | типы БД и права RPC не дрейфуют                                        |
| `integration`                            | integration suite, serialized (`--no-file-parallelism`)                |
| `e2e`                                    | браузерный production journey                                          |

## Ручные gates (подписывает человек)

| Gate                       | Кто подписывает   | Что приложить                                                                          |
| -------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `remote-ci`                | release owner     | URL GitHub Actions run + SHA: оба job'а (`quality`, `integration`) зелёные на этом SHA |
| `staging-release`          | release owner     | URL staging-деплоя + `RELEASE_ID == release SHA` из `/api/health`                      |
| `staging-smoke`            | release owner     | вывод `./scripts/post-deploy-smoke.sh <STAGING_URL>`                                   |
| `target-migration-dry-run` | database owner    | лог `supabase db push --dry-run --project-ref <ref>` для staging и production          |
| `target-integration`       | release owner     | лог integration-набора против staging-базы                                             |
| `restore-drill`            | database owner    | timestamp, точка восстановления, фактический RTO                                       |
| `rollback-drill`           | release owner     | timestamp, предыдущий deployment, фактическое recovery window                          |
| `logging-alerts`           | operations owner  | synthetic failure, сработавший alert, отсутствие client PII в логах                    |
| `production-smoke`         | release owner     | вывод `./scripts/post-deploy-smoke.sh <PRODUCTION_URL>` (synthetic only)               |
| `release-decision`         | accountable owner | письменное решение: real client data разрешены + оставшиеся ограничения                |

Все operational проверки выполняются **только на synthetic data**. Пароли, ключи и реальные
психологические данные в evidence не попадают.

## Текущее состояние

- [ ] Все автоматические gates зелёные на release SHA (`pnpm release:check`).
- [ ] Remote CI зелёный на том же SHA (нужен push; решение о push — за ведущим).
- [ ] Staging deployment и service-identity smoke подписаны.
- [ ] Target migration dry-run и integration против target environment подписаны.
- [ ] Restore drill и rollback drill подписаны.
- [ ] Logging/redaction/metrics/alerts проверены и подписаны.
- [ ] Production smoke (no real PII) подписан.
- [ ] Итоговое решение о real client data подписано ответственным лицом.

## Машинный блок (источник истины для gate)

Не меняйте структуру: `pnpm release:checklist` парсит именно этот JSON.

<!-- release-checklist-machine:begin -->

```json
{
  "schema_version": 1,
  "release_sha": "05e387d7b2a78dfd7794a0bb95b633f7db2a7083",
  "lockfile_sha256": "65384d92195fb0fda770652876a1ba85fc6edcbfc5ad90fcc63fef9c8f96d4aa",
  "release_status": "draft",
  "released_at": null,
  "released_by": null,
  "automated_evidence": null,
  "manual_gates": {
    "remote-ci": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "staging-release": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "staging-smoke": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "target-migration-dry-run": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "target-integration": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "restore-drill": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "rollback-drill": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "logging-alerts": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "production-smoke": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    },
    "release-decision": {
      "status": "pending",
      "evidence": null,
      "timestamp": null,
      "signed_by": null,
      "signed_at": null,
      "signature": null
    }
  }
}
```

<!-- release-checklist-machine:end -->
