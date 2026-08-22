# Data Exchange Contracts

Статус: approved for v1.

Источник продуктовых правил: SPEC.md, особенно §7, §8, §9 и §45. Privacy, consent и retention правила берутся из решения тикета 05. Этот документ задаёт внешние форматы; он не разрешает обходить domain validation, AI gateway или human review.

## 1. Contract suite и versioning

Общая версия набора контрактов: `live-client-map.data-exchange/1.0`.

| Артефакт                 | Идентификатор v1                         |
| ------------------------ | ---------------------------------------- |
| Common import request    | `live-client-map.import-request/1.0`     |
| ChatGPT analysis         | `live-client-map.chatgpt-analysis/1.0`   |
| Signals JSON import      | `live-client-map.signals-import/1.0`     |
| Signals CSV              | `live-client-map.signals-csv/1.0`        |
| Import validation report | `live-client-map.import-report/1.0`      |
| Full client JSON archive | `live-client-map.client-archive/1.0`     |
| Markdown/PDF report      | `live-client-map.snapshot-report/1.0`    |
| Supervision export       | `live-client-map.supervision-export/1.0` |

Версия входит в каждый structured payload. Для plain text и Markdown она находится в import request, а не добавляется в пользовательский текст.

- Major меняется при удалении/переименовании поля, изменении его смысла или enum.
- Minor меняется только при обратно совместимом добавлении optional-поля или новой коллекции.
- Consumer обязан отклонять неизвестный major. Silent fallback запрещён.
- JSON objects являются closed: неизвестные поля отклоняются. Nullable-поле присутствует со значением `null`; его нельзя молча опускать.
- Domain fields, enums и state semantics соответствуют SPEC.md и `docs/data-dictionary.md`. Exchange contract может дополнительно ограничивать импортируемое подмножество, но не расширять доменный enum.

## 2. Общие transport rules

- Текст и JSON: UTF-8. UTF-16, Windows-1251 и другие кодировки отклоняются.
- UTF-8 BOM: принимается только у CSV и удаляется до разбора; экспортируется CSV без BOM по умолчанию. UI может предложить отдельную Excel-compatible копию с BOM, не меняя contract.
- Unicode нормализуется в NFC для сравнения и hashing кандидатов; оригинальные bytes и SHA-256 сохраняются как immutable import source.
- Принимаются LF и CRLF. Raw source не переписывается; parser работает с нормализованной копией.
- Machine dates: `YYYY-MM-DD`. Timestamps: RFC 3339 с timezone offset; server export использует UTC `Z`.
- Machine integers не локализуются. Scores — integer `0..100` или `null`.
- Язык — BCP 47 tag, default `ru`. Язык не меняет enum или названия колонок.
- JSON arrays сохраняют порядок. Duplicate values в set-like arrays `life_areas` и `tags` удаляются после NFC normalization с warning.
- Архивы ZIP и другие compressed uploads в v1 не принимаются.

### Import limits

| Формат                                  | Максимум                           |
| --------------------------------------- | ---------------------------------- |
| Любой upload                            | 10 MiB до декодирования            |
| Plain text / Markdown / ChatGPT content | 1 000 000 Unicode code points      |
| CSV                                     | 50 000 data rows, не считая header |
| Signals JSON                            | 50 000 records                     |
| Одна string cell/value                  | 65 536 Unicode code points         |
| `life_areas` или `tags` одного record   | 100 уникальных значений            |

Oversized input отклоняется до AI processing. Exports не обрезаются и не получают искусственный row limit: генератор либо создаёт полный разрешённый артефакт, либо завершает request typed failure.

## 3. Common import request

Каждый import создаётся с envelope:

```json
{
  "contract": "live-client-map.import-request",
  "version": "1.0",
  "client_id": "UUID",
  "input_format": "plain_text",
  "title": null,
  "language": "ru",
  "performed_at": null,
  "idempotency_key": "caller-generated-string",
  "filename": null
}
```

Правила полей:

| Field             | Contract                                                                    |
| ----------------- | --------------------------------------------------------------------------- |
| `client_id`       | Required target client; значение из файла не может его заменить             |
| `input_format`    | `plain_text`, `markdown`, `chatgpt_analysis`, `signals_csv`, `signals_json` |
| `title`           | `string <= 200` или `null`                                                  |
| `language`        | BCP 47; default `ru`                                                        |
| `performed_at`    | RFC 3339 или `null`; `null` означает время подтверждения import             |
| `idempotency_key` | Required, 16–128 printable ASCII characters                                 |
| `filename`        | Basename без path, `string <= 255` или `null`; только metadata              |

