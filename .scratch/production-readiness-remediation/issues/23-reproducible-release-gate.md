# 23: Собрать воспроизводимый production-readiness gate

**What to build:** Объединить обязательные автоматические проверки в одну документированную release command/CI workflow, связанную с точным commit и lockfile, чтобы production decision не зависел от ручной последовательности или старых readiness claims.

**Blocked by:** 03/Закрыть critical/high production vulnerabilities; 21/Удалить небезопасные mutation-then-audit пути; 22/Расширить browser-to-database production journey.

**Status:** resolved

- [x] Gate фиксирует release SHA, dependency lockfile identity и результат remote CI для того же commit.
- [x] Dependency audit, lint, typecheck, unit, smoke, acceptance, integration, E2E и production build являются blocking checks.
- [x] Database migrations проверяются с clean rebuild и target-environment dry-run, а rollback policy остаётся явной.
- [x] Gate проверяет, что production AI выключен без отдельного approved provider/data-processing decision.
- [x] Release checklist не может выглядеть completed без timestamped evidence и human signature для ручных gates.
- [x] README, development guide и release-readiness documentation описывают фактические команды, ограничения и критерии допуска real client data.

## Implementation result

### Что реализовано

1. **Одна release command `pnpm release:check`** (`scripts/release-check.mjs`). Запускает 21 blocking gate
   в фиксированном порядке и падает на первой ошибке (fail fast). Две фазы, которые вместе покрывают
   весь список:
   - `static`: `lockfile-install` → `dependency-audit` → `invariant-audit-writes` →
     `production-ai-disabled` → `checklist-integrity` → `documentation-integrity` → `lint` →
     `typecheck` → `typecheck:scripts` → `unit` → `smoke` → `acceptance` → `build`;
   - `database`: `supabase-preflight` → `migration-clean-rebuild` → `migration-dry-run` →
     `schema-seed-rebuild` → `db-types-current` → `rpc-permissions` → `integration` → `e2e`.

   Дополнительные входы: `pnpm release:check:static`, `pnpm release:check:database`,
   `node scripts/release-check.mjs --list`. `partitionGates()` в тестах доказывает, что фазы
   дизъюнктны и покрывают весь реестр.

