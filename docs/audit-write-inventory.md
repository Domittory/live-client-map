# Инвентаризация путей записи AuditLog

Тикет `21-retire-unsafe-audit-writes`. Документ фиксирует **каждый production-путь, который
добавляет запись в AuditLog**, и его вердикт. Проверка автоматизирована
(`pnpm audit:writes`, `pnpm audit:rpc-permissions`), поэтому список и политика не могут
разойтись незаметно.

## Политика

1. **Составная мутация** (domain-строка + дочерние строки + AuditLog / ModelChange) коммитится
   целиком внутри одного `SECURITY DEFINER` RPC, который сервис вызывает через
   `runAtomicRpc()` (`lib/service/transaction.ts`). Сбой на любом шаге откатывает всё.
2. **`recordAudit()`** (`lib/service/audit.ts`) разрешён только для путей, которые **ничего не
   коммитят до записи аудита** — тогда сбой аудита не оставляет unaudited-состояния, потому что
   коммитить нечего. Каждый такой путь перечислен ниже с доказательством.
3. **`withAudit()`** удалён в тикете 21: он существовал ровно для пары «мутация → отдельный
   аудит» и больше не используется (проверено `grep`; guard валит любую новую ссылку).
4. Новый `recordAudit(`/`withAudit(` вне allowlist, как и запись domain-состояния перед
   `recordAudit(`, валит `pnpm audit:writes` / `pnpm test:unit`.

Конвенция RPC (миграции 0039–0053): `security definer`, `set search_path = public`, актор из
`auth.uid()`, проверки tenant/assignment/consent внутри RPC, `revoke all ... from public, anon` +
минимальные `grant execute`, внутренние helper-функции не выдаются ролям клиента.

## 1. Атомарные RPC, пишущие AuditLog (вердикт: atomic RPC)

Каждый RPC ниже коммитит domain-запись и `public.append_audit(...)` в одной транзакции. Список
построен по миграциям (`grep "perform public.append_audit"`), вызовы сервисов идут через
`runAtomicRpc()`.

| Миграция | RPC                                                                                                                                                                                       | Сервис                                                                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0007     | `invite_member`, `accept_invitation`, `update_member_role`, `set_member_status`, `transfer_ownership`                                                                                     | `admin.ts`                                                                                                                                                                                                                   |
| 0039     | `create_client`                                                                                                                                                                           | `clients.ts`                                                                                                                                                                                                                 |
| 0040     | `update_client`, `archive_client`, `grant_client_assignment`, `revoke_client_assignment`, `grant_consent`, `revoke_consent`, `update_organization_settings`                               | `clients.ts`, `client-access.ts`, `consent.ts`, `admin.ts`                                                                                                                                                                   |
| 0041     | `create_diagnostic_session`, `create_signal`, `ingest_signals`, `review_signal`, `submit_feedback_form`, `commit_import`, `finalize_import`, `create_feedback_form`                       | `diagnostics.ts`, `import.ts`, `review.ts`, `feedback-forms.ts`                                                                                                                                                              |
| 0042     | 33 RPC психологической модели и AI-предложений (`create_theme` … `apply_ai_resource_proposals`)                                                                                           | `themes.ts`, `core-nodes.ts`, `hypotheses.ts`, `relations.ts`, `resources.ts`, `development-targets.ts`, `purpose.ts`, `recommendations.ts`, `ontology.ts`, `model-changes.ts`, `snapshots.ts`, `explanations.ts`, `ai-*.ts` |
| 0043     | 18 RPC corrections/observations/follow-ups/reactivation + `insert_model_change_internal`                                                                                                  | `corrections.ts`, `observations.ts`, `follow-ups.ts`, `reactivation.ts`, `model-changes.ts`                                                                                                                                  |
| 0044     | `set_client_legal_hold`, `execute_client_erasure`, `create_safety_review`, `create_portal_user`, `revoke_portal_user`                                                                     | `erasure.ts`, `safety.ts`, `client-portal.ts`                                                                                                                                                                                |
| 0046     | `commit_import_selection`                                                                                                                                                                 | `import.ts`                                                                                                                                                                                                                  |
| 0047     | `review_theme`, `review_hypothesis`                                                                                                                                                       | `review.ts`                                                                                                                                                                                                                  |
| 0048     | `update_development_target`, `review_recommendation`, `set_recommendation_visibility`                                                                                                     | `development-targets.ts`, `recommendations.ts`                                                                                                                                                                               |
| 0051     | `request_export` (4 записи), `append_export_audit`                                                                                                                                        | `export-request.ts`                                                                                                                                                                                                          |
| **0053** | `create_life_event`, `create_trigger`, `create_relationship`, `create_relationship_dynamic`, `create_client_request`, `change_request_status`, `create_client_goal`, `change_goal_status` | `life-events.ts`, `relationships.ts`, `requests.ts`                                                                                                                                                                          |

Миграция 0053 — то, что закрыл тикет 21. До неё эти пять путей делали `insert`/`update`, а затем
отдельный `recordAudit()`: падение между вызовами оставляло закоммиченную бизнес-строку без
аудита, а проверки доступа/согласия были предварительными чтениями, которые конкурентный отзыв
мог обесценить. Что изменилось по существу:

