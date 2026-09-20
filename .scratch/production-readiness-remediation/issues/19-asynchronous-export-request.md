# 19: Ввести асинхронное создание ExportRequest

**What to build:** Ввести идемпотентный asynchronous ExportRequest lifecycle, который собирает утверждённый artifact, публикует только полностью завершённый файл в private storage и сохраняет auditable state transitions.

**Blocked by:** 18/Собрать полный privacy-safe archive contract.

**Status:** resolved

- [x] Request фиксирует Client, format, exact contract version, audience, optional snapshot version и idempotency key.
- [x] Lifecycle различает requested, generating, available, failed и denied states с actor/timestamps.
- [x] Повтор эквивалентного request возвращает прежний export, а conflicting idempotency input отклоняется.
- [x] Artifact сохраняется в private storage под opaque filename без direct identifiers.
- [x] Partial или failed file никогда не получает downloadable state.
- [x] Request, completion, denial и failure имеют AuditLog без raw export content.

## Implementation result

**Что реализовано**

1. **Таблица `public.export_requests`** (migration `0051_asynchronous_export_request.sql`)
   фиксирует всё, что требует §10: `client_id`, `organization_id`, `kind`
   (`client_archive` / `signals_csv` / `supervision_export`), `format`, exact
   `contract_version`, `audience` (`owner` / `specialist` / `supervisor` /
   `client`), optional `snapshot_version` и `idempotency_key`. Плюс lifecycle:
   `status`, `requested_at`, `generated_at`, `completed_at`, `failed_at`,
   `denied_at`, `expires_at`, `artifact_path`, `artifact_filename`,
   `artifact_sha256`, `artifact_bytes`, `failure_code`.
   `UNIQUE (organization_id, idempotency_key)` — единственный источник
   идемпотентности. Enumerated types (`export_request_status` и др.) и
   CHECK-констрейнты закрывают инварианты:
   - `status = 'available'` невозможен без полного artifact metadata-набора
     (path + filename + sha256 + bytes > 0 + `completed_at`);
   - `failed` / `denied` обязаны иметь `failure_code`;
   - `snapshot_version` заполнен ровно для report-форматов (markdown/pdf).
   RLS: `select`-политика «участник организации, имеющий доступ к клиенту, либо
   Owner»; политик INSERT/UPDATE/DELETE нет — запись только через RPC.

2. **State machine** `requested → generating → available / failed / denied`
   (`expired` заведён для retention-джобы ticket 20), каждый переход с actor и
   timestamp. Три `security definer` RPC с `set search_path = public`,
   проверками `auth.uid()`, tenant (`is_org_member` + `is_client_accessible`) и
   узкими `grant execute`:
   - `request_export(client, kind, format, contract_version, audience,
     idempotency_key, snapshot_version)` — одной транзакцией: разрешает
     `effective organization_id` клиента, валидирует kind↔format↔contract
     version, обрабатывает идемпотентность, вставляет строку сразу в
     `generating`, пишет `export.requested`, затем внутри той же транзакции
     проверяет audience и consents. Отказ фиксируется как реальный переход
     `denied` + AuditLog `export.denied` (реализовано через exception-handler,
     который НЕ делает re-raise: `raise` в обработчике откатил бы собственные
     записи `denied`/audit) и возвращается сервису как `state = 'denied'`,
     который отдаёт наружу прежний контракт — `FORBIDDEN`;
   - `complete_export_request(...)` — единственный способ получить `available`;
     требует полный artifact-набор, берёт строку `FOR UPDATE`, разрешает переход
     только из `generating` и только если `artifact_path is null` (повторное
     завершение невозможно), пишет `export.completed`;
   - `fail_export_request(...)` — `generating → failed`, обнуляет artifact-поля,
     пишет `export.failed` с устойчивым кодом (`generation_failed` /
     `access_revoked` / `invalid_artifact` / `artifact_not_recorded`), никогда не
     кладёт сырой текст ошибки.
   `denied` пишется только для того, кто уже прошёл tenant и client-access
   проверки: посторонний tenant не получает ни строки, ни audit-записи о чужом
   клиенте.

3. **Идемпотентность.** Эквивалентный повтор (совпадают client, kind, format,
   contract version, audience, snapshot version) возвращает ту же строку — в том
   числе с прежним терминальным исходом `available` / `failed`; повтор в
   `available` ничего не генерирует и не пишет новых audit-строк. Тот же ключ с
   другими параметрами → SQLSTATE 23505 → типизированный `CONFLICT`.

4. **Private storage.** Bucket `client-exports` объявлен прямо в миграции
   (`public = false`, `file_size_limit`, allowlist media types), поэтому
   `supabase db reset` и любое чистое окружение сходятся к одному private bucket
   без `supabase stop/start`. Layout:
   `<organization_id>/<export_request_id>/<kind>_<opaque-ref>_<UTC timestamp>.<ext>`;
   `opaque-ref` — sha256-дайджест export id (16 hex), kind — контрактное слово.
   Ни в filename, ни в object path нет ФИО, client id, названия организации или
   содержимого. На `storage.objects` нет политик для `authenticated`/`anon`, то
   есть artifact недоступен через Storage API даже самому заказчику (это
   проверяется интеграционным тестом); запись делает service-role (server-side
   job), а решение о доступе принимается в RPC под сессией пользователя.

