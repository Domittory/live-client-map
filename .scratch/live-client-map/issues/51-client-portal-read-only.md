# 51: Реализовать read-only Client Portal

**What to build:** Клиент входит через отдельный controlled access и видит только опубликованные материалы.

**Goal:** Дать клиенту полезный доступ без organization membership и без base-table exposure.

**Context:** Разрешены published summaries, agreed DevelopmentTargets и client-visible Recommendations. Private notes, raw AI hypotheses, risks и hidden CoreNodes запрещены.

**Blocked by:** 04 — portal UX; 13 — consent; 18 — Requests; 30 — DevelopmentTargets; 37 — Recommendations; 43 — Snapshots.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать утверждённый portal identity и access lifecycle.
2. Создать отдельный privacy-filtered read model, не прямой доступ к base tables.
3. Реализовать publication controls для specialist.
4. Создать portal UI для разрешённых summaries, targets и recommendations.
5. Покрыть access revoke и forbidden-field tests.

## Acceptance criteria

- [ ] Client portal user не является organization member.
- [ ] Portal возвращает только явно опубликованные и client-visible records.
- [ ] Risk, private notes и pending AI hypotheses отсутствуют даже в payload.
- [ ] Revoked access прекращает portal session согласно policy.

## Checks

- [ ] Пройдены response-shape и direct-base-table denial tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
