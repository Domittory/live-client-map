# 03: Закрыть пробелы доменного словаря данных

**What to build:** Дополнить SPEC.md точными контрактами для недоопределённых полей и жизненных циклов доменных сущностей.

**Goal:** Исключить расхождения схемы, API и UI между независимыми coding agents.

**Context:** SPEC.md перечисляет сущности и многие поля, но для части полей не задаёт тип, nullability, enum, диапазон, уникальность, cascade behavior или допустимые переходы статусов.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Concrete steps

1. Составить перечень всех полей без полного типа или ограничения.
2. Определить общие правила identifiers, timestamps, score ranges, visibility и soft delete.
3. Описать enums и state machines для всех сущностей со status, trend, review или visibility.
4. Определить ссылочную целостность, delete behavior и правила версионирования.
5. Зафиксировать канонические термины без добавления новой психологической теории.

## Acceptance criteria

- [ ] Каждое поле из SPEC.md имеет однозначный storage и validation contract.
- [ ] Все статусы имеют допустимые переходы и запрещённые переходы.
- [ ] Определены unique, foreign-key и tenant-boundary constraints.
- [ ] Решение одобрено владельцем проекта.

## Checks

- [ ] Data dictionary покрывает все 35 основных сущностей и platform additions.
- [ ] Тикеты со схемой могут быть реализованы без локальных трактовок отдельных agents.

## Resolution

Решение одобрено владельцем проекта 2026-08-22.

**Общие конвенции (обязательны для всех сущностей):**

- `id`: UUID (`gen_random_uuid()`).
- Время: `timestamptz`; `created_at`/`updated_at` обязательны; soft delete через `archived_at` (null = запись активна).
- Все scores и confidence: целые числа 0–100; при отсутствии данных — `null`, а не 0.
- Tenant boundary: все доменные таблицы содержат `organization_id`; данные клиентов не пересекают границу организации.
- Удаление: по умолчанию soft delete; hard delete / data erasure — только через privacy-поток (тикет 05).
- Enums — значения только из словаря данных (Postgres enum или check constraint).

**Enum `visibility` (для всех сущностей с полем visibility):**

- `internal` (default) — видят специалисты с ClientAssignment на клиента;
- `sensitive` — только primary specialist и Owner организации;
- `client_visible` — дополнительно видно клиенту в портале.
- Клиент никогда не видит `internal`/`sensitive`; смена `client_visible` → `internal`/`sensitive` мгновенно отзывает данные из портала.

**Формат артефакта:**

- Канонический документ: `docs/data-dictionary.md` (single-context layout).
- Для каждой из 35 доменных сущностей SPEC и platform-таблиц (тикет 02): тип поля, nullability, enum-значения, unique/FK constraints, delete behavior, tenant-boundary constraints.
- Для всех сущностей со `status`, `trend`, `review_status`: таблица допустимых и запрещённых переходов состояний.
- Evidence levels — по SPEC §11 (L0_AI_ONLY … L6_CORRECTION_RESPONSE_CONFIRMED).
- Термины строго из SPEC; новая психологическая теория не добавляется.
- Документ создаётся при выполнении тикета 03 и является истиной для схемы, API и UI.
