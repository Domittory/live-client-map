# 22: Расширить browser-to-database production journey

**What to build:** Создать один воспроизводимый внешний production-readiness journey с synthetic data, который проходит реальный Owner, Specialist и Client Portal workflow через browser, API и чистый Supabase.

**Blocked by:** 09/Создать client workspace с access management; 10/Добавить client-scoped DiagnosticSessions и Signals; 11/Добавить client-scoped import workflow; 12/Добавить review workflow для Themes, CoreNodes и DifferentialHypotheses; 13/Добавить Resources, DevelopmentTargets, Purpose и Recommendations; 14/Закрыть пробелы BehavioralMarker и ModelChange; 15/Завершить Client Portal authentication и published view; 16/Завершить Client Portal feedback; 17/Завершить password recovery; 18/Собрать полный privacy-safe archive contract; 19/Ввести асинхронное создание ExportRequest; 20/Защитить download и автоматизировать 30-дневный expiry.

**Status:** resolved

- [x] Journey покрывает onboarding, Specialist access, Client creation, consent, diagnostics, Signals, model review, Recommendations, Correction, BehavioralMarker, FollowUp, snapshots и model changes.
- [x] Journey скачивает и валидирует full archive, проходит Client Portal feedback, затем проверяет consent revocation и erasure.
- [x] Assertions используют только visible UI, HTTP contracts, authorized persisted reads, RLS denial, archive contract и audit evidence.
- [x] Intellectual-correctness invariants остаются неизменными: evidence independence, L0 AI-only, competing hypotheses, medical boundaries и insufficient-data wording.
- [x] Journey работает против изолированного приложения и clean database без real PII и private helper assertions.

## Implementation result

### Что реализовано

**1. HTTP-контракт экспорта (нового не было, сервисы тикетов 19/20 существовали).**

- `POST /api/exports` (`app/api/exports/route.ts`) — принимает `{ clientId, kind, audience, snapshotVersion?, idempotencyKey }`, вызывает `createExportRequest` на **пользовательской сессии** (`lib/supabase/server.ts`), поэтому `request_export()` видит `auth.uid()` и внутри своей транзакции перепроверяет tenant, ClientAssignment, audience-роль и consent. `201` — новый запрос (в локальном синхронном пути сразу `available`), `200` — идемпотентный replay.
- `GET /api/exports/[id]/download` (`app/api/exports/[id]/download/route.ts`) — строит Supabase-клиент **из пользовательской сессии**, а не из `getServiceClient()` (иначе `auth.uid()` был бы null и каждая выдача отклонялась бы), вызывает `downloadExportArtifact` (повторная авторизация через `claim_export_download`, чтение private-объекта service-role, сверка sha256, повторная проверка доступа, аудит `export.downloaded`) и отдаёт `toExportDownloadResponse`: точный media type `application/vnd.live-client-map.client-archive+json`, opaque `<kind>_<opaque-ref>_<UTC>.ext` в `Content-Disposition`, `Cache-Control: no-store, private`.
- `app/api/exports/export-errors.ts` — единый маппинг ошибок в безопасные статусы и русские сообщения без утечки внутренностей: `400` validation, `401` unauthorized, `403` denied по доступу/audience/consent или истёкшему retention-window, `404` неизвестный/пропавший артефакт, `409` истёк во время чтения, `429`, `503`, `500` failure. Код ошибки (`error.code`) стабилен, `details` наружу не отдаются.

**2. Минимальный UI-вход.** В client workspace добавлена секция `Экспорт` (`/clients/[id]/export`, Owner-only — full archive по §11 доступен только Owner). Страница (`app/clients/[id]/export/page.tsx`) читает `export_requests` пользовательской сессией (RLS), показывает статусы по-русски и отдаёт opaque-ссылку на скачивание только для `available`. Форма (`export-forms.tsx`) шлёт реальный `POST /api/exports` из браузера и перерисовывает серверный компонент.

**3. Один сквозной journey** `e2e/production-journey.spec.ts`: synthetic-тенант, 18 шагов, один `test` (таймаут 900 c, фактически ~1.1 мин). Шаги: signup Owner → создание клиента и заметок → consent UI (`data_storage`, `ai_analysis`, `sensitive_psychological_data`, `client_portal`) → snapshot v1 → выдача ClientAssignment через UI и вход специалиста → диагностическая сессия + 2 сигнала → импорт (preview + частичный commit) → ревью модели (тема/узел/конкурирующие гипотезы) → рекомендация (черновик AI → явное ревью → отдельная публикация) → Correction из одобренной рекомендации → BehavioralMarker с измерением → FollowUp (schedule/complete/evaluate/approve), порождающий ModelChange → snapshots v2/v3 и сравнение интервалов → медицинская граница через `GET /api/reports/snapshot` → скачивание и независимая валидация full archive → Client Portal (приглашение через Mailpit, published-only view, feedback) → RLS denial → отзыв `ai_analysis`/`data_storage` → erasure и анонимизация аудита.

