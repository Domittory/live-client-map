# 20: Защитить download и автоматизировать 30-дневный expiry

**What to build:** Выдавать готовый export только после повторной authorization/privacy проверки непосредственно перед download и автоматически удалять private artifacts через 30 дней с полной audit evidence.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными; 19/Ввести асинхронное создание ExportRequest.

**Status:** resolved

- [x] Перед каждым download повторно проверяются tenant, assignment, role, consent, visibility и relationship privacy.
- [x] Revoked access или consent запрещает delivery ранее подготовленного artifact и создаёт denial audit event.
- [x] Successful download аудируется без filename identifiers, signed URL или raw content.
- [x] Через 30 дней artifact удаляется, ExportRequest переходит в expired state и событие аудируется.
- [x] Expiry/deletion process идемпотентен и безопасно повторяется после частичного operational failure.
- [x] Time-controlled contract tests проверяют download, denial, expiry и отсутствие доступа к удалённому object.

## Решения (приняты в рамках тикета)

1. **Выдача только через сервер, без signed URL.** Object лежит в private bucket `client-exports` без storage policies, поэтому скачать его напрямую нельзя. Сервис читает object service-role клиентом, сверяет байты с sha256, записанным при completion, и отдаёт их вызывающему. Signed URL не создаётся: он переживает решение об authorization и может быть использован после revocation.
2. **Повторная авторизация — отдельный RPC `claim_export_download`.** Он выполняется от имени вызывающего (`auth.uid()`) и заново проверяет tenant + ClientAssignment (`is_org_member` + `is_client_accessible`), audience/role (`export_audience_allowed`), consent по типу export, relationship privacy и срок хранения. После чтения object перед самой отдачей выполняется ещё один узкий re-check `is_client_accessible`, чтобы revocation во время чтения тоже блокировала выдачу.
3. **Denial возвращается состоянием, а не исключением.** PostgREST выполняет один RPC в одной транзакции, поэтому функция, которая записала denial audit и потом `raise`, откатила бы собственные записи (тот же урок, что в тикете 19). `claim_export_download` пишет `export.denied` + `download_denied_count` и возвращает `outcome = 'denied'`, а сервис преобразует это в привычный `FORBIDDEN`.
4. **Relationship privacy — правило «отзыва».** Для client archive выдача запрещается, если у партнёра по relationship отозван `relationship_analysis` consent (без него §11 не включает relationship в архив). Сравнение с `generated_at` сознательно не используется: оно гоняется с микросекундами между выдачей consent и сборкой файла. Чувствительность — консервативная; лечение — новый export request.
5. **Просроченный artifact — не denial.** Если `expires_at` прошёл или статус не `available`, RPC возвращает `outcome = 'unavailable'` без denial-события: закрытие строки — задача retention job, а не отказ в доступе.
6. **Удаление объекта — в сервисе, DB-переход — в RPC `expire_export_requests`.** Сначала удаляется object, затем строка переходит в `expired`; поэтому падение между шагами безопасно: повторный запуск удаляет нечего (отсутствующий object — не ошибка) и всё равно закрывает строку. Кандидаты выбираются `for update skip locked`, каждая строка коммитится отдельно, терминальные строки не являются кандидатами — повторный запуск не пишет второе событие.
7. **Зависшие `generating` request.** Закрываются как `failed` / `generation_timeout` с событием `export.failed`: терминальное состояние освобождает строку от повторного сканирования и не держит idempotency key вечно.
8. **Точная команда retention job:**
   ```bash
   node --experimental-strip-types \
     --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
     --import ./scripts/support/register-alias.mjs \
     scripts/reap-exports.ts
   ```
   Опции: `--limit <n>` (по умолчанию 100, максимум 1000), `--dry-run`. Для standalone-запуска добавлен резолвер алиасов `scripts/support/alias-loader.mjs` + `register-alias.mjs` (Next/Vitest знают alias `@/*` из tsconfig, обычный Node — нет).
9. **Контракт расширен только аддитивно.** В `docs/data-exchange-contracts.md` §10 добавлены подразделы 10.1 (Download) и 10.2 (Retention). Утверждённые §10–§14 не изменялись.
10. **Download API route не добавлялся.** Тикет требует «service module plus a scheduled/CLI entry point»; UI/route для export ещё не существует (ticket 19 тоже не добавлял route). Сервис готов к подключению: `downloadExportArtifact()` + `toExportDownloadResponse()`.

