# 06: Формализовать scoring model

**What to build:** Определить воспроизводимые правила расчёта всех scores, trends, evidence levels и порогов.

**Goal:** Не позволить implementation agents придумывать психологические веса и эвристики.

**Context:** SPEC.md задаёт формулу final priority, но оставляет качественными rootness, impact, activation, confidence, relevance, readiness, unlock, risk, systemic leverage и часть reactivation rules.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Concrete steps

1. Определить входы, веса, диапазоны и missing-data behavior каждого score.
2. Формализовать evidence level promotion и влияние contradictions.
3. Определить systemic leverage formula и отличие от final priority.
4. Определить trend calculation, integration и reactivation thresholds.
5. Описать scoring model versioning и migration policy.

## Acceptance criteria

- [ ] Каждый score рассчитывается детерминированно из перечисленных входов.
- [ ] L0 AI-only evidence не повышает confidence или независимость.
- [ ] Пороги risk, integration и reactivation однозначны и конфигурируемы.
- [ ] Решение одобрено владельцем методологии.

## Checks

- [ ] Примеры из разделов 51–56 SPEC.md дают ожидаемое направление результата.
- [ ] Тикет 28 может реализовать engine без скрытых эвристик.

## Resolution

Решение одобрено владельцем проекта 2026-08-22.

**Подход:**

- Полный документ scoring model готовит агент (детерминированные входы, веса, диапазоны, missing-data behavior для каждого score), опираясь на якоря SPEC: формула `final_priority_score` (§20), evidence levels (§11), integration rules (§23), reactivation (§24), примеры §51–56.
- Документ утверждается владельцем методологии целиком до реализации тикета 28. Без утверждённого документа психологические веса не придумываются.

**Ключевая механика (основа драфта):**

- `confidence_score` из evidence level: L0 = 0 (AI-only evidence не повышает confidence, evidence_count, contexts_count, rootness — SPEC §3.5), L1 = 20, L2 = 40, L3 = 60, L4 = 75, L5 = 85, L6 = 95; каждое активное противоречие −10, нижний предел 0.
- `trend`: активность за последние 30 дней против предыдущих 30 дней → `rising` / `stable` / `falling`; при нехватке данных — `unknown`.
- Reactivation (дефолт, конфигурируемо): `activation_score ≥ 60` и прирост ≥ 30 пунктов после нового Trigger/Signals → `status = reactivated` (SPEC §24).
- Integration: `integrated` только при evidence level ≥ L4, подтверждении минимум в 2 независимых контекстах и отсутствии реактивации 90 дней; иначе — `weakened` (SPEC §23).
- `final_priority_score` — по формуле SPEC §20 (веса 0.18/0.17/0.17/0.13/0.13/0.08/0.09/−0.05); `systemic_leverage_score` рассчитывается отдельно, формула конфигурируема.
- Все scores: 0–100, `null` при отсутствии данных (тикет 03).

**Версионирование:**

- Веса и пороги хранятся в таблице `scoring_model_versions` (semver).
- Каждый расчёт и каждый snapshot фиксирует `scoring_model_version`.
- Смена версии НЕ пересчитывает историю: старые snapshots неизменны, новые расчёты — по новой версии; в UI видна версия расчёта.

Тикет 28 реализует engine строго по утверждённому документу без скрытых эвристик.