Server самостоятельно вычисляет `content_sha256`; клиентское значение checksum не является trusted input.

## 4. Обязательный import pipeline

Каждый принятый источник проходит:

```text
upload/paste validation
-> immutable source + DiagnosticSession(session_type=import)
-> schema/parser validation
-> AI parsing through ai.ingest-signals.v1
-> validation report and human review
-> explicitly accepted Signals
```

- Нельзя писать импортированные conclusions непосредственно в Theme, CoreNode, DifferentialHypothesis или другую подтверждённую сущность.
- AI candidates имеют `review_status = pending`.
- Только явное действие человека `accept` может создать или перевести Signal в подтверждённый review state. Bulk accept считается human review лишь после preview и confirmation.
- `ai_analysis` consent обязателен, поскольку SPEC.md требует AI parsing. Пока production AI выключен решением тикета 07, production import также выключен feature gate; dev/test принимает только synthetic или irreversibly de-identified data.
- Обязательны tenant, ClientAssignment, `data_storage` и применимые sensitive-data consents.

Container-level ошибки (`invalid_encoding`, `size_limit_exceeded`, malformed top-level JSON, неизвестная версия или отсутствующий CSV header) отклоняют весь upload до создания доменных кандидатов. Валидный container создаёт одну DiagnosticSession и сохраняет исходник, даже если все records впоследствии отклонены.

## 5. Plain text и Markdown import

### Plain text

- Media type: `text/plain; charset=utf-8`.
- Version задаётся как `input_format = plain_text` в import request.
- Content сохраняется без интерпретации разметки.
- Empty или whitespace-only content отклоняется с `empty_content`.

### Markdown

- Media type: `text/markdown; charset=utf-8`.
- Version задаётся как `input_format = markdown`.
- CommonMark-разметка сохраняется как raw source; HTML внутри Markdown рассматривается как text, не исполняется и не отображается без sanitization.
- YAML front matter не имеет управляющей силы и передаётся parser как часть source.

Оба формата создают `DiagnosticSession.input_format` согласно request. Предлагаемые Signals получают source lineage на session и исходные offsets, если parser способен их вернуть.

## 6. ChatGPT analysis import

ChatGPT analysis — тип внешнего источника, а не trusted diagnosis. Поддерживаются два способа:

1. Paste/upload plain text или Markdown с `input_format = chatgpt_analysis`; приложение оборачивает content в canonical envelope.
2. Upload canonical JSON envelope:

```json
{
  "contract": "live-client-map.chatgpt-analysis",
  "version": "1.0",
  "language": "ru",
  "generated_at": null,
  "title": null,
  "content_format": "markdown",
  "content": "Текст анализа",
  "provenance": {
    "source": "chatgpt",
    "model_claim": null,
    "conversation_ref": null
  }
}
```

`content_format` — `plain_text` или `markdown`. `generated_at`, `title`, `model_claim` и `conversation_ref` являются untrusted provenance strings, а не доказательством происхождения или качества. Полный ChatGPT account export, conversation tree, attachments и tool-call transcript в v1 не поддерживаются.

Все извлечённые утверждения получают `source_type = imported_note`. Conclusions из файла по умолчанию являются `epistemic_type = interpretation` или `hypothesis`; они не считаются независимым evidence и не повышают evidence level без отдельного подтверждающего источника и human review.

## 7. Signals CSV v1

CSV следует RFC 4180-подобному layout: delimiter `,`, quote `"`, quote escaping `""`, обязательный header, одна logical record на строку. Multiline quoted cells разрешены. Locale-specific delimiter `;` не поддерживается.

Точный порядок колонок:

```text
contract_version
external_id
source_session_ref
source_type
source_ref
epistemic_type
raw_statement
statement_polarity
test_result
normalized_meaning
inferred_opposite
intensity
confidence
life_areas_json
tags_json
context_json
time_scope
claimed_evidence_level
visibility
source_review_status
source_created_at
source_updated_at
```

В реальном файле это одна header row в указанном порядке.

### Column rules