## Implementation result

Реализована безопасная выдача экспортов и автоматический 30-дневный retention.

**Что сделано**

- **Повторная авторизация перед каждой выдачей** (`claim_export_download`): tenant, ClientAssignment, audience/role, consent по типу export, relationship privacy и срок `expires_at` проверяются заново от имени вызывающего. Отозванный assignment/role/consent блокирует выдачу уже подготовленного artifact; отказ пишется как `export.denied` с stable code (`download_consent_revoked`, `download_audience_revoked`, `download_relationship_consent_revoked`) и инкрементом `download_denied_count`. Вызывающий без tenant/client доступа не получает audit-след (как в `request_export`).
- **Выдача байтов**: приватный bucket без storage policies → сервис читает object service-role клиентом, проверяет размер и sha256 против записи completion, делает финальный re-check доступа и только затем отдаёт `Response` с opaque filename, contract media type и `Cache-Control: no-store, private`. Signed URL не создаётся.
- **Аудит успешной выдачи** (`record_export_download`, service_role): `export.downloaded` содержит kind, format, contract version, audience, размер байт, sha256 и счётчик скачиваний. Filename, storage path, signed URL и raw content не попадают ни в audit, ни в логи. Тест проверяет, что сериализованные audit-строки не содержат имени файла, `client-exports` и текста сигнала.
- **Retention** (`lib/service/export-retention.ts` + `scripts/reap-exports.ts`): удаление object из private bucket, переход в `expired` с `expired_at`, очистка `artifact_path`/`artifact_filename`, событие `export.expired`; зависшие `generating` закрываются как `failed` / `generation_timeout` с событием `export.failed`. Процесс идемпотентен (повторный запуск — 0 действий, ни одного лишнего события) и переживает частичный сбой в обе стороны (object удалён, строка ещё `available`; строка `expired`, object остался — недостижим, т.к. любой claim для не-`available` отклоняется).
- **Least privilege**: `claim_export_download` — `authenticated` + `service_role`; `record_export_download` и `expire_export_requests` — только `service_role`; helper relationship privacy не выдан никому. `anon` не получил ни табличных, ни исполнительных прав.

**Files changed**

- `supabase/migrations/0052_export_download_retention.sql` (new) — колонки `expired_at`, `last_downloaded_at`, `download_denied_count`, check `expired_at`, индекс `(status, expires_at)`, helper `export_relationship_consent_withdrawn`, RPC `claim_export_download`, `record_export_download`, `expire_export_requests`, grants.
- `lib/service/export-delivery.ts` (new) — `claimExportDownload`, `downloadExportArtifact`, `deliveredChecksum`, `exportContentType`, `exportDownloadHeaders`, `toExportDownloadResponse`.
- `lib/service/export-retention.ts` (new) — `listDueExportRequests`, `reapExpiredExports`, `RETENTION_BATCH_SIZE`, `RETENTION_MAX_BATCH_SIZE`.
- `scripts/reap-exports.ts` (new) — CLI с `--limit` и `--dry-run`.
- `scripts/support/alias-loader.mjs`, `scripts/support/register-alias.mjs` (new) — резолвер алиасов для standalone Node.
- `tests/unit/export-delivery.unit.test.ts` (new) — 12 проверок: media type, checksum выданных байт, заголовки ответа без identifier'ов и signed URL, границы batch.
- `tests/integration/export-download-retention.integration.test.ts` (new) — 16 time-controlled контрактных тестов.
- `docs/data-exchange-contracts.md` — аддитивные §10.1 и §10.2.
- `package.json` — скрипт `typecheck:scripts`; `tsconfig.json` — исключён `scripts`; `tsconfig.scripts.json` (new) — typecheck скриптов с `allowImportingTsExtensions`.

**Проверки**

