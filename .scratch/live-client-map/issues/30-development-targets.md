# 30: Реализовать DevelopmentTarget

**What to build:** Специалист формулирует желаемое развитие клиента и связывает его с ресурсами, CoreNodes и измеримыми markers.

**Goal:** Представить развитие не только как устранение проблем.

**Context:** DevelopmentTarget хранит current/target level, importance, links и success markers.

**Blocked by:** 18 — ClientRequest/Goal; 25 — CoreNodes; 29 — Resources.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать DevelopmentTarget contract и link representation.
2. Создать services для lifecycle, levels и markers.
3. Добавить Development UI с current/target state и связанным evidence.
4. Применить visibility, assignments и audit.
5. Покрыть validation и link integrity tests.

## Acceptance criteria

- [ ] DevelopmentTarget может ссылаться на несколько Resources и CoreNodes.
- [ ] Success markers сохраняются и доступны будущему follow-up.
- [ ] Current и target levels валидируются по утверждённой шкале.
- [ ] Цель развития не становится психологическим фактом без evidence.

## Checks

- [ ] Пройдены create/link/lifecycle и authorization tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