| Column                   | Required value | Rule                                                               |
| ------------------------ | -------------- | ------------------------------------------------------------------ |
| `contract_version`       | yes            | Exact `live-client-map.signals-csv/1.0`                            |
| `external_id`            | yes            | Unique string `1..128` внутри файла; export использует Signal UUID |
| `source_session_ref`     | no             | External lineage only; не принимается как local FK                 |
| `source_type`            | yes            | Signal `source_type` enum                                          |
| `source_ref`             | no             | External lineage only; не принимается как local FK                 |
| `epistemic_type`         | yes            | Signal `epistemic_type` enum                                       |
| `raw_statement`          | yes            | Non-empty string                                                   |
| `statement_polarity`     | yes            | Signal polarity enum; unknown допустим                             |
| `test_result`            | yes            | Signal test result enum; `not_tested` для отсутствующего теста     |
| `normalized_meaning`     | no             | Candidate text; AI/human review может изменить                     |
| `inferred_opposite`      | no             | Candidate text или empty/null                                      |
| `intensity`              | no             | Integer `0..100` или empty/null                                    |
| `confidence`             | no             | Integer `0..100` или empty/null                                    |
| `life_areas_json`        | yes            | Compact JSON string array, включая `[]`                            |
| `tags_json`              | yes            | Compact JSON string array, включая `[]`                            |
| `context_json`           | no             | Compact JSON object или empty/null                                 |
| `time_scope`             | no             | Domain value/string или empty/null                                 |
| `claimed_evidence_level` | no             | Evidence level, только source claim; не применяется автоматически  |
| `visibility`             | yes            | `internal`, `sensitive` или `client_visible`                       |
| `source_review_status`   | no             | Provenance only; local review всегда начинается с `pending`        |
| `source_created_at`      | no             | RFC 3339 provenance timestamp                                      |
| `source_updated_at`      | no             | RFC 3339 provenance timestamp                                      |

Empty optional cell означает `null`. Arrays обязаны быть `[]`, а не empty. `context_json` является object с известными Context dimensions из SPEC.md; unknown keys отклоняются.

Import никогда не доверяет `external_id` как local database ID и не принимает `organization_id`, `client_id`, `created_by`, local `diagnostic_session_id` или authoritative `review_status` из CSV.

CSV export использует тот же layout. `external_id` получает Signal UUID, lineage fields заполняются из разрешённых source refs, `claimed_evidence_level` содержит текущее evidence level, а `source_review_status` — текущий review status. Re-import сохраняет их как provenance и повторно запускает review.

## 8. Signals JSON import v1

Canonical payload:

```json
{
  "contract": "live-client-map.signals-import",
  "version": "1.0",
  "language": "ru",
  "records": [
    {
      "external_id": "row-1",
      "source_session_ref": null,
      "source_type": "client_report",
      "source_ref": null,
      "epistemic_type": "self_report",
      "raw_statement": "Мне трудно просить о помощи",
      "statement_polarity": "negative",
      "test_result": "not_tested",
      "normalized_meaning": null,
      "inferred_opposite": null,
      "intensity": null,
      "confidence": null,
      "life_areas": [],
      "tags": [],
      "context": null,
      "time_scope": null,
      "claimed_evidence_level": null,
      "visibility": "internal",
      "source_review_status": null,
      "source_created_at": null,
      "source_updated_at": null
    }
  ]
}
```

Field semantics совпадают с CSV. Все поля record присутствуют; semantic null представлен `null`. `records` не может быть пустым. `additionalProperties = false` применяется к top-level и каждому record.

JSON с contract `live-client-map.client-archive` не является Signals import. Archive restore — отдельная privileged migration operation; он не должен ошибочно проходить через ingestSignals.

## 9. Validation, partial success и retry

### Import report

Каждый container-valid import имеет report:

```json
{
  "contract": "live-client-map.import-report",
  "version": "1.0",
  "import_id": "UUID",
  "diagnostic_session_id": "UUID",
  "content_sha256": "lowercase-hex",
  "status": "awaiting_review",
  "counts": {
    "total": 3,
    "valid": 1,
    "invalid": 1,
    "duplicate": 1,
    "warning": 0,
    "accepted": 0,
    "rejected_by_reviewer": 0,
    "committed": 0
  },
  "records": [
    {
      "index": 1,
      "external_id": "row-1",
      "status": "valid",
      "errors": [],
      "warnings": []
    }
  ],
  "fatal_errors": []
}
```

