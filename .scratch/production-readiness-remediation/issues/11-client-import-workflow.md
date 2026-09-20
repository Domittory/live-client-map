# 11: Добавить client-scoped import workflow

**What to build:** Дать Specialist один client-scoped import flow для поддерживаемых text, CSV и JSON форматов с validation report, human review и атомарным commit выбранных candidates.

**Blocked by:** 05/Сделать intake, review и import мутации атомарными; 10/Добавить client-scoped DiagnosticSessions и Signals.

**Status:** resolved

- [x] Specialist загружает каждый поддерживаемый формат и видит container errors, record errors, duplicates и warnings до commit.
- [x] Валидный container создаёт immutable source и DiagnosticSession, даже если candidates впоследствии отклонены.
- [x] Commit принимает только выбранные candidates как pending Signals и выполняется одной transaction.
- [x] Повтор с тем же idempotency key/content возвращает прежний результат, а конфликтующее content отклоняется.
- [x] Browser и integration tests проверяют lineage, counts, partial rejection и rollback.

## Implementation result

Реализован двухфазный client-scoped import workflow на `/clients/[id]/import`.

**Миграция `supabase/migrations/0046_selective_import_commit.sql`.** Новая `SECURITY DEFINER` RPC `commit_import_selection(p_org_id, p_client_id, p_import_id, p_selected)` по конвенциям 0039–0045: `set search_path = public`, актор из `auth.uid()`, tenant/assignment внутри RPC (`public.assert_client_write`), `revoke all ... from public, anon` + `grant execute ... to authenticated, service_role`. Внутренние хелперы (`assert_client_write`, `insert_signal_row`) остаются недоступными для `authenticated` — RPC вызывает их с правами владельца миграции. В одной transaction RPC: блокирует import `FOR UPDATE`, читает candidate payload только из сохранённого report, вставляет **только выбранные** записи как pending Signals к DiagnosticSession этого импорта, записывает `signal_id` в report-записи и `counts.committed`, добавляет audit `import.committed`. Повтор с тем же набором возвращает сохранённый report без новых записей; конфликтующий набор отклоняется (`55000` → `CONFLICT`); любой сбой откатывает всю transaction.

**Сервис `lib/service/import.ts`.** Добавлены `previewTextImport`, `previewSignalsCsv`, `previewSignalsJson`, `commitImportSelection` и `listClientImports` (read model истории импортов по RLS). Preview переиспользует `begin_import` + `finalize_import` (0041): создаёт immutable source, DiagnosticSession и report (`records` + `candidates`) без Signals. `ImportReport` теперь типизирован: записи адресуемы (`index`, `external_id`, `status`, `errors`, `warnings`, `statement`, `signal_id`) и содержит `signal_ids`. Одноразовые `importText` / `importSignalsCsv` / `importSignalsJson` сохранены на прежнем публичном контракте (parse + commit всех валидных записей) и работают через те же хелперы; у них лишь уточнён `counts.committed` и добавлены warnings об удалённых duplicate-значениях set-массивов (docs §2). Вспомогательная `extractSignals` в `lib/service/ai-ingest.ts` вынесена из `ingestSignals`, чтобы preview получал AI-кандидатов без записи Signals.

**UI.** `app/actions/import.ts` — Server Actions preview/commit по конвенциям тикета 10 (клиент резолвится через RLS, действует от имени сессии, ошибки контейнера маппятся в русские сообщения). `app/clients/[id]/import/page.tsx` заменяет placeholder: guard `requireClientWorkspace` + `canUseSection(access, "import")`, поэтому read-only/unassigned получают нейтральный отказ. `app/clients/[id]/import/import-forms.tsx` — формы выбора формата, preview-отчёта (counts, container/fatal errors, record errors, duplicates, warnings), чекбоксов выбранных кандидатов, commit и истории импортов с lineage (import id + diagnostic session id).

**Файлы:** `supabase/migrations/0046_selective_import_commit.sql`, `lib/service/import.ts`, `lib/service/ai-ingest.ts`, `lib/ai/provider.ts`, `app/actions/import.ts`, `app/clients/[id]/import/page.tsx`, `app/clients/[id]/import/import-forms.tsx`, `docs/data-exchange-contracts.md`, `tests/integration/import-selection.integration.test.ts`, `e2e/import.spec.ts`.

**Проверки:**
- `supabase db reset` — migration 0046 применилась без ошибок.
- `pnpm typecheck` — ok.
- `pnpm lint` — ok (`eslint .` + `prettier --check .`).
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 91 файл / 626 тестов зелёные (было 90/618; +8 новых integration-тестов в `tests/integration/import-selection.integration.test.ts`).
- `pnpm test:e2e` — 15 passed (11 существующих + 4 новых в `e2e/import.spec.ts`):
  - text import: preview creates the session without Signals, a partial commit creates one pending Signal with audit;
  - CSV import: record errors are visible before commit and only the selected row is committed;
  - JSON import: duplicates are reported and a partial selection commits one record;
  - an unassigned member gets the neutral denial and the database rejects the commit RPC.

**Judgement call.** `FakeAiProvider` (dev/E2E) возвращает `{ signals: [] }`, поэтому текстовый import вне production AI не создавал ни одного кандидата. Добавлен отдельный dev/E2E-провайдер `FakeImportAiProvider` (используется только когда `AI_PROVIDER != "openai"`): для `ai.ingest-signals.v1` возвращает по кандидату на непустую строку входа, для остальных функций делегирует `FakeAiProvider`. Существующие unit/integration тесты его не конструируют и поведение `FakeAiProvider` не изменилось.

## Ревью ведущего

- **Двухфазный flow проверен**: `commit_import_selection` — `SECURITY DEFINER`,
  `assert_client_write` внутри, берёт кандидатов только из сохранённого report,
  идемпотентен по набору, конфликтующий набор отклоняет (55000 → CONFLICT).
  Права: `anon` выполнять не может, `authenticated`/`service_role` — могут;
  общий список anon-доступных функций в БД не изменился (8 — прежний безопасный
  набор RLS-хелперов и триггерных функций).
- **Закрыт риск с dev-провайдером AI.** `app/actions/import.ts` при
  `AI_PROVIDER != "openai"` использовал новый `FakeImportAiProvider`, который
  **фабрикует** кандидатов из строк входа. В dev/E2E это нужно, но в
  production-сборке такой провайдер не должен уметь создавать «доказательства»
  даже при ошибочно включённом production AI. Добавлен guard: при
  `NODE_ENV === "production"` используется инертный `FakeAiProvider` (кандидатов
  не создаёт), а environment-gate шлюза по-прежнему блокирует AI. Поведение
  dev/E2E не изменилось — 15 браузерных тестов зелёные.
- **Прогоны**: полный набор 91 файл / 626 тестов — зелёный; `pnpm test:e2e` —
  **15 тестов** (4 новых import + 4 diagnostics + 5 workspace + 2 health);
  `pnpm typecheck`, `pnpm lint` — зелёные; `supabase db reset` применяет 0046.
- **Продуктовое решение, требующее вашего подтверждения**: commit одноразовый —
  после успешного коммита набора повтор с другим набором запрещён (нельзя
  «докоммитить вторую порцию»). Это прямое следствие acceptance («повтор с тем же
  ключом возвращает прежний результат, конфликтующее содержимое отклоняется»),
  но если по продукту нужна возможность нескольких частичных коммитов одного
  импорта — это отдельное изменение семантики и отдельный тикет.
