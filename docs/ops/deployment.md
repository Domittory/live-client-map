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
- `deploy-production.yml` — на push в `main` применяет миграции в production и запускает
  post-deploy smoke. Job привязан к environment `production`, поэтому запускается только после
  ручного одобрения (required reviewer).

### Порядок действий при релизе

1. Изменения кода и миграции приходят в `main` через pull request (CI quality gates зелёные,
   dry-run миграций показан в логе).
2. После merge в `main` запускается `deploy-production.yml` и ждёт одобрения.
3. Одобряющий проверяет лог dry-run, затем одобряет — применяются миграции, прогоняется smoke.
4. Vercel автоматически публикует `main` в production.

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

Environment `production` в GitHub дополнительно настраивается с required reviewers — это и есть
ручное одобрение перед деплоем в production.

## Откат

1. **Приложение**: в Vercel выбрать предыдущий production-деплой → Redeploy (мгновенно).
2. **База**: восстановить из бэкапа до нужной точки (см.
   [backup-restore.md](./backup-restore.md)), затем убедиться, что приложение снова работает со
   старой схемой.