Import status enum:

```text
validating
parsing
awaiting_review
committing
completed
failed
```

Record status enum:

```text
valid
invalid
duplicate
accepted
rejected_by_reviewer
committed
```

Known error codes v1:

```text
invalid_encoding
size_limit_exceeded
empty_content
unsupported_format
unsupported_version
malformed_json
missing_header
unexpected_column
missing_required_value
invalid_enum
out_of_range
invalid_timestamp
invalid_nested_json
schema_violation
duplicate_external_id
duplicate_content
conflicting_idempotency_key
unauthorized
consent_required
ai_unavailable
commit_failed
```

Каждая record error содержит `code`, `field` или `null` и безопасное `message`. Report не дублирует raw sensitive value в error message или logs.

### Partial success

- Container-level failure: ничего не создаётся, кроме security/audit event попытки.
- Record-level failure: валидные records остаются в staging; invalid и duplicate records не становятся Signals.
- Reviewer видит все counts и причины, затем принимает или отклоняет каждый valid candidate.
- Commit выбранного набора выполняется одной database transaction. Он либо создаёт весь выбранный набор, либо не создаёт ничего.
- Report `completed` не означает, что все source rows приняты; authoritative counts показывают результат.

### Idempotency и duplicates

- Import operation key: `(organization_id, client_id, contract version, idempotency_key)`.
- Повтор с тем же key и тем же `content_sha256` возвращает существующие import/session/report и не создаёт новые записи.
- Тот же key с другим content возвращает `conflicting_idempotency_key`.
- Внутри файла сначала сравнивается `external_id`, затем canonical normalized record hash. Первый record остаётся candidate, последующие получают `duplicate`.
- Между imports exact duplicate определяется lineage key `(client_id, source content SHA-256, external_id)`. Он пропускается.
- Semantic similarity не удаляется автоматически. Она создаёт warning `possible_semantic_duplicate` для human review.

### Interrupted import

- До commit: client повторяет запрос с тем же idempotency key и продолжает с сохранённого stage.
- Во время AI call: gateway использует idempotency policy из `docs/ai-contracts.md`; успешный validated result переиспользуется.
- Во время commit: transaction и idempotency record определяют, был ли commit завершён. Нельзя повторно вставлять Signals «на всякий случай».
- После commit: повтор возвращает тот же report со status `completed`.

## 10. Общие export rules

Все exports создаются асинхронным ExportRequest с `export_id`, `client_id`, format, exact contract version, audience, optional snapshot version и idempotency key.

- Export обязан проверять tenant, ClientAssignment, role, active consents, visibility и relationship privacy на момент сборки и ещё раз перед download.
- `internal` доступно назначенным специалистам; `sensitive` — только primary specialist и Owner; `client_visible` дополнительно разрешено client audience.
- Revoked consent немедленно запрещает новый export/download применимого scope. Erasure/legal-hold workflow следует тикету 05.
- Каждый request, completion, download, expiry и denial записывается в AuditLog без raw export content.
- Файл в системе хранится 30 дней, затем удаляется. Скачанная копия находится в зоне ответственности специалиста.
- Имена файлов содержат только opaque reference, timestamp и format; ФИО в filename запрещено.
- Export не делает новых AI conclusions и не меняет business state.
- Silent truncation запрещён. При failure частичный файл не доступен для download.

## 11. Full client JSON archive v1

Media type: `application/vnd.live-client-map.client-archive+json;version=1.0`.

JSON — один UTF-8 файл, не database dump и не ZIP. Top-level layout:

```json
{
  "contract": "live-client-map.client-archive",
  "version": "1.0",
  "export_id": "UUID",
  "generated_at": "2026-08-22T12:00:00Z",
  "source_organization_id": "UUID",
  "subject_client_id": "UUID",
  "manifest": {
    "data_dictionary_version": "1.0",
    "scoring_model_versions": [],
    "ontology_versions": [],
    "snapshot_versions": [],
    "record_counts": {},
    "warnings": [],
    "data_sha256": "lowercase-hex"
  },
  "data": {}
}
```

`data` содержит следующие keys всегда; отсутствующая категория — `[]`, не omitted:

