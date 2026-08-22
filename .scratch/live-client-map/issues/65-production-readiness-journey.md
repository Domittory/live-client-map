# 65: Провести production-readiness journey

**What to build:** Полный release gate проверяет реальный путь от Organization onboarding до объяснимого результата и безопасного export.

**Goal:** Подтвердить Definition of Done проекта как единой системы, а не набора отдельных функций.

**Context:** Этот тикет не добавляет новый scope. Он интегрирует и исправляет только дефекты, обнаруженные в полном journey.

**Blocked by:** 45–64 — основной UI, portal, обмен данными, privacy, security, operations и acceptance suite.

**Status:** ready-for-agent

## Concrete steps

1. Пройти Owner onboarding, members, assignments и consent.
2. Создать клиента, request, diagnostics, Signals, model и competing hypotheses.
3. Провести Recommendation, Correction, markers, FollowUp и reactivation scenario.
4. Проверить snapshots, changes, Living Map, Evidence Drawer, portal и exports.
5. Выполнить security, accessibility, performance и operational release checklist.

## Acceptance criteria

- [ ] Все пункты Definition of Done раздела 59 SPEC.md имеют evidence прохождения.
- [ ] Полный journey проходит без ручного изменения базы.
- [ ] Ни один AI output не обходит review или evidence rules.
- [ ] RLS, consent, safety, audit и erasure работают в интегрированном сценарии.
- [ ] Release decision и известные ограничения документированы.

## Checks

- [ ] Все repository quality gates, acceptance pack и end-to-end journey проходят.
- [ ] Staging smoke, restore drill и release checklist подписаны ответственным человеком.
