# 02: Изолировать E2E-сервер и проверять service identity

**What to build:** Сделать browser tests воспроизводимыми: harness должен запускать или выбирать отдельный экземпляр именно этого приложения и подтверждать его identity/version, а не принимать любой HTTP-ответ на стандартном порту.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] E2E запускается против изолированного application instance и чистого локального Supabase окружения.
- [x] Readiness contract сообщает identity приложения и проверяемый build/release identifier.
- [x] Тест с посторонним процессом на default development port выбирает другой порт или завершается с явной диагностикой.
- [x] Harness не переиспользует неизвестный существующий сервер ни локально, ни в CI.
- [x] Auth redirect и health browser checks проходят в новом режиме.

## Implementation result

**What was implemented**

- **Readiness contract** (`lib/health.ts`): `/api/health` теперь отдаёт `build` — проверяемый release identifier (`RELEASE_ID`, иначе `dev`) рядом с `service` и `version`. Добавлен строгий парсер `parseHealthStatus()`, который отклоняет неполный или чужой payload с диагностикой. Smoke-тест проверяет наличие build identifier.
- **E2E harness** (`playwright.config.ts`):
  - приложение поднимается на отдельном порту (`E2E_PORT`, по умолчанию **3100**, никогда не 3000);
  - `reuseExistingServer: false` теперь **во всех окружениях**, включая локальное — неизвестный сервер не может быть переиспользован;
  - порт выбирается динамически: занятый порт не переиспользуется, скан идёт к следующему свободному (`e2e/support/ports.ts`);
  - каждый запуск получает уникальный `RELEASE_ID`, который передаётся серверу и проверяется тестами;
  - порт и build id кэшируются в env, потому что Playwright загружает конфиг и в runner, и в worker-процессах (повторный probe видел бы уже запущенный сервер как «занятый» и уводил worker на другой порт).
- **Определение занятости порта** (`e2e/support/ports.ts`): порт считается свободным только если на него не отвечает ни IPv4, ни IPv6 (`127.0.0.1` и `::1`) и его можно забиндить. Это закрывает реальный случай из тикета: Next слушает `::`, поэтому bind-probe только по `127.0.0.1` считал занятый порт свободным и harness мог разговаривать со «зависшим» сервером (наблюдалось HTTP 404 и таймаут).
- **Preflight** (`e2e/global-setup.ts`): требует локальный Supabase (`NEXT_PUBLIC_SUPABASE_URL` из env или `.env.local`) и **отказывается работать против нелокального хоста**, чтобы браузерные тесты не ушли в удалённый/production проект. Дополнительно: если настроенный порт занят, проверяется identity/build; при несовпадении выбрасывается явная диагностика с описанием того, кто отвечает на порту (best-effort, включая не-HTTP процесс).
- **Browser checks** (`e2e/health.spec.ts`): readiness-тест теперь проверяет `service`, `version`, `build === E2E_RELEASE_ID` и `database === "ok"`, то есть доказывает, что suite общается именно с этим экземпляром и что он подключён к локальной БД. Auth redirect тест сохранён.

**Files changed**

- `lib/health.ts`
- `playwright.config.ts`
- `e2e/global-setup.ts` (new)
- `e2e/support/ports.ts` (new)
- `e2e/support/service-identity.ts` (new)
- `e2e/health.spec.ts`
- `tests/unit/health.unit.test.ts`
- `tests/unit/e2e-harness.unit.test.ts` (new)
- `tests/smoke/health.smoke.test.ts`

**Validation**

- `pnpm test:e2e` — 2 passed (identity/build/database check + auth redirect) на выделенном порту.
- Сценарий приёмки №3 проверен вручную: при постороннем сервисе на 3100 (отвечает `service: "unrelated-app"`) harness выбрал 3101, поднял собственный экземпляр и оба теста прошли; чужой сервер не был переиспользован.
- Юнит-тесты harness: IPv6-only листенер считается занятым; занятый порт пропускается; чужой сервис и чужой build отклоняются с диагностикой; preflight отказывает нелокальному Supabase.
- `pnpm typecheck` — pass; `pnpm lint` (eslint + prettier) — pass.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 81 files, 497 tests passed (было 482).

**Scope note**

«Чистое локальное Supabase окружение» здесь означает: harness требует именно локальный Supabase и проверяет, что экземпляр приложения реально подключён к БД (`database: "ok"`), и не зависит от ранее созданных строк. Гарантированный сброс/сидирование БД перед сквозным браузерным сценарием — часть тикета 22 (production-readiness journey) и тикета 23 (release gate).
