# 18: Собрать полный privacy-safe archive contract

**What to build:** Создать единый contract-compliant assembler для полного Client archive и перепроверить CSV/report/supervision projections, чтобы каждый экспорт имел стабильную схему и применял visibility и relationship privacy до сериализации.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными.

**Status:** resolved

- [x] Full JSON archive всегда содержит все обязательные collections; отсутствующие collections представлены пустыми значениями требуемого типа.
- [x] Manifest counts, contract version, referenced catalog, warnings и canonical data hash точно соответствуют сериализованным данным.
- [x] Silent truncation и dangling references запрещены и приводят к явной failure/warning согласно contract.
- [x] Relationship data включается только при двухстороннем consent и допустимом access без private evidence второго Client.
- [x] Supervisor получает только allowlisted anonymized projection при active assignment и обоих обязательных consents.
- [x] Contract tests покрывают empty collections, privacy filtering, deterministic ordering и отсутствие identifiers/raw content в filenames и logs.

## Implementation result

**Что реализовано**

1. **Единый contract-compliant assembler полного архива** — `lib/service/client-archive.ts`:
   - `ARCHIVE_COLLECTIONS` — ровно 37 коллекций §11 в утверждённом порядке. `data` всегда содержит `client`, все коллекции (пустой массив нужного типа, если данных нет) и `reference_catalog`; `client` — object, `reference_catalog` — object. Ничего не опускается.
   - `record_counts` строится напрямую из сериализованных массивов (по ключу на каждую коллекцию), а `data_sha256` считается по канонической JSON-сериализации **только** объекта `data` (рекурсивная сортировка ключей, порядок массивов сохраняется) — checksum не самоссылочный. `validateClientArchive()` до возврата проверяет полноту `data`, типы, точное совпадение `record_counts` и `data_sha256`.
   - `manifest.ontology_versions`, `scoring_model_versions`, `snapshot_versions` заполняются из реально сериализованных данных (snapshots, recommendations, referenced domains), а не константами.
   - `reference_catalog` — object с `diagnostic_domains` / `belief_templates` / `intervention_methods`: включаются только реально используемые ревизии (домены — по `slug`/`name` из domain-полей архива, методы — по `corrections.intervention_method_id`). `belief_templates` в v1 из portable read model ни на что не ссылаются, поэтому массив пуст (не угадываем ссылки).
   - Исключены: `clients.specialist_notes_private`, `owner_user_id`, user directory, а также `audit_log.ip_address` / `user_agent`; для аудита выбираются только безопасные колонки.
2. **Silent truncation запрещён.** Каждая коллекция читается постранично (`range`, страница 500) и сверяется с `count: exact`; несовпадение → типизированная ошибка `export_truncated` (детали без идентификаторов). Большие `in (...)`-фильтры дочерних коллекций рекурсивно партиционируются (порог 100 id на запрос), чтобы не упереться в лимит длины URL и не потерять строки. Проверено интеграционно на клиенте с 1001 сигналом (и связанной строкой `signal_theme_links`).
3. **Dangling references.** `applyReferencePolicy()` по декларативному графу ссылок заменяет неразрешимую scalar-ссылку на `null` (для массивов — удаляет элемент) и добавляет warning `dangling_reference` с `collection`/`field`/`count`. Значения отсутствующих id в warning не попадают. Полиморфные `target_id` (`target_type` → коллекция) разрешаются по типу.
4. **Relationship privacy до сериализации.** `relationships` включаются только при active `relationship_analysis` consent **обоих** клиентов и `is_client_accessible` для обоих; иначе коллекции пусты и добавляется warning `relationship_withheld` (count, без идентификатора второго клиента). `relationship_dynamics.evidence_refs` редуцируются до `client_visible`-сигналов самого субъекта: private evidence второго клиента и приватные сигналы субъекта не попадают в архив, удалённое количество фиксируется warning `private_evidence_filtered`.
5. **Supervisor projection** — `lib/service/supervision-export.ts`: явный allowlist `SUPERVISION_CASE_KEYS` + `SUPERVISION_ITEM_KEYS`, детерминированная сортировка, отсечение `visibility = sensitive`, проверка `assertAllowlistedProjection()` перед возвратом. Требования сохранены: active supervisor assignment + active `supervisor_access` + `anonymized_analytics`.
6. **Имена файлов и логи** — `lib/service/export-names.ts`: только opaque reference + UTC timestamp + формат (`client_archive_*`, `signals_*`, `supervision_*`); audit payload архива содержит только `export_id`, contract/version, hash и counts, без raw content и без идентификаторов второго клиента.
7. **CSV §12** — исправлена потеря `source_ref` (маппинг на `source_ref_id`), добавлен детерминированный порядок `created_at, id`, archived Signals исключаются по умолчанию с явной опцией `includeArchived`.

