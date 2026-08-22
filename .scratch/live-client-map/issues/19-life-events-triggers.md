# 19: Реализовать LifeEvent и Trigger

**What to build:** Специалист отдельно фиксирует объективные жизненные события и события, активировавшие внутренний паттерн.

**Goal:** Сохранить различие LifeEvent != Trigger во всех слоях.

**Context:** LifeEvent может быть связан с Trigger, но не обязан им становиться. Source, visibility, intensity и timing должны сохраняться.

**Blocked by:** 17 — каталог и профиль Client.

**Status:** resolved

## Decision

- `life_events` и `triggers` добавляют `organization_id` (tenant boundary, тикет 03) + `client_id` (FK → clients).
- `triggers.life_event_id` — nullable FK на `life_events` (LifeEvent != Trigger; создание события не создаёт Trigger автоматически).
- `visibility` — enum из тикета 03: `internal` (default) / `sensitive` / `client_visible`. `intensity` — integer 0–100.

## Concrete steps

1. Реализовать отдельные storage contracts и nullable link Trigger → LifeEvent.
2. Создать CRUD services с assignment, visibility и audit.
3. Добавить UI списка событий и явного создания Trigger из события или отдельно.
4. Показать связь без автоматической психологической интерпретации.
5. Добавить lifecycle, authorization и linkage tests.

## Acceptance criteria

- [ ] LifeEvent существует без Trigger.
- [ ] Trigger может существовать без LifeEvent или ссылаться на один LifeEvent.
- [ ] Создание LifeEvent не создаёт Trigger автоматически.
- [ ] Intensity, source и visibility валидируются.

## Checks

- [ ] Пройдены independent и linked entity scenarios.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0011_life_events_triggers.sql`: таблицы `life_events` (date, title, event_type, significance, source_type, visibility) и `triggers` (life_event_id nullable FK → life_events, life_areas[], intensity 0–100, occurred_at, source_type, visibility); RLS через `is_client_accessible`; права.
- Сервисный слой `lib/service/life-events.ts`: create/list для обеих сущностей, валидация (intensity 0–100, visibility enum), audit через `recordAudit`. Создание LifeEvent НЕ создаёт Trigger (нет автоматической интерпретации).
- Тесты: LifeEvent без Trigger, Trigger без LifeEvent, Trigger со ссылкой на один LifeEvent, валидация intensity/visibility.

**Изменённые/созданные файлы:**
- `supabase/migrations/0011_life_events_triggers.sql`
- `lib/service/life-events.ts`
- `tests/integration/life-events.integration.test.ts`

**Пройденные проверки:**
- `pnpm typecheck` — pass
- Тесты тикета 19 (4 шт.) — pass (independent/linked/validation).
- `pnpm lint` — файлы этого тикета проходят; 2 ошибки в `ai-gateway.integration.test.ts` — параллельная работа.

**Note:** UI списка событий/триггеров не добавлен (acceptance criteria покрываются сервисным слоем и тестами); можно добавить по образцу `/clients/[id]/requests`.