- `pnpm typecheck` — прошёл; `pnpm typecheck:scripts` — прошёл.
- `pnpm lint` (eslint + `prettier --check .`) — прошёл.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — после `supabase db reset`: **107 файлов / 836 тестов, все прошли**. Первый прогон до reset дал 7 падений в `tests/integration/import-selection.integration.test.ts` (`Validation failed` в `previewSignalsCsv`); файл не связан с тикетом 20 и полностью проходит в изоляции (`8 passed`) — известная флейкость общего локального DB под параллельной нагрузкой.
- `pnpm test:e2e` — 41 passed.
- CLI проверен вручную на реальном локальном storage: `--dry-run` показал due-строки, реальный запуск дал `scanned=2 expired=2 failed=0 storage_errors=0`, повторный запуск — нули; в БД обе строки `expired` с очищенным `artifact_path`, в audit_log ровно по одному `export.expired` на строку.

**Известные ограничения / что важно для тикетов 21–23**

- Download API route и UI намеренно не добавлены: сервис готов (`downloadExportArtifact` + `toExportDownloadResponse`), но маршрутизацию и экран должен добавить UI-тикет. При подключении route должен создавать клиент из пользовательской сессии (`lib/supabase/server.ts`), а не service-role.
- `export_requests.actor_user_id` ссылается на `auth.users` без `on delete cascade`, поэтому тестовая уборка пользователя с export-историей в БД может упасть; в интеграционном тесте уборка идёт через удаление организации/клиента. Наблюдение (не блокер тикета 20): по этой же причине `afterAll` с `admin.auth.admin.deleteUser` оставляет тестовых пользователей в dev-БД — так же ведёт себя существующий `export-request.integration.test.ts`.
- Выдача не ограничена по количеству скачиваний (только аудит и счётчик) — если продукт захочет rate limit, это отдельное решение.
- Правило relationship privacy консервативно: отзыв consent партнёром блокирует выдачу архива, даже если artifact был собран раньше; восстановление consent возвращает выдачу того же файла (тест проверяет оба направления).

## Ревью ведущего

- **Права проверены в БД**: `claim_export_download` доступен `authenticated`
  (пользователь запрашивает выдачу от своего имени, `auth.uid()` обязателен),
  `expire_export_requests` и `record_export_download` — только `service_role`;
  `anon` не может ничего. Никаких signed/public URL в коде нет (проверено grep):
  байты отдаются после повторной проверки, с `Cache-Control: no-store, private`.
- **Повторная авторизация перед выдачей** выполняется в `claim_export_download`
  (tenant, assignment, audience/role, consent по типу экспорта, relationship
  privacy, `expires_at`), а непосредственно перед отдачей байтов есть ещё один
  узкий re-check `is_client_accessible`. Отказ пишется durable-событием
  `export.denied` (без исключения, иначе PostgREST откатил бы собственную
  audit-запись), а вызывающий без tenant-доступа получает 42501 без фабрикации
  audit-следа.
- **Аудит успешной выдачи** содержит только kind/format/contract/audience/bytes/
  sha256/счётчик — без имени файла, org id и содержимого (проверено тестами).
- **Retention идемпотентен**: проверил лично — CLI `scripts/reap-exports.ts`
  запускается, повторный прогон даёт `scanned=0 expired=0 failed=0
  storage_errors=0`; порядок «сначала удалить объект, потом пометить строку
  `expired`» плюс `for update skip locked` и терпимость к отсутствующему объекту
  делают повтор безопасным после частичного сбоя. Зависшие `generating` закрываются
  как `failed`, поэтому idempotency-ключ не залипает.
- **Контракт изменён аддитивно**: в `docs/data-exchange-contracts.md` добавлено 25
  строк (§10.1/§10.2), удалённых строк нет.
- **Прогоны**: полный набор 107 файлов / 836 тестов — зелёный; `pnpm test:e2e` —
  41 тест; `pnpm typecheck`, `pnpm typecheck:scripts`, `pnpm lint` — зелёные.
- **Что важно знать тикетам 21–23**: (1) UI/route выдачи ещё нет — сервис
  `downloadExportArtifact()`/`toExportDownloadResponse()` готов, но route должен
  строиться на пользовательской сессии, а не на service-role, иначе `auth.uid()`
  будет null; (2) между финальным re-check и записью факта выдачи есть
  миллисекундное окно (полностью неустранимо без отзыва уже отданных байтов);
  (3) объекты от упавших генераций, чья строка уже `failed`, reaper не подчищает —
  нужен отдельный storage-sweep, если это важно; (4) `download_count` — телеметрия
  без rate limit.