```text
client
consent_records
client_requests
client_goals
life_events
triggers
diagnostic_sessions
diagnostic_session_summaries
signals
evidence_clusters
themes
core_nodes
differential_hypotheses
signal_theme_links
theme_core_node_links
core_node_relations
trigger_activations
resources
development_targets
purpose_profiles
purpose_syntheses
recommendations
recommendation_targets
corrections
correction_targets
correction_expected_markers
observations
behavioral_markers
follow_ups
model_changes
psychological_snapshots
medical_facts
symptom_reports
psychological_hypotheses
relationships
relationship_dynamics
audit_events
reference_catalog
```

`client` — object или `null`; остальные keys — arrays, кроме `reference_catalog`, который является object с массивами только реально referenced DiagnosticDomain, BeliefTemplate и InterventionMethod revisions.

Entity payload использует canonical storage-neutral fields и types соответствующей entity из SPEC/data dictionary v1. Server-managed IDs сохраняются как source IDs для lineage. `record_counts` обязан точно совпадать с сериализованными коллекциями. `data_sha256` считается по canonical JSON serialization только объекта `data`, поэтому checksum не является самоссылочным. Dangling references запрещены: запись либо включает разрешённую target record, либо reference явно заменяется на `null` с manifest warning.

Archive исключает:

- password hashes, auth identities, sessions, secrets и API keys;
- billing/payment data и organization-wide user directory;
- raw AI provider prompts/responses и redaction mapping;
- IP address и user agent из audit events;
- данные другого клиента, не разрешённые relationship consent/visibility.

Relationship records включаются только при active `relationship_analysis` consent обоих клиентов и допустимом доступе экспортёра. Даже тогда private evidence второго клиента не копируется в archive первого; используются только разрешённые privacy-filtered projections. Если условие не выполнено, коллекции relationship пусты и manifest содержит warning без идентификатора второго клиента.

Только Owner с действующим assignment может создавать full archive. Archive является lossless относительно разрешённого portable read model: parse и повторная canonical serialization должны сохранять все значения, source IDs, nulls, array order и references. Byte-for-byte identity не требуется из-за formatting и `generated_at`. Privileged archive restore не входит в tickets 53–54 и проектируется отдельно; importer не должен притворяться, что Signals import восстановил весь archive.

## 12. Signals CSV export v1

CSV export использует точный layout §7 и полный разрешённый набор Signals выбранного клиента.

- Доступ: Owner, primary или secondary specialist с active assignment.
- Visibility фильтруется по роли; secondary specialist не получает `sensitive`.
- Review status сохраняется в `source_review_status`.
- Source и epistemic metadata обязательны; запрещено терять `raw_statement`, `source_type`, `source_ref`, `epistemic_type`, evidence level или review status.
- Archived Signals включаются только при явном `include_archived = true`; default false.
- Rows сортируются детерминированно по `source_created_at`, затем `external_id`.
- Filename: `signals_<opaque-client-ref>_<UTC timestamp>.csv`.

CSV является переносимой Signal projection, но не полным client round-trip. Re-import создаёт новую DiagnosticSession и повторный human review; original database IDs и confirmed status не восстанавливаются автоматически.

## 13. Markdown report и PDF snapshot v1

Оба формата строятся из одного immutable, privacy-filtered `SnapshotReportReadModel`. Request обязан указать `snapshot_version`; default «latest» разрешается только UI, который до создания request преобразует его в точную version.

Audience enum:

```text
specialist
client
```

Одинаковый ordered layout:

1. Document metadata: report contract, generated timestamp, audience, snapshot version.
2. Client label: display name для specialist; одобренное обращение для client.
3. Current requests and goals.
4. Snapshot summary.
5. Active themes.
6. Core hypotheses and evidence-aware explanations.
7. Evidence digest and limitations.
8. Resources.
9. Development targets.
10. Recent model changes.
11. Recommendations and active corrections.
12. Trend summary and next review markers.
13. Provenance: model hash, scoring/ontology versions, AI/prompt versions if present.
14. Disclaimer: hypotheses are working interpretations, not medical diagnoses.

Specialist audience получает `internal` и, при роли primary/Owner, `sensitive` данные. Client audience получает только `client_visible`, explicitly approved explanations и client-visible summaries. Hidden CoreNodes, risk assessments, differential hypotheses, private specialist notes, pending AI output и данные партнёра в client report запрещены.

### Markdown