5. **Partial / failed file не становится downloadable.** Артефакт собирается и
   хешируется до загрузки; `complete_export_request` принимает только полный
   набор метаданных и только из `generating`; загрузка идёт с `upsert: false`.
   Если запись completion падает, объект удаляется best-effort, а строка
   остаётся не-downloadable (`failed`). Отдельный интеграционный тест с fault
   injection доказывает, что падение audit-append в completion откатывает и
   обновление строки, и audit-запись целиком, а повтор с тем же idempotency key
   успешно доводит экспорт до `available`.

6. **AuditLog без raw content.** `export.requested`, `export.completed`,
   `export.denied`, `export.failed` пишутся через `append_audit` в той же
   транзакции: actor прибит к `auth.uid()`, entity — `client` + `client_id`,
   payload содержит только export id, kind/format/contract/audience,
   `artifact_sha256`, размер и counts. Сырое содержимое, имена клиентов, storage
   path и тексты ошибок в audit не попадают (проверено тестом).

7. **Переиспользование ticket 18 вместо второй ветки сборки.**
   `assembleClientArchive` отдаёт сборку манифеста/данных в новую
   `buildClientArchive`; артефакт асинхронного экспорта использует ту же
   `buildClientArchiveArtifact` (плюс `export_id`/`generated_at` теперь можно
   передать снаружи — в async-пути `export_id` архива равен id ExportRequest).
   Аналогично вынесены `loadSignalsForExport`/`renderSignalsCsv` (CSV §12) и
   `loadSupervisionSource`/`projectSupervisionCase` (§14), поэтому синхронный и
   асинхронный пути не могут разойтись в правилах доступа и в байтах артефакта.

**Файлы**

- `supabase/migrations/0051_asynchronous_export_request.sql` (новый: таблица,
  типы, RPC, RLS, private bucket, grants).
- `supabase/seed.sql` (+1 таблица в списке fault-injection — иначе нельзя
  доказать атомарность completion).
- `lib/service/export-names.ts` (opaque export ref, имя/путь артефакта, media
  types, bucket, `EXPORT_KINDS`).
- `lib/service/client-archive.ts` (`buildClientArchive`, `ClientArchiveInput`,
  `ClientArchiveArtifact`, `buildClientArchiveArtifact`, `mergeWarnings`,
  `CLIENT_ARCHIVE_MEDIA_TYPE`; `assembleClientArchive` теперь принимает
  `exportId`/`generatedAt`).
- `lib/service/export-artifact.ts` (новый: `buildExportArtifact`, `ExportJob`,
  `artifactChecksum`, `ExportJobBuilder`).
- `lib/service/export-storage.ts` (новый: приватная загрузка/удаление артефакта).
- `lib/service/export-request.ts` (новый: `createExportRequest`, схема входа,
  `ExportRequestTicket`, `EXPORT_KIND_CONTRACTS`, маппинг failure-кодов).
- `lib/service/export.ts` (`loadSignalsForExport`, `renderSignalsCsv`,
  константы контракта CSV).
- `lib/service/supervision-export.ts` (`loadSupervisionSource`,
  `projectSupervisionCase`).
- `tests/unit/export-request.unit.test.ts` (новый, 29 тестов).
- `tests/integration/export-request.integration.test.ts` (новый, 11 тестов).

**Проверки**

