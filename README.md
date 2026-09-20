# Живая карта клиента

Динамическая модель текущего психологического состояния клиента на основе диагностических
сигналов, установок, тестирований и наблюдений специалиста.

Полная спецификация продукта — в [`SPEC.md`](./SPEC.md). Архитектурные решения зафиксированы в
тикете `01-decide-technical-architecture`.

## Стек

- **Frontend + backend**: Next.js (App Router) + TypeScript, единое приложение (UI + API routes).
- **БД / auth / RLS**: Supabase (Postgres).
- **Package manager**: pnpm.
- **Runtime**: Node.js 24 LTS.

## Быстрый старт

Требования: Node.js 24 LTS, pnpm 9, Docker (для локального Supabase — см. тикет 10).

```bash
pnpm install        # установка зависимостей
pnpm dev            # dev-сервер: http://localhost:3000
```

Application shell открывается на `http://localhost:3000`, а health-эндпоинт
`GET http://localhost:3000/api/health` сообщает о готовности без бизнес-данных.

## Команды разработчика

| Команда                 | Назначение                                                                  |
| ----------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`              | Dev-сервер Next.js                                                          |
| `pnpm build`            | Production-сборка                                                           |
| `pnpm start`            | Запуск production-сборки                                                    |
| `pnpm lint`             | ESLint + Prettier check                                                     |
| `pnpm typecheck`        | TypeScript без генерации (`tsc --noEmit`)                                   |
| `pnpm test:unit`        | Юнит-тесты (Vitest)                                                         |
| `pnpm test:smoke`       | Smoke-тест health-эндпоинта (Vitest)                                        |
| `pnpm test:acceptance`  | Acceptance-тесты интеллектуальной корректности (Vitest)                     |
| `pnpm test:integration` | Integration-тесты против локального Supabase (Vitest)                       |
| `pnpm test:e2e`         | End-to-end (Playwright) — требует `playwright install`                      |
| `pnpm release:check`    | **Release gate: все блокирующие проверки по порядку + evidence** (см. ниже) |

Подробнее о средах и локальной разработке — в [`docs/development.md`](./docs/development.md).

## Quality gates (CI)

GitHub Actions (`.github/workflows/ci.yml`) блокирует merge в `main` двумя job'ами, которые вместе
запускают тот же release gate, что и `pnpm release:check`:

- job **Quality gates** — `pnpm release:check:static`: установка ровно зафиксированного lockfile,
  production dependency audit, `audit:writes`, production-AI guard, целостность release-checklist,
  проверка документации и rollback policy, lint, typecheck, unit, smoke, acceptance, production build.
- job **Integration and E2E tests (Supabase)** — `pnpm release:check:database` против свежей локальной
  базы: preflight, чистая пересборка из одних миграций, `db push --dry-run --local`, seed-пересборка,
  `db:types:check`, `audit:rpc-permissions`, serialized integration suite и E2E journey.

Оба job'а выгружают evidence-артефакт (`.release/*.json`), привязанный к точному commit и lockfile.
Push release-коммита и проверка, что remote CI зелёный именно на нём, — обязательное условие допуска
real client data (человеческая подпись в
[`docs/ops/release-checklist.md`](./docs/ops/release-checklist.md), тикет 24).

## Готовность к production

Оценка готовности и известные ограничения — в
[`docs/ops/release-readiness.md`](./docs/ops/release-readiness.md). Ключевое:

- **Production AI выключен** (`AI_PRODUCTION_ENABLED=false`) до отдельного утверждённого решения о
  провайдере, регионе данных и обработке персональных данных — это enforced gate, а не пожелание.
- **Real client data запрещены** до полного зелёного `pnpm release:check` на release SHA, зелёного
  remote CI на том же SHA и подписанных ручных gates (staging smoke, target dry-run/integration,
  restore drill, rollback drill, logging/alerts, production smoke).
