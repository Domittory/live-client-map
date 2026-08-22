# 34: Реализовать clusterEvidence и classifyThemes

**What to build:** AI предлагает EvidenceClusters, связи с существующими Themes и новые Themes с объяснением.

**Goal:** Добавить семантическую помощь без ложного подсчёта независимого evidence.

**Context:** Deterministic rules тикета 22 остаются authority для counts. AI предлагает grouping и rationale, но не подтверждает себя.

**Blocked by:** 22 — Context engine; 24 — Themes; 33 — AI ingest.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать отдельные AI contracts clusterEvidence и classifyThemes.
2. Передавать существующую карту и canonical context inputs.
3. Валидировать предлагаемые links, counts и rationale.
4. Создавать предложения только со статусом pending.
5. Добавить review UI и regression tests на повторяющиеся Signals.

## Acceptance criteria

- [ ] AI не увеличивает independent count поверх deterministic context rules.
- [ ] Предложение может link to existing или создать pending Theme.
- [ ] Каждая связь имеет rationale и source references.
- [ ] Re-analysis не создаёт неуправляемые duplicates.

## Checks

- [ ] Пройден кейс 20 синонимичных Signals одной сессии.
- [ ] Repository-standard lint, typecheck и tests проходят.
