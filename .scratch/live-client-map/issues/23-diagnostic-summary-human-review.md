# 23: Реализовать DiagnosticSessionSummary и human review

**What to build:** После диагностики специалист получает summary и управляет review status каждого предложенного результата.

**Goal:** Создать единый human-in-the-loop workflow до подключения AI-модели.

**Context:** Специалист должен уметь Approve, Edit, Reject, Merge, Split, Link, Duplicate, Sensitive, Hide и Request re-analysis.

**Blocked by:** 20 — DiagnosticSession; 21 — Signal interpretation.

**Status:** ready-for-agent

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