2. **Evidence record (всегда unsigned).** Команда печатает и пишет
   `.release/latest.json` (полный прогон), `.release/latest-<phase>.json` (CI-фазы) и
   `.release/<sha12>-<phase>-<timestamp>.json`. В записи: `releaseSha` (RELEASE_SHA → GITHUB_SHA →
   `git rev-parse HEAD`), `releaseRef`, `worktree.dirty`, sha256 `pnpm-lock.yaml` и `package.json`,
   node/pnpm, `startedAt`/`finishedAt`/`durationMs`, `result`, `counts`, и по каждому gate —
   `status`, `durationMs`, `summary`, tail output. `.release/` в `.gitignore`.
   `remoteCi` фиксируется как `observed` внутри GitHub Actions (URL run'а, job, SHA), `attested`
   через `RELEASE_CI_RUN_URL`/`RELEASE_CI_SHA`, иначе `not-observed` — результат remote CI для
   локального прогона принципиально неизвестен и закрывается человеческим gate `remote-ci`.
   `assertUnsignedEvidence()` физически запрещает генератору записать подпись: `signatureStatus`
   всегда `"unsigned"`, `humanSignature` всегда `null`, все ручные gates всегда `pending`.

3. **Детерминированный integration.** `pnpm test:integration:release` =
   `vitest run --no-file-parallelism tests/integration`. Gate дополнительно валит прогон, если
   vitest сообщает о skipped тестах (иначе отсутствие `.env.local`/Supabase выглядело бы как
   «зелено»). Измерено: serialized integration — **89.4 с** (в полном прогоне). Известная
   флейкость воспроизведена: полный default-параллельный набор один раз упал
   (`tests/integration/report.integration.test.ts`, 1 из 873), в изоляции тот же файл зелёный;
   serialized-прогон стабильно зелёный (`--no-file-parallelism`). Speed для гейта принесён в
   жертву воспроизводимости; полный локальный gate — **330.5 с**.

4. **Migrations + rollback policy.** `migration-clean-rebuild` делает
   `supabase db reset --no-seed` и через `pg` сверяет `supabase_migrations.schema_migrations` с
   `supabase/migrations/*.sql` (53 миграции: ни пропущенных, ни лишних, ни переименованных).
   `migration-dry-run` выполняет `supabase db push --dry-run --local` и требует «up to date»;
   `schema-seed-rebuild` (`supabase db reset`) возвращает seed для fault-injection тестов.
   Target-environment dry-run (staging/production) требует secrets, поэтому остаётся ручным gate
   `target-migration-dry-run` и частично автоматизирован job'ом `validate-migrations` в
   `deploy-staging.yml`. Gate `documentation-integrity` падает, если из `deployment.md` исчезает
   раздел «Откат», упоминание forward-only или ссылка на `backup-restore.md`.

5. **Production-AI gate.** `scripts/check-production-ai.mjs` (`pnpm release:ai-gate`, а также gate
   `production-ai-disabled`) читает реальные источники и fail-closed проверяет: strict enum
   `AI_PRODUCTION_ENABLED` с дефолтом `false` в `lib/env.ts`, `false` в `.env.example`,
   production-блок и сравнение `=== "true"` в `lib/ai/gateway.ts`, отсутствие `=true` в
   workflow/конфигах и отсутствие явного `productionAiEnabled` у callers. Если код/конфиг
   направлены в сторону включения, gate требует полный approval-документ
   `docs/ops/ai-production-decision.md` (`Status: approved`, `Approved by`, `Date`, `Provider`,
   `Data region`, `Retention`, `Processing agreement`, `Cross-border transfer`,
   `Production evaluation run (non-real data)`). Точное условие включения задокументировано в
   `docs/development.md` и `docs/ops/release-readiness.md`.

6. **Release checklist.** `docs/ops/release-checklist.md` получил машинный JSON-блок
   (`release-checklist-machine:begin/end`) с `release_sha`, `lockfile_sha256`,
   `automated_evidence {path, sha256}`, `release_status` и 10 ручными gates
   (`remote-ci`, `staging-release`, `staging-smoke`, `target-migration-dry-run`,
   `target-integration`, `restore-drill`, `rollback-drill`, `logging-alerts`, `production-smoke`,
   `release-decision`). `scripts/check-release-checklist.mjs` (`pnpm release:checklist`,
   `pnpm release:checklist:complete`) отклоняет: `done` без evidence/timestamp/`signed_by`/`signed_at`/
   `signature`; подпись у не-`done` gate; `completed` без всех подписей и без совпадающего по sha256
   evidence того же SHA/lockfile; evidence-файл, который заявляет подпись. В документе описано
   ровно то, что заполняет человек. Ручные gates остаются за тикетом 24.

7. **CI = тот же gate.** `.github/workflows/ci.yml`: job `quality` → `pnpm release:check:static`,
   job `integration` → `pnpm release:check:database`; оба выгружают `.release/*.json` артефактом
   (`if: always()`). Workflow-level env — local demo keys, `AI_PRODUCTION_ENABLED=false`,
   `SUPABASE_DB_URL`. Push release-коммита и проверка remote CI — вне объёма и требуют решения
   ведущего; это явно написано в документации и в `remote-ci` gate.

8. **Документация.** `README.md` (команды, CI jobs, критерии допуска real client data),
   `docs/development.md` (полный разбор release gate, порядок, evidence, ограничение production AI),
   `docs/ops/release-readiness.md` (release decision, критерии допуска, актуализированные
   ограничения — убраны устаревшие пункты про CVE next@15.1.6, export retention и password
   recovery, закрытые тикетами 03, 17–20), `docs/ops/deployment.md` (release gate и target dry-run).

9. **Тесты.** `tests/unit/release-gate.unit.test.ts` (21 тест): партиционирование реестра gate'ов,
   полнота обязательных проверок, serialized integration + детектор skipped, запрет подписи в
   evidence, fail/unsigned-поведение генератора, все правила checklist-валидатора (включая
   подделанную подпись и чужой lockfile), логика production-AI gate (disabled/unsafe/enabled-by-decision),
   и проверка, что CI запускает фазы release-команды, а документация упоминает `pnpm release:check`.

### Файлы

- `scripts/release-check.mjs` (новый) — release command, evidence generator, migration-сверка
- `scripts/check-release-checklist.mjs` (новый) — валидатор checklist и реестр ручных gates
- `scripts/check-production-ai.mjs` (новый) — production-AI guard
- `tests/unit/release-gate.unit.test.ts` (новый)
- `docs/ops/release-checklist.md` — машинно-проверяемый формат ручных gates
- `docs/ops/release-readiness.md`, `docs/ops/deployment.md`, `docs/development.md`, `README.md`
- `.github/workflows/ci.yml` — CI запускает те же фазы release-команды + evidence-артефакты
- `package.json` — `release:check`, `release:check:static`, `release:check:database`,
  `release:checklist`, `release:checklist:complete`, `release:ai-gate`, `test:integration:release`
- `.gitignore` — `/.release/`

### Проверки

| Команда | Результат |
| ------- | --------- |
| `pnpm release:check` (полный, фазы static + database) | **PASSED**, 21/21 gate, 330.5 с |
| `pnpm exec vitest run --no-file-parallelism tests/unit tests/smoke tests/acceptance tests/integration` | 111 файлов / 873 теста — green (96.7 с) |
| `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` | 111/111 файлов, 873/873 теста — green (45.2 с); предыдущий прогон дал известный флейк `report.integration.test.ts`, который в изоляции зелёный |
| `pnpm test:e2e` | 42 passed (2.4 мин, внутри release gate) |
| `pnpm typecheck`, `pnpm typecheck:scripts`, `pnpm lint` | green |
| `pnpm security:audit` | 0 critical / 0 high |
| `pnpm audit:writes` | 0 нарушений |
| `pnpm audit:rpc-permissions` | 140 функций, 0 находок |
| `pnpm db:types:check` | типы совпадают со схемой |
| `pnpm build` | production-сборка успешна |
| `supabase db reset --no-seed` | 53 миграции, история совпадает с файлами |
| `supabase db push --dry-run --local` | «Local database is up to date» |

Доказательство, что gate реально падает (временно, затем откатано):

- вручную отметить `staging-smoke` как `done` без подписи → `pnpm release:check --phase static`
  упал на `checklist-integrity` с сообщением про отсутствующие evidence/timestamp/signature,
  exit 1, evidence с `result: failed`;
- временно поменять дефолт `AI_PRODUCTION_ENABLED` на `"true"` → прогон упал на
  `production-ai-disabled`, exit 1;
- неотформатированный `docs/ops/deployment.md` → прогон упал на `lint`, exit 1.

Все три изменения откатаны, рабочее дерево не содержит временных правок.

### Замечания для ревью

- **Push не делался** (требуется решение ведущего). Локальный gate зелёный, но `remote-ci` gate
  остаётся `pending` до зелёного CI на том же SHA — это осознанное ограничение, а не недоделка.
- `release_sha`/`lockfile_sha256` в draft-checklist указывают на текущий HEAD
  (`05e387d…`, lockfile `65384d92…`); после коммита их нужно обновить — инструкция в
  `docs/ops/release-checklist.md`. Валидатор намеренно требует валидные SHA/hash даже в `draft`,
  чтобы чек-лист нельзя было «заготовить» без привязки к релизу.
- `pnpm install --frozen-lockfile` может предложить пересоздать `node_modules`; в CI pnpm
  неинтерактивен, локально принимается дефолт. Lockfile при этом не меняется (проверено `git status`).
- Тикет 24 не тронут: он остаётся `ready-for-human`, подпись и живые drill'ы — за человеком.

## Ревью ведущего

- **Гейт проверен целиком, а не только по отчёту агента.** Я запускал
  `pnpm release:check` четыре раза, в том числе в худших условиях (с подменённым
  `HOME`, как требуют локальные команды Supabase). Первый прогон вскрыл две
  реальные проблемы, обе исправлены:
  1. **Playwright не находил браузеры** при подменённом `HOME` (кэш браузеров
     лежит в настоящем домашнем каталоге), из-за чего гейт падал с бесполезной
     подсказкой «установите браузеры». Добавлен `playwrightBrowserEnv()`: если
     `HOME` подменён, Playwright получает явный `PLAYWRIGHT_BROWSERS_PATH` на
     настоящий кэш (покрыто тремя юнит-тестами). Гейт стал воспроизводимым
     независимо от того, как настроена оболочка.
  2. **Неустойчивая проверка в тесте тикета 20** (`export-download-retention`):
     аудит-строки одной транзакции делят `created_at`, поэтому выбор «последней
     строки» зависел от физического порядка и падал в детерминированном
     (serialized) прогоне. Проверка теперь выбирает переход **по действию**
     (`export.denied`, `export.expired`, `export.failed`) и сравнивает мультимножество
     действий, а не порядок. Это была хрупкость теста, а не дефект приватности:
     отказ выдачи (FORBIDDEN при отозванном согласии партнёра) проверялся и
     продолжает проверяться.
- **Итоговый прогон: PASSED, 21/21, 332.7 с** (integration 87.7 с детерминированно
  с `--no-file-parallelism`, e2e 147.6 с, clean-rebuild 27.6 с, build 19.4 с),
  evidence записан в `.release/` без подписи.
- **Детерминированность важнее скорости**: гейт умышленно сериализует integration
  (флейки под параллельной нагрузкой подтверждены и мной, и авторами тикетов
  16/19/22) и валит прогон, если vitest сообщает о skipped тестах.
- **Подпись остаётся за человеком**: генератор evidence не может записать подпись,
  чек-лист отклоняет незаполненные подписи, тикет 24 остаётся `ready-for-human`.
- **CI**: `quality` запускает `release:check:static`, `integration` —
  `release:check:database`, оба выгружают evidence; зелёный CI означает те же
  проверки, что и локальный гейт. Push и remote CI — решение владельца.
