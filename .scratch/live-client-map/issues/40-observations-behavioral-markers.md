# 40: Реализовать Observation и BehavioralMarker

**What to build:** Специалист фиксирует наблюдения и измеримые поведенческие признаки до и после Correction.

**Goal:** Дать evaluateCorrection данные, независимые от AI-гипотез.

**Context:** Observation может относиться к Correction или клиенту. BehavioralMarker может быть связан с CoreNode, Theme или Resource.

**Blocked by:** 39 — Correction planning.

**Status:** resolved

## Concrete steps

1. Реализовать Observation и BehavioralMarker contracts.
2. Создать services для baseline, current value, trend и evidence links.
3. Добавить UI ввода observation и изменения marker.
4. Валидировать scales, source, visibility и supports improvement.
5. Покрыть baseline/history и permission tests.

## Acceptance criteria

- [x] Baseline не перезаписывается текущим значением.
- [x] Observation сохраняет source, valence, intensity и confidence.
- [x] Marker имеет не более одного link каждого разрешённого типа по data contract.
- [x] Client-visible и private observations разделены.

## Checks

- [x] Пройдены baseline/change/history и RLS tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

### Файлы

- `supabase/migrations/0029_observations.sql` — таблицы `observations`, `behavioral_markers`, `behavioral_marker_entries` (история значений), индексы, RLS через `is_client_accessible`, grants `authenticated`/`service_role`, RPC `validate_behavioral_marker_link(link_type, link_id, org_id, client_id)` для проверки evidence links (паттерн `validate_correction_target` из 0028).
- `lib/service/observations.ts` — сервис: `createObservation`, `updateObservation`, `listObservations`, `getObservation`, `createMarker`, `updateMarker`, `listMarkers`, `getMarker`, `recordMarkerValue`; экспортируемые helpers `computeTrend` и `isValueInScale`. Zod strict-схемы, `withAudit` для мутаций, `ServiceError`, cursor-пагинация.
- `app/actions/observations.ts` — server actions (create/update observation, create/update marker, record marker value).
- `app/api/observations/route.ts` — GET/POST observations.
- `app/api/behavioral-markers/route.ts` — GET/POST markers; `app/api/behavioral-markers/[id]/route.ts` — GET/PATCH marker; `app/api/behavioral-markers/[id]/values/route.ts` — POST record value.
- `app/observations/page.tsx`, `app/observations/forms.tsx` — страница `/observations`: фильтр по клиенту, списки observations и markers (baseline/current/trend), формы ввода observation, создания marker и записи нового значения.
- `app/page.tsx` — ссылка «Observations и маркеры».
- `lib/supabase/database.types.ts` — перегенерирован (`pnpm db:types`).
- `tests/unit/observations.unit.test.ts` (25 тестов), `tests/integration/observations.integration.test.ts` (12 тестов).

### Принятые решения

- **Enum-значения**: `source_type` = `specialist_observation | client_report | measurement | external_report`; `valence` = `positive | negative | neutral`; `visibility` = `private | client_visible`; `marker_type` = `scale | boolean | frequency | subjective | behavioral_count` (как у expected markers из 0028); `trend` = `improving | stable | worsening | unknown`.
- **Шкалы**: `intensity` — integer 1–10; `confidence` — integer 0–100 (конвенция проекта из `lib/service/validation.ts`). Диапазоны проверяются и zod, и CHECK в БД.
- **История маркера** — отдельная таблица `behavioral_marker_entries` (marker_id, value, note, recorded_by, recorded_at). Baseline при создании пишется как первая запись с note="baseline".
- **Baseline immutability**: `updateMarkerSchema` (strict) не содержит полей baseline/current/trend — попытка передать `baselineValue` отклоняется валидацией. Изменение текущего значения — только через `recordMarkerValue`, которое пишет запись в историю и пересчитывает trend.
- **Trend** — детерминированный: сравнение current с baseline, epsilon = 5% диапазона шкалы; выше baseline → `improving`, ниже → `worsening`, в пределах epsilon → `stable`, нет baseline/current → `unknown` (higher-is-better семантика, направление шкалы задаёт специалист).
- **Evidence links** — три nullable FK-колонки (core_node/theme/resource), структурно «не более одного link каждого типа»; принадлежность той же org/client проверяется RPC `validate_behavioral_marker_link` при create/update.
- **Consent gates**: запись observation/marker требует `data_storage` + `sensitive_psychological_data`; visibility=`client_visible` дополнительно требует `client_portal` (и при создании, и при переключении в update).
- **Client-visible разделение**: клиентский доступ через портал в текущих RLS-хелперах не реализован (`is_client_accessible` покрывает owner/specialist), поэтому разделение обеспечено service-фильтром `visibility` в `listObservations` — client-facing контексты обязаны передавать `visibility="client_visible"` (задокументировано в схеме и покрыто integration-тестом).

### Проверки

- `pnpm lint` — зелёный; `pnpm typecheck` — зелёный.
- `pnpm test` — 45 файлов / 245 тестов, все зелёные (включая новые unit 25 и integration 12).
- `pnpm build` — зелёный, страница `/observations` и API routes собраны.
- Миграция применена к локальной БД (`supabase migration up`).

### Известные ограничения

- Нет UI-формы редактирования observation и метаданных marker (update доступен через service/API и server actions; страница покрывает ввод observation, создание marker и запись нового значения с историей).
- Trend не учитывает направление шкалы (lower-is-better маркеры интерпретируются специалистом).
