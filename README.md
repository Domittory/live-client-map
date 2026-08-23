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

| Команда           | Назначение                                             |
| ----------------- | ------------------------------------------------------ |
| `pnpm dev`        | Dev-сервер Next.js                                     |
| `pnpm build`      | Production-сборка                                      |
| `pnpm start`      | Запуск production-сборки                               |
| `pnpm lint`       | ESLint + Prettier check                                |
| `pnpm typecheck`  | TypeScript без генерации (`tsc --noEmit`)              |
| `pnpm test:unit`  | Юнит-тесты (Vitest)                                    |
| `pnpm test:smoke` | Smoke-тест health-эндпоинта (Vitest)                   |
| `pnpm test`       | Все Vitest-тесты                                       |
| `pnpm test:e2e`   | End-to-end (Playwright) — требует `playwright install` |

Подробнее о средах и локальной разработке — в [`docs/development.md`](./docs/development.md).

## Quality gates (CI)

GitHub Actions (`.github/workflows/ci.yml`) выполняет и блокирует merge в `main`:

1. `lint` (ESLint + Prettier check)
2. `typecheck` (`tsc --noEmit`)
3. `test:unit` (Vitest)
4. `test:smoke` (Vitest)
5. `test:e2e` (Playwright)

`test:integration` (Vitest против локального Supabase) добавляется тикетом 10.
