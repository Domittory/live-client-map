# 07: Сделать Corrections, observations и model history атомарными

**What to build:** Перевести Corrections, BehavioralMarkers, FollowUps, reactivation, ModelChanges, PsychologicalSnapshots и explanations на атомарные write paths, чтобы history всегда соответствовала фактическому состоянию модели.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** resolved

- [x] Correction и её targets/expected markers фиксируются вместе с AuditLog или полностью откатываются.
- [x] Observation/BehavioralMarker и FollowUp transitions не расходятся со связанными ModelChanges.
- [x] Reactivation decision, snapshot generation и explanation decision сохраняют все связанные rows атомарно.
- [x] Failed AuditLog append и intermediate insert/update не оставляют видимого business state.
- [x] Existing scoring, snapshot, explanation и intellectual-correctness tests остаются зелёными.

## Implementation result

### Что сделано

Добавлена миграция `supabase/migrations/0043_atomic_corrections_history.sql` — один
`SECURITY DEFINER` RPC на каждую compound mutation в scope тикета. Общие хелперы
переиспользованы из 0039/0040/0041/0042 (`require_org_member_actor`,
`assert_client_write`, `assert_client_consent`, `jsonb_text_array`, `append_audit`,
`validate_correction_target`, `validate_behavioral_marker_link`), продублированной
логики нет. Работа тикета 06 (`record_model_change`, `create_snapshot`,
`save_model_explanation`, `review_model_explanation`) не переделывалась и не
дублировалась.

**Новые внутренние хелперы** (EXECUTE отозван у public/anon; для вызывающих их RPC
оставлен у authenticated/service_role, иначе PostgreSQL скрывает функцию при
разрешении вызова — SQLSTATE 42883):

- `insert_model_change_internal(...)` — вставка ModelChange + его audit-строки в той же
  транзакции, что и вызвавший переход; `record_model_change` теперь делегирует в него,
  поэтому standalone-путь и составные пути пишут строку и audit в одном порядке;
- `p_payload_missing_required(assessment jsonb)` — обязательные ключи assessment;
- `jsonb_object_ids(jsonb)` — id-шники элементов calculation (triggerActivations/signals).

**Новые публичные RPC** (actor всегда из `auth.uid()`, `set search_path = public`,
`revoke all ... from public, anon`, `grant execute ... to authenticated, service_role`):

| Сервис | Функция сервиса | RPC |
| --- | --- | --- |
| corrections | `createCorrectionFromRecommendation` | `create_correction_from_recommendation` |
| corrections | `updateCorrection` | `update_correction` |
| corrections | `archiveCorrection` | `archive_correction` |
| observations | `createObservation` | `create_observation` |
| observations | `updateObservation` | `update_observation` |
| observations | `createMarker` | `create_behavioral_marker` |
| observations | `updateMarker` | `update_behavioral_marker` |
| observations | `recordMarkerValue` | `record_behavioral_marker_value` |
| follow-ups | `scheduleFollowUp` | `schedule_follow_up` |
| follow-ups | `completeFollowUp` | `complete_follow_up` |
| follow-ups | `cancelFollowUp` | `cancel_follow_up` |
| follow-ups | `evaluateCorrection` | `set_follow_up_ai_assessment` |
| follow-ups | `reviewFollowUpAssessment` | `review_follow_up_assessment` |
| reactivation | `evaluateCoreNodeReactivation` | `create_core_node_reactivation` |
| reactivation | `reviewCoreNodeReactivation` | `review_core_node_reactivation` |

Что именно закрыто по инвариантам:

- Correction + все `correction_targets` + все `correction_expected_markers` + обе
  audit-строки (`correction.create_from_recommendation`, `correction.plan`) — одна
  транзакция; рекомендация, метод (архив/противопоказания) и каждый target
  перепроверяются внутри неё;
- `update_correction` заново проверяет «не archived», наличие expected markers перед
  `completed` и consent `client_portal` внутри транзакции;
- BehavioralMarker + baseline-запись истории + audit — одна транзакция (маркер с
  baseline без history-записи невозможен); `record_behavioral_marker_value` пишет
  history-запись, `current_value`/`trend` и audit вместе (trend считается в SQL тем же
  детерминированным правилом, что и `computeTrend`);
- `review_follow_up_assessment`: финальный вердикт, обе audit-строки и **ModelChange**
  одной транзакцией; guard «effective требует objective evidence» перепроверяется
  внутри SQL; reject не создаёт ModelChange;
- `review_core_node_reactivation`: переход weakened → reactivated, решение по
  proposal, оба audit-ряда и ModelChange одной транзакцией; lifecycle guard
  перепроверяется в момент решения;
