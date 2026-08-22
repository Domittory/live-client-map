# 44: Реализовать explainModelChanges

**What to build:** После новой диагностики специалист получает осторожное объяснение того, что изменилось и почему.

**Goal:** Сделать динамику модели понятной и проверяемой через evidence trail.

**Context:** AI создаёт explanation, но фактические before/after значения берутся из ModelChange и snapshots, а не из текста модели.

**Blocked by:** 32 — AI gateway; 43 — ModelChange/Snapshot.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать отдельный explainModelChanges AI contract.
2. Передавать только structured diff, evidence digest и version metadata.
3. Валидировать ссылки и запрещать invented changes.
4. Создавать pending explanation с human review.
5. Добавить model change summary UI и grounding tests.

## Acceptance criteria

- [ ] Explanation перечисляет только существующие ModelChange records.
- [ ] Каждая причина ссылается на evidence или deterministic score diff.
- [ ] AI не изменяет модель при объяснении.
- [ ] Недостаток данных называется явно.

## Checks

- [ ] Пройдены fabricated-change rejection и before/after accuracy tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
