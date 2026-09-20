# 03: Закрыть critical/high production vulnerabilities

**What to build:** Обновить Next.js и затронутые production dependencies до поддерживаемых patched versions и превратить fresh audit release lockfile в обязательный security gate.

**Blocked by:** 02/Изолировать E2E-сервер и проверять service identity.

**Status:** resolved

- [x] Fresh production-only audit release lockfile не содержит известных critical или high vulnerabilities.
- [x] Любое временное исключение явно документирует owner, срок и основание и автоматически истекает.
- [x] Authentication, middleware, Server Actions, images и RSC проходят regression coverage после framework upgrade.
- [x] Dependency gate блокирует CI/release при новом critical/high finding.
- [x] Устанавливается ровно зафиксированный lockfile без скрытого dependency drift.

## Implementation result

**What was implemented**

- **Framework upgrade:** `next` 15.1.6 → **15.5.25** (последний патч ветки 15.x, закрывающий все найденные advisories; мажорный переход на 16 сознательно не делался, чтобы не смешивать security-фикс с миграцией), `eslint-config-next` 15.1.6 → 15.5.25. Версии зафиксированы точно (`--save-exact`).
- **Транзитивная зависимость:** `next@15.5.25` тянул уязвимый `postcss@8.4.31`. Добавлен точечный override `pnpm.overrides: { "postcss@<=8.5.22": "8.5.26" }`, который дедуплицирует postcss до пропатченной версии. `sharp` подтянулся до 0.35.4 вместе с апгрейдом Next.
- **Security gate:** `scripts/security-audit.mjs` + `pnpm security:audit`:
  - анализирует **только production** зависимости (`pnpm audit --prod`);
  - блокирует `critical`/`high` (exit 1), `moderate`/`low` только сообщает;
  - поддерживает time-bounded исключения в `.security-audit-exceptions.json`, где обязательны `id`, `reason`, `owner`, `expiresAt`;
  - истёкшее исключение перестаёт действовать и выводится как ошибка (`exception expired`) — риск нужно пере-подтвердить, а не унаследовать;
  - исключение без owner/срока/основания — ошибка конфигурации (exit 2), а не молчаливое подавление;
  - есть тестовый seam (`SECURITY_AUDIT_REPORT`), поэтому логика gate покрыта юнит-тестами без сети.
- **CI:** в job `quality` добавлен блокирующий шаг `Production dependency security gate` сразу после `pnpm install --frozen-lockfile`.
- **Документация:** `docs/dependency-security.md` — что проверяется, как чинить, формат исключения и коды выхода.

**Files changed**

- `package.json`, `pnpm-lock.yaml` — next/eslint-config-next 15.5.25, override postcss, скрипт `security:audit`
- `scripts/security-audit.mjs` (new)
- `.security-audit-exceptions.json` (new, пустой список)
- `docs/dependency-security.md` (new)
- `.github/workflows/ci.yml`
- `tests/unit/security-gate.unit.test.ts` (new)

**Validation**

- `pnpm audit --prod`: было **39 уязвимостей (4 critical, 15 high, 17 moderate, 3 low)** → стало **0** (`No known vulnerabilities found`). `pnpm security:audit` — 0 critical / 0 high.
- `pnpm install --frozen-lockfile` — «Lockfile is up to date, resolution step is skipped»: package.json и lockfile согласованы, скрытого drift нет.
- `pnpm build` (production build, Next 15.5.25) — успешно, маршруты и Middleware собраны.
- Regression coverage после апгрейда: `pnpm lint` + `pnpm typecheck` — pass; `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 82 files, **504 tests passed**; `pnpm test:e2e` — 2 passed (включая auth redirect через middleware и readiness с identity/build/database).
- `tests/unit/security-gate.unit.test.ts` — 7 тестов: moderate/low не блокируют, critical и high блокируют, действующее исключение принимается, истёкшее — нет, исключение без owner/срока — ошибка конфигурации, исключение для другого advisory не помогает.

**Notes**

- Проверка бандла не выявила использования `next/image` в `app/`/`lib/`, поэтому отдельного image-regression набора не потребовалось; images-часть Next покрыта успешной production-сборкой.
- Server Actions и RSC проверены существующими наборами (unit/integration/smoke/acceptance) и production-сборкой; полный браузерный сквозной сценарий появится в тикете 22.
- `next@16.x` доступен, но требует отдельной миграции и в scope этого тикета не входил.
