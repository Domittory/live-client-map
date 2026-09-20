# Деплой и откат

Решение по хостингу зафиксировано тикетом 01: приложение на Vercel, база на Supabase Cloud,
CI/CD — GitHub Actions. Здесь — операционная процедура, как это применяется на практике.

## Среда

| Среда        | Приложение                              | База данных                         |
| ------------ | --------------------------------------- | ----------------------------------- |
| `local`      | `next dev` (локально)                   | Supabase CLI (Docker)               |
| `test`       | нет (только тесты в CI)                 | локальный Supabase в GitHub Actions |
| `staging`    | Vercel preview-деплой с ветки `staging` | Supabase Cloud `staging`            |
| `production` | Vercel production-деплой с ветки `main` | Supabase Cloud `production`         |

## Как происходит деплой

Приложение деплоится через нативную интеграцию Vercel с Git:

- push в `staging` → Vercel создаёт preview-деплой и публикует его на staging-URL.
- push в `main` → Vercel создаёт production-деплой.

Миграции базы приложение само не применяет. Их применяет GitHub Actions:

- `deploy-staging.yml` — на pull request в `main` делает `supabase db push --dry-run` (только
  показывает SQL, ничего не меняет); на push в `staging` применяет миграции и запускает
  post-deploy smoke.
- `deploy-production.yml` — запускается вручную из GitHub Actions, применяет миграции в
  production и запускает post-deploy smoke. Job привязан к environment `production`, поэтому
  после запуска дополнительно ждёт ручного одобрения (required reviewer).

Пока реальные production-проекты и secrets не созданы, автоматический запуск этого workflow на
push в `main` отключён (тикет 67). Это не удаляет pipeline: после provisioning его можно запустить
кнопкой **Run workflow**. Нативная интеграция Vercel настраивается отдельно.

### Порядок действий при релизе

1. Изменения кода и миграции приходят в `main` через pull request (CI quality gates зелёные,
   dry-run миграций показан в логе).
2. После provisioning владелец открывает GitHub Actions → `Deploy to production` → **Run
   workflow**.
3. Workflow ждёт required reviewer; одобряющий запускает job, проверяет dry-run, после чего
   применяются миграции и прогоняется smoke.
4. Публикация приложения через Vercel выполняется его отдельно настроенной Git-интеграцией.

## Release gate перед деплоем

Перед применением миграций и публикацией приложения release-коммит проходит
`pnpm release:check` (см. [release-readiness.md](./release-readiness.md) и
[development.md](../development.md#release-gate-pnpm-releasecheck)). Gate включает чистую
пересборку базы **только из миграций** (`supabase db reset --no-seed`) со сверкой
`supabase_migrations.schema_migrations` и локальный `supabase db push --dry-run --local`, который
не должен показывать pending-миграций.

Target-environment dry-run остаётся обязательным и выполняется:

- для staging — job `validate-migrations` в `deploy-staging.yml` на pull request в `main`
  (`supabase db push --dry-run --project-ref <staging-ref>`);
- для production — workflow `Deploy to production` перед применением (`--dry-run`, затем apply).

Лог target dry-run прикладывается к [release-checklist.md](./release-checklist.md). Evidence
автоматической части (SHA, lockfile, timestamp, результат каждого gate) пишется в `.release/`.

## Миграции

- Миграции — forward-only SQL-файлы в `supabase/migrations/`, применяются командой
  `supabase db push`.
- Каждый файл миграции применяется отдельной транзакцией; номера идут строго по возрастанию.
- Перед применением всегда прогоняется `--dry-run`, его вывод остаётся в логе job'а.

### «Не оставлять частично применённый release»

Миграции и деплой приложения не атомарны как единое целое. Чтобы сбой не оставил production в
полусобранном виде:

- миграции применяются **до** публикации приложения и не удаляют данные (forward-only);
- если миграция падает, job падает и приложение на Vercel **не** переключается на новый код —
  старый код продолжает работать на старой схеме;
- откат базы выполняется восстановлением из бэкапа (см.
  [backup-restore.md](./backup-restore.md)), откат приложения — redeploy предыдущего коммита
  через Vercel.

## Секреты

Никакие секреты не коммитятся. Значения задаются в GitHub → Settings → Secrets and variables →
Actions (или в настройках environment), а на Vercel — в Environment Variables.

| Имя                                    | Где задаётся                     | Назначение                                     |
| -------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                | GitHub org/repo secret           | доступ Supabase CLI к Management API           |
| `STAGING_SUPABASE_PROJECT_REF`         | GitHub secret (env `staging`)    | ref проекта Supabase `staging`                 |
| `STAGING_SUPABASE_DB_PASSWORD`         | GitHub secret (env `staging`)    | пароль Postgres проекта `staging`              |
| `STAGING_URL`                          | GitHub secret (env `staging`)    | URL staging-приложения (для smoke)             |
| `PRODUCTION_SUPABASE_PROJECT_REF`      | GitHub secret (env `production`) | ref проекта Supabase `production`              |
| `PRODUCTION_SUPABASE_DB_PASSWORD`      | GitHub secret (env `production`) | пароль Postgres проекта `production`           |
| `PRODUCTION_URL`                       | GitHub secret (env `production`) | URL production-приложения (для smoke)          |
| `NEXT_PUBLIC_SUPABASE_URL`             | Vercel (preview + production)    | публичный URL Supabase                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | Vercel (preview + production)    | публичный anon key                             |
| `SUPABASE_SERVICE_ROLE_KEY`            | Vercel (production only)         | service_role key (только сервер, не в браузер) |
| `AI_PROVIDER`, `AI_PRODUCTION_ENABLED` | Vercel (production only)         | AI-шлюз (тикет 32)                             |

Environment `production` в GitHub дополнительно настраивается с required reviewers. Это второй
ручной барьер после кнопки **Run workflow** перед изменением production.

## Откат

1. **Приложение**: в Vercel выбрать предыдущий production-деплой → Redeploy (мгновенно).
2. **База**: восстановить из бэкапа до нужной точки (см.
   [backup-restore.md](./backup-restore.md)), затем убедиться, что приложение снова работает со
   старой схемой.
