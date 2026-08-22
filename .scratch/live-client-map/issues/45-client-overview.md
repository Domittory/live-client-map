# 45: Собрать Client Overview

**What to build:** Специалист открывает клиента и сразу видит его текущий запрос, ключевые элементы модели, последние изменения и следующий шаг.

**Goal:** Создать основной рабочий экран без необходимости обходить все разделы.

**Context:** Overview агрегирует данные, но не создаёт новую психологическую интерпретацию.

**Blocked by:** 18 — Requests; 19 — Triggers; 29 — Resources; 30 — DevelopmentTargets; 37 — Recommendations; 43 — Snapshots.

**Status:** ready-for-agent

## Concrete steps

1. Создать read service для overview с assignment и visibility.
2. Показать active request, top CoreNodes/Resources, targets и recent Trigger.
3. Показать last Correction, latest changes, next Recommendation и pending review.
4. Реализовать empty, loading, stale и error states.
5. Добавить aggregate contract и UI tests.

## Acceptance criteria

- [ ] Overview содержит все элементы раздела 38 SPEC.md.
- [ ] Top items используют сохранённый versioned ranking.
- [ ] Hidden/private данные не попадают в client-facing variants.
- [ ] Каждый блок ведёт к детальному evidence-aware экрану.

## Checks

- [ ] Пройдены populated, partial и empty-client smoke tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