- `update_observation`, `update_behavioral_marker`, `schedule/complete/cancel_follow_up`
  и `create_core_node_reactivation` — domain row + audit одной транзакцией.

**Осознанные решения по scope/совместимости:**

- `lib/service/evidence.ts` и `lib/service/dynamics.ts` — read-only (ни одного
  insert/update/rpc), миграция не требуется;
- `create_core_node_reactivation` требует только tenant+assignment (write access):
  детерминированный evaluator и раньше не требовал consent, а его единственный потребитель —
  specialist review; решение по proposal дополнительно пишет `core_nodes`, поэтому для
  него write access проверяется внутри транзакции;
- snapshot generation и explanation decision уже были атомарными после тикета 06 —
  изменения не вносились, тесты `snapshots`/`explanations` остались зелёными;
- `correction_targets` и `correction_expected_markers` добавлены в список
  fault-триггеров `supabase/seed.sql` (вместе с `observations`,
  `behavioral_markers`, `behavioral_marker_entries`, `follow_ups`,
  `core_node_reactivations`); `core_nodes` не добавлялся повторно — триггер уже есть с
  тикета 06.

### Файлы

- `supabase/migrations/0043_atomic_corrections_history.sql` (новый);
- `lib/service/corrections.ts`, `lib/service/observations.ts`, `lib/service/follow-ups.ts`,
  `lib/service/reactivation.ts` — переход на `runAtomicRpc`, удалены парные
  `withAudit`/`recordAudit`/`recordModelChange` для мигрированных мутаций;
- `supabase/seed.sql` — таблицы fault-injection;
- `tests/integration/atomic-corrections-history.integration.test.ts` (новый, 18 тестов).

### Проверки

```
export DOCKER_HOST="unix:///Users/dmitryeliseev/.colima/default/docker.sock"
HOME="$TMPDIR/supabase-home" supabase db reset       # 0043 применена, seed прошёл

pnpm exec vitest run tests/integration/atomic-corrections-history.integration.test.ts
# 1 file / 18 tests passed

pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration
# 86 files / 580 tests passed

pnpm typecheck   # ok
pnpm lint        # ok (eslint + prettier --check)
pnpm test:e2e    # 2 passed
```

Новые тесты доказывают через public service boundary: commit-with-audit для каждой
мигрированной мутации; rollback business-строк при падении `audit_log`; rollback
родителя/маркера при падении дочерней записи; rollback вердикта/перехода при падении
вставки `model_changes` (никакого расхождения ModelChange); reject не создаёт
ModelChange; чужой correction не оставляет observation.


## Ревью и правки ведущего

- **Исправлена выдача прав (least privilege).** В исходной версии миграции
  `insert_model_change_internal` (а также read-only помощники
  `p_payload_missing_required`, `jsonb_object_ids`) получали `EXECUTE` для
  `authenticated`. Обоснование «иначе SECURITY DEFINER RPC не найдёт функцию»
  неверно: RPC выполняются от имени владельца (роль миграции) и вызывают
  помощников с его правами. Выдача `authenticated` открывала неохраняемый
  writer ModelChange в обход tenant/assignment проверок. Гранты убраны, все
  внутренние помощники теперь недоступны ни `anon`, ни `authenticated`
  (проверено запросом к `pg_proc`), а составные RPC продолжают работать —
  подтверждено полным прогоном.
- **Найдена и устранена причина флейка (уточнение после ревью).** Падение
  `follow-ups.integration.test.ts > enforces lifecycle transitions` было не
  «давлением на соединения», а межфайловой интерференцией fault injection:
  маркер `"result_status": "completed"` (см. `fault("follow_ups", "result_status",
  "completed")`) — это распространённое значение, и fault-строка без привязки к
  актору срабатывала на UPDATE чужой строки `follow_ups`, выполнявшемся
  параллельным файлом. Диагностика подтвердила это кодом `P0001
  injected fault on follow_ups (UPDATE)` с чужим `uid`.
  Исправление: у fault-строки появился столбец `actor`, а триггер
  `test_support.inject_fault` срабатывает только если `actor is null` или
  `actor = auth.uid()`; helper `connectFaultInjection().register()` принимает
  необязательный `actorId`, и тесты тикета 07 регистрируют faults от имени своего
  специалиста. После правки: 4 подряд парных прогона и 3 подряд полных прогона
  (88 файлов / 604 теста) — без падений.
  Замечание для будущих тестов: маркер должен быть уникальным, либо fault должен
  быть actor-scoped; общий маркер без актора ломает параллельные наборы.
