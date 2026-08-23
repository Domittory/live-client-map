# 67: Сделать production deploy ручным до provisioning

**What to build:** Production workflow запускается только вручную, пока реальные production-ресурсы и secrets не настроены.

**Goal:** Не создавать ложные красные GitHub Actions runs после каждого push в `main`, сохранив готовый deployment pipeline для будущего запуска.

**Context:** CI уже зелёный. Отдельный workflow `Deploy to production` падает, потому что Supabase Cloud/Vercel production и обязательные secrets ещё не созданы; это известное ограничение тикетов 63 и 65.

**Blocked by:** none

**Status:** resolved

## Decision

2026-08-23 владелец одобрил временно убрать автоматический trigger `push` и оставить только ручной `workflow_dispatch`. Миграции, production environment, approval и smoke-check не изменяются.

## Acceptance criteria

- [x] Push в `main` больше не запускает `Deploy to production`.
- [x] Workflow можно запустить вручную из GitHub Actions.
- [x] Шаги dry-run, миграции и production smoke сохранены без ослабления.
- [x] Операционная документация описывает ручной запуск.

## Checks

- [x] YAML workflow синтаксически валиден.
- [x] Repository lint и typecheck проходят.
- [x] Полный test suite проходит.

## Comments

- Красный run до изменения: https://github.com/Domittory/live-client-map/actions/runs/32642799110

## Implementation result

**Что сделано:**

- Trigger `push` в `deploy-production.yml` заменён на ручной `workflow_dispatch`.
- Dry-run, применение миграций, environment `production` и post-deploy smoke сохранены.
- Runbook deployment и исторический результат тикета 63 приведены в соответствие с ручным
  режимом.

**Изменённые файлы:**

- `.github/workflows/deploy-production.yml`
- `docs/ops/deployment.md`
- `.scratch/live-client-map/issues/63-backup-staging-production.md`
- `.scratch/live-client-map/issues/67-make-production-deploy-manual.md`

**Проверки:**

- `pnpm exec prettier --check <changed files>` — pass; YAML успешно разобран Prettier.
- `pnpm lint` — pass.
- `pnpm typecheck` — pass.
- `pnpm test` — 78 test files, 465 tests passed.
- `git diff --check` — pass.

**Известное ограничение:** ручной workflow начнёт успешно менять production только после создания
Supabase Cloud/Vercel production и добавления secrets из `docs/ops/deployment.md`.
