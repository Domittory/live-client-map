# 43: Реализовать ModelChange и PsychologicalSnapshot

**What to build:** Система фиксирует значимые изменения психологической модели и создаёт неизменяемые versioned snapshots.

**Goal:** Дать специалисту воспроизводимую историю состояния клиента.

**Context:** ModelChange не равен AuditLog. Snapshot должен хранить model hash, scoring, ontology, AI model и prompt versions.

**Blocked by:** 16 — OntologyVersion; 28 — scoring; 31 — Purpose; 37 — Recommendations; 41 — evaluation; 42 — reactivation.

**Status:** resolved

## Concrete steps

1. Реализовать ModelChange и PsychologicalSnapshot contracts.
2. Создать deterministic snapshot assembler и model hash.
3. Генерировать ModelChange только для значимых model transitions.
4. Добавить service для получения версии и сравнения с предыдущей.
5. Покрыть immutability, version metadata и repeatability tests.

## Acceptance criteria

- [x] Старый snapshot никогда не переписывается.
- [x] Snapshot содержит все категории из раздела 25 SPEC.md.
- [x] Одинаковая модель и versions дают одинаковый model hash.
- [x] ModelChange содержит previous/new state, reason и evidence refs.

## Checks

- [x] Пройдены snapshot immutability и deterministic hash tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Миграция** `supabase/migrations/0032_model_changes_snapshots.sql`:

- `model_changes` (SPEC §8.31 + `organization_id` для RLS-конвенции): previous_state/new_state jsonb, change_reason, evidence_refs uuid[].
- `psychological_snapshots` (SPEC §8.32) + колонки `weakened_nodes`, `reactivated_nodes`, `current_requests`, `changes_since_previous` для полного покрытия категорий SPEC §25.
- Immutability на уровне БД: только SELECT/INSERT политики; `revoke update, delete` для authenticated (миграция 0002 выдаёт update/delete на новые таблицы через default privileges — пришлось явно отозвать); в сервисном слое нет функций изменения существующих строк.
- `unique (client_id, version)` — версия монотонна per client; конфликт конкурентной генерации ретраится один раз.

**Сервисы**:

- `lib/service/model-changes.ts` — `recordModelChange` (zod strict, withAudit), `listModelChanges` (cursor-пагинация, фильтры entityType/entityId/clientId), `getModelChange`.
- `lib/service/snapshots.ts` — детерминированный assembler `assembleSnapshotContent` (все категории §25 из текущих таблиц; AI-контракт `generateSnapshot` сознательно НЕ используется для сборки — воспроизводимость несовместима с narrative AI; задокументировано в модуле). `computeModelHash` — sha256 по canonical JSON (сортировка ключей и массивов) от контента + версий (scoring_model_version, ontology_version, ai_model, prompt_version). `generateSnapshot` (version = prev+1), `getSnapshot`, `listSnapshots`, `compareWithPrevious` (diff по категориям, пересчитывается из неизменяемых сохранённых данных).

**Интеграция ModelChange** (только значимые transitions, явные вызовы в двух точках):

- `lib/service/reactivation.ts` — approve reactivation записывает переход core_node weakened → reactivated (evidence: proposal + trigger activations + signals).
- `lib/service/follow-ups.ts` — approve assessment записывает completed → финальный verdict (evidence: assessment.evidence_refs).

**UI**: `app/snapshots/page.tsx` + `forms.tsx`, `app/actions/snapshots.ts` — фильтр по клиенту, кнопка «Сгенерировать snapshot», список версий, просмотр snapshot со всеми категориями, сравнение с предыдущей версией, список ModelChanges. Ссылка добавлена в `app/page.tsx`.

**Тесты**:

- `tests/unit/snapshots.unit.test.ts` — canonicalJson (порядок ключей/массивов не влияет), computeModelHash (repeatability, различие входа/версий → другой hash), diffSnapshots (added/removed/changed, все категории).
- `tests/integration/snapshots.integration.test.ts` — 8 тестов: версии и метаданные (scoring/ontology/ai/prompt), repeatability hash при новой version, diff после изменения модели, immutability UPDATE/DELETE на уровне БД для snapshots и model_changes, ModelChange при approve reactivation и approve follow-up assessment, RLS-изоляция.

**Проверки**: `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm test` ✓ (308 тестов, 51 файл), `pnpm build` ✓. Типы перегенерированы (`pnpm db:types`).
