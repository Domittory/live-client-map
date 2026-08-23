# Operations

Операционная документация для staging и production (тикет 63). Описывает, как приложение
развёртывается, как резервируются и восстанавливаются данные и как подтверждается готовность
релиза.

| Документ                                       | Что описывает                                                 |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [deployment.md](./deployment.md)               | Среда, деплой приложения и миграций, секреты, откат           |
| [backup-restore.md](./backup-restore.md)       | Резервное копирование, восстановление, drill, связь с erasure |
| [release-checklist.md](./release-checklist.md) | Post-deploy smoke и checklist подписи релиза                  |

Пайплайны лежат в `.github/workflows/` (`deploy-staging.yml`, `deploy-production.yml`), пост-деплой
smoke-скрипт — `scripts/post-deploy-smoke.sh`.

Источник решений: тикет 01 (хостинг/CI) и тикет 05 (retention/erasure).
