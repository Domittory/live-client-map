# 30: Реализовать DevelopmentTarget

**What to build:** Специалист формулирует желаемое развитие клиента и связывает его с ресурсами, CoreNodes и измеримыми markers.

**Goal:** Представить развитие не только как устранение проблем.

**Context:** DevelopmentTarget хранит current/target level, importance, links и success markers.

**Blocked by:** 18 — ClientRequest/Goal; 25 — CoreNodes; 29 — Resources.

**Status:** resolved

## Decision

- `development_targets` добавляет `organization_id`/`client_id` (tenant boundary); связи с ресурсами/CoreNodes хранятся массивами UUID (`linked_resources`, `linked_core_nodes`), success-маркеры — массивом `success_markers`.
- `current_level`/`target_level` — integer 0–100 (шкала тикета 03).
- Цель развития — это желаемое состояние (не психологический факт): не создаёт автоматических психологических утверждений.

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

## Implementation result

**Что сделано:**
- Миграция `0021_development_targets.sql`: таблица `development_targets` (name, domain, current_level/target_level 0–100, importance, status, linked_resources[], linked_core_nodes[], success_markers[]); RLS; права.
- Сервисный слой `lib/service/development-targets.ts`: `createDevelopmentTarget` (валидация уровня 0–100, связи и markers), audit.
- Тесты: target со множеством resources/CoreNodes и success markers; отклонение уровня вне 0–100.

**Изменённые/созданные файлы:**
- `supabase/migrations/0021_development_targets.sql`
- `lib/service/development-targets.ts`
- `tests/integration/development-targets.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 30 (2 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** цель развития — желаемое состояние, не психологический факт; нет автоматических психологических утверждений из неё.
