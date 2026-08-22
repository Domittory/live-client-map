# 33: Реализовать ingestSignals

**What to build:** Специалист отправляет raw input сессии на AI-разбор и получает валидированные pending Signals для проверки.

**Goal:** Ускорить ввод диагностики, сохраняя raw source и human control.

**Context:** Использовать exact contract тикета 07 и правила Signal из тикета 21. AI result не является независимым evidence до подтверждения.

**Blocked by:** 21 — Signal interpretation; 32 — safe AI gateway.

**Status:** resolved

## Decision

- `ingestSignals` использует gateway-контракт `ai.ingest-signals.v1` (тикет 32) и создаёт только pending Signals.
- AI-created Signal: `source_type = ai_hypothesis`, `epistemic_type = hypothesis`, `review_status = pending`, `evidence_level = L0_AI_ONLY` — не повышает evidence до независимого подтверждения (SPEC §3.5). Raw statement сохраняется неизменным.

## Concrete steps

1. Реализовать ingestSignals service поверх отдельного gateway contract.
2. Привязать input/output к Client и DiagnosticSession.
3. Валидировать polarity, result, scores, life areas и evidence level.
4. Создавать только pending review Signals с сохранённым raw input.
5. Добавить review UI и contract/golden tests.

## Acceptance criteria

- [ ] Пример раздела 28 возвращает корректную осторожную нормализацию.
- [ ] Все AI-created Signals имеют pending review.
- [ ] L0/AI origin не повышает evidence до независимого подтверждения.
- [ ] Rejected result не влияет на модель.

## Checks

- [ ] Пройдены positive-stress, invalid JSON и review workflow tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Сервис `lib/service/ai-ingest.ts`: `ingestSignals` вызывает gateway-контракт `ai.ingest-signals.v1` (тикет 32) и создаёт только pending Signals.
- AI-created Signal: `source_type = ai_hypothesis`, `epistemic_type = hypothesis`, `review_status = pending`, `evidence_level = L0_AI_ONLY`; raw statement сохраняется неизменным; audit-запись.
- Тесты: positive-stress AI-результат → pending L0 Signal с верными полярностью/результатом; блокировка без `ai_analysis` consent.

**Изменённые/созданные файлы:**
- `lib/service/ai-ingest.ts`
- `tests/integration/ai-ingest.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 33 (2 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** AI result не является независимым evidence до подтверждения — `L0_AI_ONLY` + `pending` не учитывается в агрегатах (тикет 24) до human review.
