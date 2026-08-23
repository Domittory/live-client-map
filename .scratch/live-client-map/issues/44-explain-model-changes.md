# 44: Реализовать explainModelChanges

**What to build:** После новой диагностики специалист получает осторожное объяснение того, что изменилось и почему.

**Goal:** Сделать динамику модели понятной и проверяемой через evidence trail.

**Context:** AI создаёт explanation, но фактические before/after значения берутся из ModelChange и snapshots, а не из текста модели.

**Blocked by:** 32 — AI gateway; 43 — ModelChange/Snapshot.

**Status:** resolved

## Concrete steps

1. Реализовать отдельный explainModelChanges AI contract. — контракт `ai.explain-model-changes.v1` уже был зарегистрирован в `lib/ai/contracts.ts` (тикет 32); реализован вызывающий его сервис.
2. Передавать только structured diff, evidence digest и version metadata.
3. Валидировать ссылки и запрещать invented changes.
4. Создавать pending explanation с human review.
5. Добавить model change summary UI и grounding tests.

## Acceptance criteria

- [x] Explanation перечисляет только существующие ModelChange records.
- [x] Каждая причина ссылается на evidence или deterministic score diff.
- [x] AI не изменяет модель при объяснении.
- [x] Недостаток данных называется явно.

## Checks

- [x] Пройдены fabricated-change rejection и before/after accuracy tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

- **Миграция** `supabase/migrations/0036_model_explanations.sql`: таблица `model_explanations` (status pending/approved/rejected, source ai/deterministic_guard, explanations jsonb, grounding + grounding_errors, missing_evidence, versions, before/after snapshot refs, run_id). RLS через `is_client_accessible`, grants authenticated (select/insert/update) + service_role; `revoke delete` (истории не удаляются). Выбор хранилища — отдельная таблица: explanation — самостоятельная сущность с human-review lifecycle, а не атрибут snapshot.
- **Сервис** `lib/service/explanations.ts`:
  - `explainModelChanges(client, provider, { clientId })` — собирает input ТОЛЬКО из детерминированных источников: ModelChange records с предыдущего snapshot, before/after snapshot content, resolved evidence digest (signals), deterministic score diffs (`computeScoreDiffs` из snapshot diff), version metadata (через envelope + колонка versions). Никакого свободного текста.
  - Grounding validation (`validateExplanationGrounding`, pure): каждый `model_change_id` обязан быть из входного набора, каждый `evidence_ref` — из реальных evidence refs ModelChange records; fabricated ссылки → explanation сохраняется со статусом `rejected` + `grounding_errors` и не может быть approved (повторная проверка при approve). Дубликаты change ids тоже отклоняются.
  - Недостаток данных: без предыдущего snapshot или без ModelChange records deterministic guard сохраняет pending explanation с явным `missing_evidence` (snapshots / previous_snapshot / model_changes) — AI не вызывается.
  - `reviewModelExplanation` (approve/reject специалистом), `getModelExplanation`, `listModelExplanations` (cursor-пагинация).
  - AI не изменяет модель: модуль пишет только в `model_explanations` (+ ai_runs/audit gateway) — покрыто интеграционным тестом.
- **UI** (SPEC §26): `app/snapshots/page.tsx` — блок «Что изменилось в модели?» (детерминированный: усилилось/ослабло с before → after из snapshot diff, новые CoreNodes/Themes, ослабшие узлы, приоритет коррекций), кнопка «Объяснить изменения (AI)» (`app/snapshots/explanations-forms.tsx`), список explanations с approve/reject; before/after в карточке explanation — из ModelChange record, не из текста AI. Server actions: `app/actions/explanations.ts`.
- **Тесты**:
  - unit `tests/unit/explanations.unit.test.ts` — grounding (валидные ссылки, fabricated change/evidence ids, дубликаты), `computeScoreDiffs` before/after accuracy, схемы.
  - integration `tests/integration/explanations.integration.test.ts` — полный flow (change → snapshots → explain через FakeAiProvider → pending → approve), fabricated-change и fabricated-evidence rejection, insufficient-data guard (AI не вызывается), before/after accuracy payload, неизменность доменных таблиц, RLS.
- `pnpm db:types` выполнен (database.types.ts — только аддитивные изменения, +277 строк).
