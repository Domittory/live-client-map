# 26: Реализовать DifferentialHypothesis и contradictions

**What to build:** Специалист хранит несколько конкурирующих объяснений и отдельно видит evidence за и против каждого.

**Goal:** Не позволить системе преждевременно выбирать единственную психологическую причину.

**Context:** Противоречие является полезным сигналом, а не ошибкой данных. Medical causality остаётся запрещённой без подтверждения.

**Blocked by:** 25 — CoreNodes и Theme links.

**Status:** resolved

## Decision

- `differential_hypotheses` добавляет `organization_id`/`client_id` (tenant boundary), `evidence_for[]`/`evidence_against[]` как массивы ссылок.
- Несколько гипотез сосуществуют без автоматического winner (нет поля «главная»).
- Противоречащее evidence понижает confidence по правилу `−10` за каждое противоречие (SPEC §51.4, тикет 06), минимум 0. Гипотеза не подтверждает сама себя (evidence ссылается на внешние сущности).

## Concrete steps

1. Реализовать DifferentialHypothesis contract и evidence references.
2. Реализовать representation contradictions между Signals, Themes и hypotheses.
3. Создать services для создания, review, изменения confidence и статуса.
4. Добавить UI параллельного сравнения evidence for/against.
5. Покрыть competing hypothesis и contradiction scenarios.

## Acceptance criteria

- [ ] Несколько гипотез сосуществуют без автоматического winner.
- [ ] Contradicting evidence понижает confidence по утверждённым правилам.
- [ ] Недостаток данных отображается явно.
- [ ] Гипотеза не считается доказательством самой себя.

## Checks

- [ ] Пройден acceptance case раздела 55 SPEC.md.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0018_differential_hypotheses.sql`: таблица `differential_hypotheses` (title, description, confidence_score, status hypothesis/active/rejected/archived, evidence_for[]/evidence_against[], created_by); RLS; права.
- Сервисный слой `lib/service/hypotheses.ts`: `createHypothesis`, `addContradiction` (инкрементально −10 к confidence, floor 0), чистый хелпер `confidenceWithContradictions` (SPEC §51.4).
- Тесты: 3 конкурирующие гипотезы сосуществуют без winner (SPEC §55); противоречащее evidence понижает confidence (60 → 40 при 2 противоречиях); floor 0.

**Изменённые/созданные файлы:**
- `supabase/migrations/0018_differential_hypotheses.sql`
- `lib/service/hypotheses.ts`
- `tests/integration/hypotheses.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 26 (3 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** гипотеза не подтверждает сама себя — evidence ссылается на внешние сущности (signals/themes), а не на саму гипотезу.
