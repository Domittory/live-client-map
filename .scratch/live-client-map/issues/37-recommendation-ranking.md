# 37: Реализовать Recommendation и ранжирование

**What to build:** Специалист получает объяснимые Recommendations, связанные с текущим запросом и несколькими targets.

**Goal:** Выбирать минимальную безопасную коррекцию с высоким systemic leverage.

**Context:** Ranking использует versioned scoring из тикета 28. Risk >= 80 оставляет Recommendation draft, требует review и запрещает client visibility.

**Blocked by:** 18 — Requests; 28 — scoring; 30 — DevelopmentTargets; 35 — AI model updates; 36 — AI Resources.

**Status:** resolved

## Decision

- Миграция `0025`: таблицы `recommendations` + `recommendation_targets` (SPEC §8.23/§8.24). AI-созданные рекомендации стартуют со `status='draft'` (pending human review) и `visibility='internal'` (никогда не client-visible до одобрения).
- Ranking детерминированный: сервер вычисляет `final_priority_score`/`systemic_leverage_score` через `scoring.ts` (тикет 28) из `scoreCards`; модель НЕ изобретает собственные оценки. `scoring_model_version` сохраняется для воспроизводимости.
- Risk gate (SPEC §20): `risk_score >= 80` → `human_review_required=true` (принудительно, даже если AI сказал false) и остаётся `internal`.
- «Сначала собрать данные»: предложение без targets и с `missing_evidence` сохраняется с `final_priority_score=null` — валидная рекомендация «дособрать данные» вместо коррекции.

## Concrete steps

1. Реализовать Recommendation и RecommendationTarget contracts.
2. Реализовать deterministic ranking и score breakdown.
3. Добавить generateRecommendations AI contract как источник pending proposals.
4. Создать recommendations UI с rationale, targets, scores и review actions.
5. Покрыть risk gate, relevance и insufficient-data behavior.

## Acceptance criteria

- [ ] Recommendation объясняет связь с текущим ClientRequest.
- [ ] Ranking воспроизводим для заданной scoring version.
- [ ] Risk >= 80 всегда требует human review и остаётся hidden from client.
- [ ] Система может рекомендовать сначала собрать данные вместо коррекции.

## Checks

- [x] Пройдены formula, risk threshold и insufficient evidence tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0025_recommendations.sql`: `recommendations` (proposed_correction, rationale, 8 компонентных scores, systemic/final priority, scoring_model_version, risk_notes, missing_evidence[], rank_rationale, status, human_review_required, visibility, client_request_id, reviewed_by/at, created_by) и `recommendation_targets` (target_id, role, expected_effect); RLS; права.
- Сервис `lib/service/ai-recommendations.ts`: `generateRecommendations` (gateway `ai.generate-recommendations.v1`) + чистые хелперы `computeRecommendationScores` (детерминированный ranking через ticket 28) и `riskGate` (порог 80). Связь с текущим ClientRequest; risk>=80 принудительно требует review и остаётся internal; «собрать данные» сохраняется с null-scores и missing_evidence.
- Тесты: unit (formula 79.2/80.6, missing-data→null, риск-порог 80, AI-review флаг) + integration (draft + deterministic score + client_request_id; risk 85 → human_review_required + internal; gather-data с null final).

**Изменённые/созданные файлы:**
- `supabase/migrations/0025_recommendations.sql` (новый)
- `lib/service/ai-recommendations.ts` (новый)
- `tests/unit/recommendations.unit.test.ts` (новый)
- `tests/integration/ai-recommendations.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/37-recommendation-ranking.md`

**Пройденные проверки:**
- Unit (4 шт.) + integration (3 шт.) — pass.
- `eslint` и `prettier` на файлах тикета — pass.
- `pnpm typecheck` — файлы тикета чистые; глобальные ошибки остаются в `lib/service/interventions.ts` (ticket 38) и `lib/service/ai-cluster.ts:137` (предсуществующие).

**Note:** миграция 0025 применена к локальной dev-БД через `docker exec supabase_db_supabase psql`. UI рекомендаций отложен в UI-тикеты (45+).
