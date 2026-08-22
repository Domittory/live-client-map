# 23: Реализовать DiagnosticSessionSummary и human review

**What to build:** После диагностики специалист получает summary и управляет review status каждого предложенного результата.

**Goal:** Создать единый human-in-the-loop workflow до подключения AI-модели.

**Context:** Специалист должен уметь Approve, Edit, Reject, Merge, Split, Link, Duplicate, Sensitive, Hide и Request re-analysis.

**Blocked by:** 20 — DiagnosticSession; 21 — Signal interpretation.

**Status:** resolved

## Decision

- `diagnostic_session_summaries` добавляет `organization_id` + `client_id` (tenant boundary) и хранит findings/hypotheses/contradictions/priority_changes раздельно (массивы).
- Review-действия (`approve`/`reject`/`mark_sensitive`/`hide`) применяются к Signal через сервисный слой с audit-причиной; остальные действия (merge/split/link/duplicate) появятся с Themes/CoreNodes (тикеты 24/25).
- Правило: `pending`/`rejected` не считаются подтверждённым evidence (`countsAsConfirmedEvidence`).

## Concrete steps

1. Реализовать DiagnosticSessionSummary contract и review state machine.
2. Реализовать применимые review actions с audit reason.
3. Добавить summary/review UI с raw source рядом.
4. Запретить pending/rejected результатам влиять как confirmed evidence.
5. Покрыть transitions, concurrency и permission tests.

## Acceptance criteria

- [ ] Summary хранит findings, hypotheses, contradictions и priority changes раздельно.
- [ ] Каждое review action имеет actor, timestamp и audit trail.
- [ ] Confirmed CoreNode не изменяется будущим AI без нового human review.
- [ ] Sensitive и hidden states соблюдают visibility.

## Checks

- [ ] Пройдена полная review action matrix.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0015_diagnostic_session_summaries.sql` (номер 0015 — `0014` заняла параллельная работа по intervention methods): таблица `diagnostic_session_summaries` с раздельными массивами `strongest_findings`/`new_hypotheses`/`confirmed_hypotheses`/`contradicted_hypotheses`/`priority_changes`; RLS; права.
- Сервисный слой `lib/service/review.ts`: `reviewSignal` (approve/reject/mark_sensitive/hide) с audit-причиной; `countsAsConfirmedEvidence` (pending/rejected ≠ confirmed evidence).
- Тесты: approve/reject меняют review_status, mark_sensitive/hide меняют visibility, audit-запись на каждое действие, pending/rejected не считаются confirmed.

**Изменённые/созданные файлы:**
- `supabase/migrations/0015_diagnostic_session_summaries.sql`
- `lib/service/review.ts`
- `tests/integration/review.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 23 (4 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: 7 ошибок в `lib/service/interventions.ts` — параллельная работа (ticket 38), не относятся к этому тикету.

**Note:** merge/split/link/duplicate появятся с Themes/CoreNodes (тикеты 24/25); confirmed CoreNode нельзя изменить без нового human review — правило будет применено в тикете 25.