**Файлы**

- `lib/service/client-archive.ts` (новый assembler + pure-хелперы).
- `lib/service/export-names.ts` (новый, имена файлов).
- `lib/service/export.ts` (делегирование архива, порядок/lineage/archived в CSV, audit).
- `lib/service/supervision-export.ts` (allowlist, сортировка, отсечение sensitive, filename-хелпер).
- `tests/unit/client-archive.unit.test.ts` (новый, 23 теста).
- `tests/integration/client-archive.integration.test.ts` (новый, 6 тестов).
- `tests/integration/supervision-export.integration.test.ts` (+1 тест, всего 3).
- `tests/integration/export.integration.test.ts` (+2 теста, всего 5).

**Проверки**

- `pnpm typecheck` — успешно.
- `pnpm lint` — успешно (eslint + prettier).
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 103 файла / 768 тестов зелёные.
- `pnpm test:e2e` — 41 тест зелёный (chromium).

**Замечания для ticket 19/20**

- Имена ключей `reference_catalog` (`diagnostic_domains`, `belief_templates`, `intervention_methods`) и формат `manifest.warnings` (`{ code, collection, field, count }`) выбраны здесь, поскольку §11 их не фиксирует; их должен переиспользовать async export/download (ticket 19/20).
- `audit_events` в архиве ограничены событиями `entity_type = 'client'`, `entity_id = subject_client_id`; более широкий scope в контракте не определён.
- Scope `medical_facts` / `symptom_reports` / `psychological_hypotheses` в v1-схеме отсутствует (SPEC §10), поэтому коллекции всегда пусты; это осознанное соответствие «отсутствующая категория — []», а не потеря данных.
- `includeArchived` для CSV — additive optional-поле; default false соответствует §12.
- Полный архив по-прежнему Owner-only и требует active `data_storage`; visibility-гейт `sensitive` для архива не добавлялся (Owner имеет доступ к sensitive), это не менялось.

## Ревью ведущего

- **Контракт не менялся**: `docs/data-exchange-contracts.md` остался без изменений
  (проверено `git status docs/`).
- **Manifest производный, а не декларативный**: `record_counts` строится из
  сериализованных массивов, `data_sha256` считается по канонической сериализации
  `data` (рекурсивная сортировка ключей), а `validateClientArchive()` перед
  возвратом перепроверяет полноту коллекций, совпадение набора ключей counts и
  сам хэш — то есть расхождение manifest и данных невозможно.
- **Silent truncation исключён**: все выборки постраничные с `count: exact` и
  сравнением; несовпадение → типизированная ошибка `export_truncated`. Ссылки
  разбираются с partition по 100 id, чтобы не упереться в лимиты URL.
- **Приватность связей проверена по коду**: `gateRelationships` требует активный
  `relationship_analysis` **для обоих** клиентов и доступ к обоим; при отказе
  коллекции пустые, а предупреждение содержит только счётчик (`relationship_withheld`),
  без идентификатора второго клиента. `relationship_dynamics.evidence_refs`
  сокращаются до `client_visible` сигналов субъекта (`private_evidence_filtered`,
  тоже без id).
- **Supervision**: явный allowlist ключей кейса/элемента + детерминированный
  порядок + фильтр `visibility != sensitive` + самопроверка проекции; имена файлов
  строятся из непрозрачного ref и метки времени, без идентификаторов и сырого
  содержимого.
- **Прогоны**: полный набор 103 файла / 768 тестов — зелёный; `pnpm test:e2e` —
  41 тест; `pnpm typecheck`, `pnpm lint` — зелёные. Агент по ходу работы случайно
  загрязнил системный онтологический каталог тестовыми строками, обнаружил это по
  падению чужих тестов, откатил записи и почистил локальную БД — итоговый прогон
  зелёный, число системных доменов вернулось к 24.
- **Решения, которые нужно подтвердить (важно для 19–20)**: (1) имена ключей внутри
  `reference_catalog` (`diagnostic_domains`/`belief_templates`/`intervention_methods`)
  и форма `manifest.warnings` (`{code, collection, field, count}`) контрактом не
  зафиксированы — они зафиксированы здесь, и тикеты 19–20 должны их переиспользовать;
  (2) `audit_events` в архиве ограничены `entity_type='client' AND entity_id=<client>`;
  (3) фильтрация evidence связей строже прежней: остаются только `client_visible`
  сигналы субъекта, идентификаторы партнёра не попадают даже как `client_visible`.
