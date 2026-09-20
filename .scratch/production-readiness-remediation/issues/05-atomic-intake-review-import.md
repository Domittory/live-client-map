# 05: Сделать intake, review и import мутации атомарными

**What to build:** Перевести DiagnosticSession, Signal, review, import и feedback intake на транзакционные write paths, чтобы evidence никогда не появлялось частично или без audit trail.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** resolved

- [x] DiagnosticSession и связанные Signals создаются вместе с AuditLog в одной транзакции.
- [x] Import commit сохраняет весь выбранный набор либо ничего и остаётся идемпотентным по утверждённому operation key.
- [x] Review decision атомарно меняет pending evidence и фиксирует actor/reason.
- [x] Feedback submission одновременно завершает форму, создаёт pending Signal и пишет audit либо полностью откатывается.
- [x] Fault-injection tests проверяют child-row и AuditLog failures через публичные service boundaries.

## Implementation result

**What was implemented**

Миграция `0041_atomic_intake_review_import.sql` (шаблон из 0039/0040) переводит intake, review, import и feedback на транзакционные RPC:

- `assert_client_write(org, client)` и `insert_signal_row(org, client, signal jsonb)` — внутренние helper-функции (EXECUTE отозван у public/anon/authenticated), которые проверяют actor + tenant + write assignment + принадлежность клиента организации и создают строку сигнала.
- `create_diagnostic_session(org, client, title, type, source, raw_input, format, notes, signals jsonb)` — сессия **вместе с необязательным пакетом сигналов** и их audit-строками в одной транзакции; возвращает `session_id` и `signal_ids`. Ручные сигналы принудительно `review_status='approved'`.
- `create_signal(...)` — одиночный ручной Signal + audit.
- `ingest_signals(org, client, session, signals jsonb)` — AI-батч: все pending L0-сигналы и один audit `ai.ingest_signals` в одной транзакции; `source_type/epistemic_type/evidence_level/review_status` принудительно задаются в БД и не берутся из входа.
- `review_signal(org, signal, action, reason)` — смена review/visibility и audit `review.<action>` в одной транзакции; actor pinned через `append_audit`, reason сохраняется в audit.
- `create_feedback_form(...)` и `submit_feedback_form(form, answers)` — создание формы с audit и отправка формы (завершение формы + pending Signal + audit) одной транзакцией. Авторизация отправки: специалист с write-доступом **или** активный portal-пользователь этого клиента (совпадает по email из JWT), так что submission работает и для Client Portal.
- `begin_import(...)`, `commit_import(...)`, `finalize_import(...)` — импорт:
  - `commit_import` создаёт DiagnosticSession, вставляет **весь** набор сигналов, пишет report/counts и audit `import.parsed` одной транзакцией; при неудаче не остаётся ни сессии, ни import-строки, ни сигналов;
  - идемпотентность по утверждённому ключу `(organization_id, client_id, contract_version, idempotency_key)` проверяется **внутри** транзакции: повторный вызов с тем же ключом и тем же `content_sha256` возвращает сохранённый отчёт и ничего не пишет; тот же ключ с другим содержимым → конфликт;
  - import report сохраняет `signal_id` для каждого записанного сигнала (RPC проставляет их в отчёте в той же транзакции);
  - `begin_import`/`finalize_import` обслуживают AI-текстовый импорт (внешний вызов AI не может быть внутри транзакции): сессия+import создаются атомарно, ingest сигналов атомарен, финализация статуса и audit — тоже.
- Least privilege: у всех новых функций явный `revoke all ... from public, anon` и grant только `authenticated`/`service_role`.

Сервисный слой переведён на эти RPC без изменения публичных контрактов: `diagnostics.ts` (`createSession`, `createSignal`), `ai-ingest.ts` (`ingestSignals`), `review.ts` (`reviewSignal`), `feedback-forms.ts` (`createFeedbackForm`, `submitFeedbackForm`), `import.ts` (`importText`, `commitStructured`). Отдельные `recordAudit`-вызовы после мутаций убраны. `runAtomicRpc` дополнительно маппит SQLSTATE `55000` в `CONFLICT`.

`supabase/seed.sql`: fault-триггеры добавлены на `diagnostic_sessions`, `signals`, `imports`, `client_feedback_forms` (плюс ранее добавленные таблицы), чтобы можно было инжектить отказ на промежуточной записи.

**Files changed**

- `supabase/migrations/0041_atomic_intake_review_import.sql` (new)
- `supabase/seed.sql`
- `lib/service/diagnostics.ts`, `lib/service/ai-ingest.ts`, `lib/service/review.ts`, `lib/service/feedback-forms.ts`, `lib/service/import.ts`, `lib/service/transaction.ts`
- `tests/integration/atomic-intake.integration.test.ts` (new, 11 tests)

**Validation**

- `supabase db reset` — все миграции (включая 0041) и seed применяются с чистой БД.
- Новый набор `atomic-intake.integration.test.ts` — 11 тестов: commit+audit и rollback для сессии, пакета сессия+сигналы, ручного сигнала, AI-батча, review-решения, отправки формы и import commit; отдельно проверены идемпотентный replay импорта (тот же `import_id`, без дублей сигналов) и отсутствие import-строки/сессии/сигналов после отказа.
- Fault injection: отказ на `audit_log` откатывает уже записанные business-строки; отказ на `signals` откатывает сессию и весь импорт; проверяется состояние строк в БД, а не только отсутствие аудита.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 84 files, **532 tests passed** (было 521; +11 новых).
- Существующие наборы import (7), review (4), feedback-forms (3), ai-ingest (2), diagnostics (3) остаются зелёными; `pnpm typecheck` — pass; `pnpm lint` — pass; `pnpm test:e2e` — 2 passed.

**Notes**

- AI-текстовый импорт (`importText`) по-прежнему состоит из трёх шагов, потому что вызов AI-провайдера не может быть частью транзакции БД. Каждый шаг БД атомарен; прерывание после `begin_import` оставляет только staging-строку импорта в статусе `parsing` и не создаёт evidence. Это осознанная граница внешнего вызова.
- Structured import commit (`commit_import`) — единая транзакция «всё или ничего» и идемпотентен по operation key, как требует приёмка.
- Проверка обязательных ответов формы остаётся в TS (чистая валидация без состояния); авторитетная проверка статуса/срока формы перенесена в RPC, поэтому конкурентная повторная отправка невозможна.