- UTF-8 CommonMark.
- YAML front matter содержит только `contract`, `version`, `export_id`, `generated_at`, `audience`, `snapshot_version`, `model_hash`.
- Sections используют фиксированные H1/H2 headings из layout; empty section выводится как `Нет подтверждённых данных`, а не удаляется.
- Raw HTML не генерируется.

### PDF

- PDF является визуальным rendering того же read model, а не конвертацией нового AI summary.
- Embedded font обязан поддерживать Cyrillic; default — Noto Sans или metric-compatible approved replacement.
- A4, readable margins, page number и opaque export reference в footer.
- Section heading нельзя оставлять последней строкой страницы; tables и long text обязаны переноситься без обрезки.
- PDF metadata не содержит ФИО; title использует opaque export reference.

Content equality проверяется по normalized report read model, а не по byte equality Markdown/PDF.

## 14. Anonymized supervision export v1

Media type: `application/vnd.live-client-map.supervision-export+json;version=1.0`.

V1 поддерживает только JSON, потому что закрытая allowlist schema легче проверяется на утечки. Export требует одновременно:

- active Supervisor assignment;
- active `supervisor_access` consent;
- active `anonymized_analytics` consent;
- повторную privacy preview и confirmation экспортёра.

Top-level layout:

```json
{
  "contract": "live-client-map.supervision-export",
  "version": "1.0",
  "export_id": "UUID",
  "case_key": "random-per-export-opaque-string",
  "generated_at": "2026-08-22T12:00:00Z",
  "language": "ru",
  "case": {
    "generalized_requests": [],
    "generalized_goals": [],
    "evidence_summary": [],
    "themes": [],
    "core_hypotheses": [],
    "contradictions": [],
    "resources": [],
    "development_targets": [],
    "corrections_and_outcomes": [],
    "trend_summary": null,
    "supervision_questions": []
  }
}
```

Allowlisted content:

- generalized life areas, request and goal descriptions after redaction and human preview;
- evidence level, independent-context count, polarity/test-result aggregates;
- reviewed Theme/CoreNode hypotheses with confidence and contradiction summaries;
- reviewed resources, targets, correction methods and generalized outcomes;
- relative time such as `week_0`, `week_6`, never exact dates;
- explicit questions submitted for supervision.

Всегда запрещены:

- client/organization/user UUIDs, source IDs и stable cross-export pseudonyms;
- ФИО, точная дата/место рождения, адрес, contacts, employer и названия организаций;
- exact event titles/dates/places и rare demographic combinations;
- `raw_statement`, raw session input, private notes, files и verbatim quotations;
- IP/user agent, filenames и provider metadata;
- Relationship/RelationshipDynamic и любые данные второго клиента;
- medical identifiers и подробности, не прошедшие отдельную minimization review.

`case_key` генерируется заново для каждого export и не позволяет получателю связывать разные exports. Mapping client-to-export хранится только в access-controlled AuditLog. Автоматическая redaction не считается достаточной: preview обязателен, а suspected identifier блокирует export до удаления. Этот формат снижает риск re-identification, но не обещает математическую анонимность редкого случая.

## 15. Round-trip matrix

| Format                | Guarantee                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Full JSON archive     | Lossless для разрешённого portable read model; canonical parse/serialize сохраняет values, source IDs, nulls, order и refs |
| Signals JSON import   | Raw source и accepted record lineage сохраняются; local IDs/review state создаются заново                                  |
| Signals CSV           | Signal-level semantic portability; re-import всегда создаёт новую session и review, не полный database round-trip          |
| Plain text / Markdown | Raw bytes/checksum сохраняются; AI candidates не обязаны быть идентичны после смены model/prompt version                   |
| ChatGPT analysis      | Content и provenance сохраняются; conclusions остаются untrusted                                                           |
| Markdown/PDF report   | Snapshot content equality через общий read model; формат не предназначен для import                                        |
| Supervision export    | Намеренно необратим и не предназначен для восстановления клиента                                                           |

## 16. Out of scope v1

- PDF и DOCX extraction/import.
- OCR, image, audio, ZIP и full ChatGPT account export parsing.
- Silent encoding conversion и locale-dependent CSV dialect detection.
- Direct import в confirmed entities без DiagnosticSession, AI parsing и human review.
- Automatic privileged restore full client archive.

Добавление любого пункта требует нового versioned contract и отдельного ticket; агент не должен расширять v1 «по удобству».
