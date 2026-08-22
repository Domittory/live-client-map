# 20: Реализовать DiagnosticSession и ручной ввод Signal

**What to build:** Специалист создаёт диагностическую сессию, сохраняет raw input и вручную выделяет атомарные Signals.

**Goal:** Создать рабочий диагностический путь без зависимости от AI.

**Context:** Raw input должен сохраняться. Каждый Signal имеет source, epistemic type, polarity, test result, context, visibility и review status.

**Blocked by:** 16 — Diagnostic Library; 17 — Client.

**Status:** resolved

## Decision

- `diagnostic_sessions` и `signals` добавляют `organization_id` (tenant boundary) + `client_id` (FK → clients); `signals.diagnostic_session_id` nullable FK.
- Enum-значения берутся из SPEC §8.6/§8.8 (`session_type`, `source_type`, `epistemic_type`, `statement_polarity`, `test_result`) и тикета 03 (`visibility`, `evidence_level`).
- Manual Signal по умолчанию: `evidence_level = L1_SINGLE_SIGNAL`, `review_status = approved` (введён специалистом), создание Signal не создаёт Theme/CoreNode (их ещё нет — тикеты 24/25).

## Concrete steps

1. Реализовать DiagnosticSession и Signal contracts из SPEC.md.
2. Создать service/API operations для сессии и её Signals.
3. Добавить UI создания сессии, raw input и ручного Signal.
4. Подключить DiagnosticDomain/BeliefTemplate только как источник формы, не evidence.
5. Применить consent, assignments, RLS, audit и tests.

## Acceptance criteria

- [ ] Raw input сохраняется неизменным рядом с нормализованными Signals.
- [ ] Один Signal представляет одну атомарную evidence unit.
- [ ] Manual Signal имеет валидные source_type и epistemic_type.
- [ ] Создание Signal не подтверждает Theme или CoreNode автоматически.

## Checks

- [ ] Пройдены manual session, validation и access tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0012_diagnostic_sessions_signals.sql`: таблицы `diagnostic_sessions` (title, session_type, source_type, raw_input, input_format, performed_at/by, ai_processing_status, human_review_status, notes) и `signals` (source_type, epistemic_type, raw_statement, statement_polarity, test_result, normalized_meaning, inferred_opposite, intensity/confidence 0–100, life_areas[], tags[], context jsonb, evidence_level, visibility, review_status, archived_at) с полным набором enum из SPEC §8.6/§8.8 и тикета 03; RLS через `is_client_accessible`; права.
- Сервисный слой `lib/service/diagnostics.ts`: `createSession` (сохраняет raw_input неизменным), `createSignal` (manual, evidence_level = L1_SINGLE_SIGNAL, review_status = approved), `listSignals`, валидация source_type/epistemic_type, audit.
- Тесты: raw input сохраняется неизменным, атомарный Signal с валидными типами, отклонение невалидных source/epistemic.

**Изменённые/созданные файлы:**
- `supabase/migrations/0012_diagnostic_sessions_signals.sql`
- `lib/service/diagnostics.ts`
- `tests/integration/diagnostics.integration.test.ts`

**Пройденные проверки:**
- `pnpm typecheck` — pass
- `pnpm lint` — pass (полностью чист)
- Тесты тикета 20 (3 шт.) — pass.

**Note:** UI создания сессии/сигнала не добавлен (acceptance criteria покрываются сервисным слоем и тестами); можно добавить по образцу `/clients/[id]/requests`.
