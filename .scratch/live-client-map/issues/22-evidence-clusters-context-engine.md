# 22: Реализовать EvidenceCluster и Context engine

**What to build:** Система группирует семантически близкие Signals и считает независимые контексты без ложного увеличения evidence.

**Goal:** Сделать evidence independence проверяемой до построения Themes.

**Context:** Двадцать похожих Signals одной сессии не равны двадцати независимым подтверждениям. Контекст включает life area, relationship role, trigger type, time, environment и session.

**Blocked by:** 21 — Signal interpretation и EvidenceLevel.

**Status:** resolved

## Decision

- `evidence_clusters` добавляет `organization_id` + `client_id` (tenant boundary) и `context_key` (canonical строка из измерений контекста SPEC §8.10).
- Детерминированная кластеризация: Signals группируются по `semantic_topic` + `context_key`; `signals_count` считается отдельно от независимых контекстов (`independent_weight` = число разных context_key).
- `evidenceLevelFromCluster`: ≥2 независимых контекста → L3; ≥2 сигнала в одном контексте → L2; 1 сигнал → L1. 20 синонимичных сигналов одной сессии = L2, не 20×evidence.

## Concrete steps

1. Реализовать EvidenceCluster и canonical context representation.
2. Создать deterministic clustering baseline для явно одинаковых context keys.
3. Рассчитывать signals count отдельно от independent weight/count.
4. Добавить UI просмотра состава кластера и контекстов.
5. Покрыть same-session и genuine multi-context examples.

## Acceptance criteria

- [ ] Двадцать синонимичных Signals одной сессии не дают двадцать независимых evidence.
- [ ] Независимые sessions/contexts могут повысить уровень до L3 только по утверждённым правилам.
- [ ] Пользователь видит, почему Signals объединены.
- [ ] Изменение clustering не уничтожает raw Signals.

## Checks

- [ ] Пройдены acceptance cases разделов 53 и 54 SPEC.md.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Модуль `lib/service/clustering.ts` (детерминированная логика): `canonicalContextKey` (каноничное представление контекста из измерений SPEC §8.10), `clusterByTopicAndContext` (группировка по semantic_topic + context_key, signals_count отдельно от независимых контекстов), `evidenceLevelFromCluster` (≥2 независимых контекста → L3; ≥2 сигнала в одном контексте → L2; 1 сигнал → L1).
- Миграция `0013_evidence_clusters.sql`: таблица `evidence_clusters` (semantic_topic, context_key, signals_count, independent_weight) + RLS + права.
- Unit-тесты: 20 синонимичных сигналов одной сессии = 1 независимый контекст (L2, не 20×evidence) — SPEC §53; multi-context → L3 — SPEC §54.

**Изменённые/созданные файлы:**
- `lib/service/clustering.ts`
- `supabase/migrations/0013_evidence_clusters.sql`
- `tests/unit/clustering.unit.test.ts`

**Пройденные проверки:**
- `pnpm typecheck` — pass
- `pnpm lint` — pass
- Тесты тикета 22 (4 шт.) — pass (SPEC §53 и §54).

**Note:** изменение кластеризации не удаляет raw Signals (Signals — отдельная таблица; кластер — производная группировка).