- `supabase db reset` (DOCKER_HOST=colima) — миграция 0051 применяется на чистой БД.
- `pnpm typecheck` — успешно.
- `pnpm lint` (eslint + prettier) — успешно.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration`
  — **105 файлов / 808 тестов зелёные** (было 103/768; +2 файла, +40 тестов).
- `pnpm test:e2e` — 41 тест зелёный (chromium).
- При первом полном прогоне один раз мигнул предсуществующий флейк
  `tests/integration/client-archive.integration.test.ts` (setup падал на
  параллельной нагрузке); файл в изоляции зелёный, повторный полный прогон
  зелёный — к изменениям тикета отношения не имеет.
- Первая версия правки `assembleClientArchive` удваивала `dangling_reference`
  count в manifest; ошибку поймал интеграционный тест ticket 18 и она исправлена
  (warnings теперь сливаются из одного источника).

**Примечания**

- Тикет требует «сделать storage layout и state machine явными и
  документированными»: это сделано здесь, в комментариях миграции и модулей
  (state machine, layout, кто пишет, что означает `available`). Раздел «Общие
  export rules» §10 `docs/data-exchange-contracts.md` уже покрывает асинхронный
  ExportRequest и не менялся — утверждённый контракт не затронут.
- `lib/supabase/database.types.ts` намеренно не перегенерирован (это генератор
  схемы, а не доменный контракт); сервис объявляет локальный row-интерфейс, как
  принято в остальных сервисах.
- Состояние `requested` присутствует в типе и CHECK как первый шаг state machine,
  но приложение его не оставляет: `request_export` вставляет строку сразу в
  `generating`, чтобы нельзя было «запарковать» запрос и не начать генерацию.
- `expires_at` по умолчанию `created_at + 30 дней` — заготовка для retention
  (ticket 20).

## Что должен знать ticket 20

- **Downloadable state — только `status = 'available'`.** Скачивать можно лишь
  строку с непустыми `artifact_path`, `artifact_filename`, `artifact_sha256`,
  `artifact_bytes`.
- **Bucket:** `client-exports` (private, объявлен в migration 0051; менять
  только вместе с `allowed_mime_types`).
- **Object path:**
  `<organization_id>/<export_request_id>/<kind>_<opaque-ref>_<UTC timestamp>.<ext>`
  (`opaque-ref` = `opaqueExportRef(export_id) = sha256(export_id)[0..16]`).
  Уникальность объекта обеспечена уникальностью export id, `upsert` запрещён.
- **Media types:** `EXPORT_MEDIA_TYPES` / `exportMediaType(kind)` в
  `lib/service/export-request.ts`.
- **Retention hook:** `expires_at` уже заполнен (+30 дней), состояние `expired`
  есть в `export_request_status`. Джобе ticket 20 нужно переводить
  `available → expired`, удалять объект из bucket и аудировать событие; для
  удаления уже есть `removeExportArtifact(path)`.
- **Recovery-путь для незавершённых:** краш процесса между
  `request_export` и `complete_export_request` оставляет строку в `generating`
  без artifact. Повтор с тем же idempotency key продолжает генерацию (проверено
  тестом). Ticket 20 стоит добавить в retention-джобу и уборку «зависших»
  `generating` (по `requested_at`), иначе такой ключ навсегда закреплён за
  незавершённым запросом.
- **Повторная проверка перед download** (tenant/assignment/role/consent/
  visibility/relationship privacy) — целиком зона ticket 20; ticket 19
  проверяет всё это только в момент создания request и при сборке.
- **Orphan-объекты:** если completion-RPC упал, сервис удаляет объект
  best-effort; остаточные объекты (например, при падении процесса) не
  downloadable, и их должна подчищать retention-джоба.

## Ревью ведущего

- **Найден и закрыт пробел в правах (важно).** В исходной версии
  `complete_export_request` и `fail_export_request` были доступны роли
  `authenticated` и проверяли только членство в организации. Это позволяло любому
  участнику с доступом к клиенту перевести запрос в `available` с произвольными
  метаданными артефакта (без реального файла) либо «уронить» чужой экспорт —
  то есть состояние «готово к скачиванию» не было гарантированно системным.
  Исправлено: переходы `generating → available/failed` теперь **только
  `service_role`** (ревок у `authenticated`), а актор перехода берётся из новой
  колонки `export_requests.actor_user_id`, зафиксированной при создании запроса
  (`request_export`, от `auth.uid()`). Аудит системного перехода пишет внутренний
  `append_export_audit` (EXECUTE отозван у public/anon/authenticated), потому что
  `append_audit` требует членства в организации для текущего актора, а у
  service_role JWT-субъекта нет.
- **Права проверены в БД**: `request_export` — `authenticated`+`service_role`
  (пользователь просит экспорт); `complete_export_request`, `fail_export_request`,
  `append_export_audit` — только `service_role`; `anon` не может ничего.
- **Хранилище приватное**: бакет `client-exports` создан с `public = false`, политик
  на `storage.objects` для `authenticated`/`anon` нет — объект недостижим даже
  запросившему; выдача файла — отдельный перепроверяемый шаг (тикет 20).
- **Гарантия «partial никогда не downloadable»**: `available` достижимо только
  через `complete_export_request` с полным набором path/filename/sha256/bytes>0
  (плюс CHECK-констрейнт на таблице), вызов идёт из серверного job через
  service_role, а неудача генерации пишется как `failed` с обнулением
  artifact-полей.
- **Прогоны**: полный набор 105 файлов / 808 тестов — зелёный; `pnpm test:e2e` —
  41 тест; `pnpm typecheck`, `pnpm lint` — зелёные. Тест rollback-а обновлён
  осознанно: fault теперь регистрируется без актора (маркер — id экспорта,
  уникальный), потому что завершение выполняется системным актором.
- **Для тикета 20**: downloadable = `status='available'`; бакет `client-exports`;
  путь `<org_id>/<export_request_id>/<kind>_<opaque-ref>_<UTC>.<ext>`;
  `expires_at` = +30 дней, состояние `expired` заведено; удаление —
  `removeExportArtifact(path)`; перед скачиванием нужно заново проверить
  tenant/assignment/role/consent/visibility; «зависшие» `generating` нужно
  подчищать, иначе idempotency-ключ закреплён навсегда.
