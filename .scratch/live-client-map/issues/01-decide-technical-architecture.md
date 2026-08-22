# 01: Утвердить technical architecture и deployment

**What to build:** Зафиксировать техническую основу, на которой coding agents смогут создавать приложение без самостоятельного выбора несовместимых технологий.

**Goal:** Получить одно одобренное решение по frontend, backend, Supabase, toolchain, hosting и CI/CD.

**Context:** SPEC.md требует production-систему и Supabase, но не определяет язык, frameworks, package manager, runtime, hosting и структуру репозитория. Эти решения нельзя выдумывать в bootstrap-тикете.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Concrete steps

1. Согласовать frontend framework, backend/API runtime, язык и package manager.
2. Согласовать способ локальной работы с Supabase, миграциями и generated types.
3. Выбрать hosting, CI/CD, staging и production topology.
4. Зафиксировать обязательные команды lint, typecheck, unit, integration и end-to-end tests.
5. Записать решение как одобренный architecture decision для следующих тикетов.

## Acceptance criteria

- [ ] Для каждого элемента стека выбран ровно один вариант и указана поддерживаемая версия.
- [ ] Описаны local, test, staging и production environments.
- [ ] Определены команды, которые являются обязательными quality gates.
- [ ] Решение одобрено владельцем проекта.

## Checks

- [ ] В решении нет взаимоисключающих runtimes или deployment assumptions.
- [ ] Тикеты 09, 10, 32 и 63 могут ссылаться на решение без дополнительных догадок.

## Resolution

Решение одобрено владельцем проекта 2026-08-22.

**Стек приложения:**
- Frontend и backend: Next.js (App Router) + TypeScript, единое приложение (UI + API routes/server actions), Node.js 20 LTS.
- База данных, auth, RLS: Supabase (Postgres). Никаких дополнительных backend-сервисов.
- Package manager: pnpm. Один репозиторий, монорепозиторий не используется.

**Локальная разработка и миграции:**
- Локальный Supabase через Supabase CLI (Docker).
- Миграции — SQL-файлы в репозитории, применяются через Supabase CLI.
- TypeScript-типы БД генерируются из схемы (`supabase gen types`) и коммитятся.

**Environments и deployment:**
- `local` — Supabase CLI + Next.js dev server.
- `staging` — Vercel preview deployments + отдельный Supabase Cloud проект `staging`.
- `production` — Vercel (ветка `main`) + Supabase Cloud проект `production`.
- `test` — CI: интеграционные тесты против локального Supabase в GitHub Actions.

**CI/CD и обязательные quality gates (GitHub Actions, блокируют merge в `main`):**
- `lint` (ESLint + Prettier check)
- `typecheck` (`tsc --noEmit`)
- `test:unit` (Vitest)
- `test:integration` (Vitest против локального Supabase)
- `test:e2e` (Playwright)

Тикеты 09, 10, 32 и 63 должны опираться на это решение без выбора альтернативных технологий.