**Инварианты интеллектуальной корректности проверяются видимо/через персистентные чтения:**
- evidence independence — 2 подтверждённых сигнала из одной сессии дают в ревью «Подтверждённых сигналов: 2, независимых контекстов: 1»;
- L0 AI-only — импортированный сигнал показан как «Ожидает ревью» / «L0» / «недостаточно данных» и не повышается рендером;
- competing hypotheses — `review-hypotheses-note` «не выбирает победителя автоматически», после approve гипотезы A гипотеза B и её противоречащие доказательства остаются;
- medical boundaries — markdown-отчёт содержит дисклеймер «не медицинский диагноз» и «не заменяют консультацию врача»;
- insufficient-data wording — пустой интервал v2→v3 показывает `интервал-no-*` и «Недостаточно данных», а не вывод.

**4. Каналы assertions.** Только visible UI, HTTP-контракты (`/api/exports`, `/api/reports/snapshot`, `/api/ai/run`), authorized persisted reads (service-role как observation channel), RLS denial (чужой тенант: 0 строк и 403 на download), контракт архива (canonical re-serialization, `record_counts`, `data_sha256`, исключения) и audit evidence. Никаких обращений к private helper'ам и никаких проверок порядка запросов.

### Файлы

- `app/api/exports/route.ts` — новый
- `app/api/exports/export-errors.ts` — новый
- `app/api/exports/[id]/download/route.ts` — новый
- `app/clients/[id]/export/page.tsx` — новый
- `app/clients/[id]/export/export-forms.tsx` — новый
- `app/clients/[id]/workspace.ts` — секция `export` (Owner-only)
- `e2e/production-journey.spec.ts` — новый
- `.scratch/production-readiness-remediation/issues/22-browser-production-readiness-journey.md` — этот файл

### Проверки

- `pnpm exec playwright test e2e/production-journey.spec.ts --workers=1 --retries=0` — 1 passed (~1.1 мин).
- `pnpm test:e2e` — 42 passed (41 существующий + journey).
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 110 files / 852 tests passed.
- `pnpm typecheck` — passed; `pnpm typecheck:scripts` — passed; `pnpm lint` — passed.
- `pnpm audit:writes` — 0 violations; `pnpm audit:rpc-permissions` — 0 findings; `pnpm db:types:check` — types match (запускать с `DOCKER_HOST` colima).

### Замечание для ревью (не входит в объём тикета)

Full archive исключает `specialist_notes_private` из проекции `data.client`, но то же значение присутствует внутри `data.audit_events[*].before_data/after_data` (audit-запись `client.updated`). Письменный контракт §11 перечисляет как исключаемые только password/auth, billing/user directory, raw AI prompts и IP/user-agent из audit events, поэтому это не нарушение контракта; риск ограничен тем, что full archive выдаётся только Owner (`export_audience_allowed` ⇒ `client_archive` только Owner), а Owner и так видит приватную заметку в workspace. Решение о редактировании audit-payload'ов оставлено лиду (тикет 18), чтобы не менять утверждённый контракт в рамках 22.

## Ревью ведущего

- **HTTP-контракт выгрузки проверен по коду**: и `POST /api/exports`, и
  `GET /api/exports/[id]/download` строят клиент из пользовательской сессии
  (`createClient()` из `lib/supabase/server`), а не из service-role — иначе
  `auth.uid()` был бы null и все выдачи отклонялись (это отдельно предупреждал
  автор тикета 20). Повторная авторизация выполняется через `claim_export_download`
  перед каждой отдачей; приватный объект читается service-role только внутри
  сервиса, после проверки.
- **Journey — один внешний сценарий**: Owner→Specialist→Client Portal, 18 шагов,
  включая скачивание и независимую валидацию архива, feedback портала, отзыв
  согласий и erasure с анонимизацией аудита. Утверждения — только UI, HTTP,
  авторизованные чтения, RLS-отказы, контракт архива и аудит; приватных
  helper-вызовов в тесте нет. Проверка: 1 тест, ~1.5 мин, проходит против
  изолированного приложения (тикет 02).
- **Инварианты интеллектуальной корректности** остались явными в journey:
  независимость доказательств (2 сигнала из одной сессии = 1 независимый
  контекст), L0 AI-only остаётся pending, конкурирующие гипотезы без авто-победителя,
  медицинская граница, «недостаточно данных» вместо вывода.
- **Прогоны**: полный набор 110 файлов / 852 теста — зелёный; `pnpm test:e2e` —
  **42 теста** (новый journey + 41 прежних); `pnpm typecheck`,
  `pnpm typecheck:scripts`, `pnpm lint`, `pnpm audit:writes` — зелёные.
- **Вопрос приватности для владельца** (агент отметил, я подтверждаю): поле
  `specialist_notes_private` исключено из `data.client` архива, но присутствует
  внутри `data.audit_events[*].before_data`, потому что аудит-записи хранят
  before/after целиком. Формально это не нарушает §11 (архив доступен только
  Owner, который и так видит приватные заметки), но если правило должно быть
  строже — нужно либо вычищать приватные поля из audit-payload, либо явно
  зафиксировать это в контракте. Решение — за владельцем.