- `create_life_event` / `create_trigger`: добавлены tenant + assignment проверки и (для триггера)
  проверка, что `life_event_id` принадлежит тому же клиенту.
- `create_relationship`: «оба клиента в одной организации» теперь проверяется внутри RPC, а не
  отдельным чтением; `relationship_analysis` consent обязателен для обоих.
- `create_relationship_dynamic`: consent перепроверяется в транзакции; ссылки на evidence обязаны
  быть `client_visible` сигналами одного из двух клиентов. **Поведение ужесточено осознанно**:
  раньше приватная ссылка молча вырезалась (и её могла проскочить гонка с переклассификацией
  сигнала), теперь вся запись отклоняется с 22023. Read-фильтр в `listRelationshipDynamics`
  оставлен как defence-in-depth для строк, записанных до 0053.
- `change_request_status` / `change_goal_status`: карты переходов переехали в SQL
  (`request_status_transition_allowed` / `goal_status_transition_allowed`), поэтому «переход
  легален» и сама запись не могут быть разорваны конкурентным вызовом.

## 2. Read-only пути с `recordAudit()` (вердикт: разрешённое исключение)

Эти пути **не пишут domain-состояние вообще**: они читают таблицы, формируют артефакт и
добавляют ровно одну запись аудита. Если запись аудита упадёт, откатывать нечего — вызов
завершится ошибкой, и никакое «unaudited committed state» не возникнет. Allowlist —
`ALLOWED_READ_ONLY_AUDITS` в `scripts/check-unsafe-audit-writes.mjs`.

| Файл#функция                              | Доказательство отсутствия domain-записи                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `export.ts#exportSignalsCsv`              | `loadSignalsForExport` → `requireExportAccess` + `SELECT signals`; записей в таблицы нет     |
| `export.ts#exportClientArchive`           | `assembleClientArchive` только читает; audit-пayload содержит счётчики/хэш, не контент       |
| `supervision-export.ts#exportSupervision` | `loadSupervisionSource` — шесть `SELECT`; payload проходит allowlist-проверку §14            |
| `report.ts#auditReport`                   | вызывается из `exportSnapshotReportMarkdown/Pdf` — рендер снапшот-версии, domain-записей нет |

Проверка «в этих файлах нет `.insert/.update/.upsert/.delete`» выполнена вручную и
подтверждается тем, что guard отклоняет любую запись, появившуюся **до** `recordAudit(`.

## 3. Оставшиеся прямые одиночные записи (вердикт: не оставляют unaudited-состояния)

Полный `grep` по `lib/service/*.ts` на `from("...").insert|update|upsert|delete` даёт ровно два
места — оба не должны писать аудит по продуктовому контракту, поэтому отсутствие audit-строки не
является нарушением, и обе операции — одно statement без дочерних строк:

| Место                                  | Что делает                                                                     | Почему безопасно                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feedback-forms.ts#sendFeedbackForm`   | один `UPDATE client_feedback_forms` (`status='sent'`, `sent_at`, `expires_at`) | Один statement, дочерних строк и ModelChange нет; аудит для `feedback_form.send` продуктовым контрактом не предусмотрен; доступ ограничен RLS `is_client_accessible(..., true)` |
| `relations.ts#createTriggerActivation` | один `INSERT trigger_activations`                                              | Один statement, без дочерних строк и ModelChange; аудит-контракта нет; RLS ограничивает доступ ассайном, `created_by` берётся из `auth.getUser()`                               |

Всё остальное в сервисном слое либо идёт через `runAtomicRpc()`, либо является чтением.

Отдельно: RLS-политики всё ещё разрешают `authenticated` прямые `INSERT/UPDATE` в 45 таблиц
(например `signals`, `model_changes`, `signal_theme_links`). Это осознанная схема «сервисный слой
вызывает RPC, RLS — граница безопасности PostgREST»: сузить права можно только отдельным тикетом
про RLS-поверхность, и делать это в рамках 21 нельзя (нельзя ослаблять/менять авторизацию ради
зелёных проверок). Прямая запись в обход сервиса — это не mutation-then-audit, а вопрос политики
доступа к PostgREST.

## 4. Как это проверяется

| Проверка                  | Команда                                                                      | Что ловит                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Guard сервисного слоя     | `pnpm audit:writes`, `pnpm test:unit` (`audit-write-guard.unit.test.ts`)     | новый `recordAudit`/`withAudit` вне allowlist; запись domain-состояния перед аудитом               |
| Права RPC и `search_path` | `pnpm audit:rpc-permissions`, тест `schema-verification.integration.test.ts` | EXECUTE у `anon`; SECURITY DEFINER без `search_path`; helper у `authenticated`; пропавший RPC 0053 |
| Актуальность типов        | `pnpm db:types:check`                                                        | устаревший `lib/supabase/database.types.ts`                                                        |
| Откат транзакций          | `tests/integration/atomic-*.integration.test.ts`                             | сбой промежуточной записи и сбой AuditLog → полный rollback                                        |
