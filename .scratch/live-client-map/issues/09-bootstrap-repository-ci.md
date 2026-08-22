# 09: Создать repository bootstrap и CI

**What to build:** Минимально запускаемое приложение и единый quality-gate, на котором смогут безопасно работать независимые coding agents.

**Goal:** Создать воспроизводимую локальную и CI-среду без продуктовой функциональности.

**Context:** Проект пока содержит только SPEC.md и agent guidance. Технические решения берутся исключительно из тикета 01.

**Blocked by:** 01 — Утвердить technical architecture и deployment.

**Status:** resolved

## Concrete steps

1. Инициализировать выбранную структуру проекта и dependency lockfile.
2. Добавить минимальный application shell и health smoke behavior.
3. Настроить formatting, linting, static type checks и test runners.
4. Настроить CI на чистую установку и все обязательные проверки.
5. Документировать единые developer commands и environment prerequisites.

## Acceptance criteria

- [ ] Чистый checkout устанавливается и запускается по документированной процедуре.
- [ ] Application shell открывается и сообщает о готовности без business data.
- [ ] Lint, typecheck, unit и smoke test запускаются отдельными стабильными командами.
- [ ] CI выполняет те же quality gates.

## Checks

- [ ] Выполнены repository-standard install, lint, typecheck и test commands.
- [ ] Проверен запуск из чистой среды без локально скрытых зависимостей.

## Implementation result

**Что сделано:**
- Инициализирован репозиторий Next.js 15 (App Router) + TypeScript, единое приложение, package manager pnpm (по решению тикета 01).
- Добавлен application shell: страница `/` и health-эндпоинт `GET /api/health` → `{ "status": "ok", "service": "living-client-map", "version": "0.1.0" }` без бизнес-данных и secrets.
- Настроены lint (ESLint flat config + Prettier check), typecheck (`tsc --noEmit`), Vitest (unit + smoke) и Playwright (e2e).
- Настроен CI (GitHub Actions) на чистую установку (`pnpm install --frozen-lockfile`) и все обязательные quality gates.
- Документированы developer commands и prerequisites (README.md, docs/development.md).

**Изменённые/созданные файлы:**
- Конфиг: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.nvmrc`, `vitest.config.ts`, `playwright.config.ts`
- Приложение: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/api/health/route.ts`, `lib/health.ts`
- Тесты: `tests/unit/health.unit.test.ts`, `tests/smoke/health.smoke.test.ts`, `e2e/health.spec.ts`
- CI: `.github/workflows/ci.yml`
- Документация: `README.md`, `docs/development.md`

**Пройденные проверки:**
- `pnpm lint` (ESLint + Prettier check) — pass
- `pnpm typecheck` — pass
- `pnpm test:unit` — 2 passed
- `pnpm test:smoke` — 1 passed
- `pnpm build` — production build OK (`/` static, `/api/health` dynamic)
- Runtime smoke: `GET /api/health` → HTTP 200, `{ "status": "ok", ... }`
- `pnpm test:e2e` (Playwright) — настроен, выполняется в CI; локально браузеры не установлены.
