# 06: Сделать мутации психологической модели атомарными

**What to build:** Перевести изменения Themes, CoreNodes, DifferentialHypotheses, Relations, Resources, DevelopmentTargets, Purpose и Recommendations на атомарные RPCs, не ослабляя human-in-the-loop semantics.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** resolved

- [x] Каждая compound mutation сохраняет entity, child links, Evidence Trail, ModelChange где применимо и AuditLog одной транзакцией.
- [x] AI-created entities и relations остаются pending/L0 и не изменяют confirmed entity без явного human review.
- [x] Rejected или failed proposal не оставляет links, authoritative evidence или confidence changes.
- [x] Tenant, assignment, consent и actor checks выполняются внутри transaction boundary.
- [x] Fault-injection integration tests доказывают rollback model row, child rows и audit.

## Implementation result

### Что сделано

Добавлена миграция `supabase/migrations/0042_atomic_psychological_model.sql` — один
`SECURITY DEFINER` RPC на каждую compound mutation психологической модели. Общие
хелперы переиспользованы из 0039/0040/0041 (`require_org_member_actor`,
`assert_client_write`, `append_audit`, `has_consent`), продублированной логики нет.

Новые внутренние хелперы (EXECUTE отозван у public/anon/authenticated):

- `jsonb_text_array(jsonb)` — JSON-массив строк → `text[]`;
- `assert_client_consent(org, client, types[])` — write access + согласия внутри транзакции;
- `assert_org_author_actor(org)` — активный owner/specialist (роль, которую требует RLS библиотеки методов);
- `recompute_theme_aggregates_internal(theme_id)` — агрегаты темы только по подтверждённым не-AI сигналам (SPEC §3.5);
- `validate_explanation_grounding(explanations, grounding)` — детерминированная проверка grounding'а на стороне SQL (зеркало TS-функции).

Новые публичные RPC (actor всегда из `auth.uid()`, `set search_path = public`,
`revoke all ... from public, anon`, `grant execute ... to authenticated, service_role`):

| Сервис | Функция сервиса | RPC |
| --- | --- | --- |
| themes | `createTheme` | `create_theme` |
| themes | `linkSignal` / `unlinkSignal` | `link_theme_signal` / `unlink_theme_signal` |
| themes | `recomputeThemeAggregates` | `recompute_theme_aggregates` |
| core-nodes | `createCoreNode` | `create_core_node` |
| core-nodes | `linkTheme` | `link_theme_core_node` |
| core-nodes | `confirm` / `reject` / `archive` | `set_core_node_status` |
| hypotheses | `createHypothesis` | `create_hypothesis` |
| hypotheses | `addContradiction` | `add_hypothesis_contradiction` |
| relations | `createRelation` | `create_relation` |
| relations | `confirmCausalRelation` | `confirm_causal_relation` |
| resources | `createResource` / `updateResource` | `create_resource` / `update_resource` |
| development-targets | `createDevelopmentTarget` | `create_development_target` |
| purpose | `createPurposeProfile` / `createPurposeSynthesis` | `create_purpose_profile` / `create_purpose_synthesis` |
| ai-recommendations | `generateRecommendations` | `create_recommendations` |
| ontology | `createOrgDomain` / `createOrgBeliefTemplate` | `create_org_domain` / `create_org_belief_template` |
| ontology | `archiveOrgDomain` / `archiveOrgBeliefTemplate` | `archive_org_domain` / `archive_org_belief_template` |
| interventions | `createOrgMethod` / `updateOrgMethod` / `archiveOrgMethod` | `create_org_method` / `update_org_method` / `archive_org_method` |
| model-changes | `recordModelChange` | `record_model_change` |
| snapshots | `generateSnapshot` | `create_snapshot` |
| explanations | `saveExplanation` | `save_model_explanation` |
| explanations | `reviewModelExplanation` | `review_model_explanation` |
| ai-model | `updateCoreNodes` | `apply_ai_core_node_proposals` |
| ai-model | `generateDifferentialHypotheses` | `create_ai_hypotheses` |
| ai-model | `detectContradictions` | `create_ai_contradiction_relations` |
| ai-cluster | `clusterEvidence` / `classifyThemes` | `create_evidence_clusters` / `apply_ai_theme_proposals` |
| ai-resources | `updateResources` | `apply_ai_resource_proposals` |

Ключевые решения:

- **`generateSnapshot`**: контент по-прежнему собирается детерминированно в TS
  (`assembleSnapshotContent`), но строка snapshot + audit пишутся одним RPC;
  версия выделяется под `pg_advisory_xact_lock` по client_id, поэтому монотонность
  сохраняется без retry-цикла. Согласия (`data_storage`,
  `sensitive_psychological_data`) проверяются внутри RPC.
- **`explainModelChanges`**: RPC `save_model_explanation` принимает только
  `pending`/`rejected` — AI не может записать `approved`. `review_model_explanation`
  повторно валидирует grounding внутри транзакции, поэтому сфабрикованные ссылки
  не могут стать approved даже в обход сервисной проверки.
- **AI-батчи**: весь набор proposals + child links + audit — одна транзакция.
  `apply_ai_core_node_proposals` внутри SQL проверяет confirmed-статусы
  (`active`, `in_treatment`, `treated_unverified`, `weakened`, `integrated`,
  `reactivated`, `contradicted`) и никогда их не перезаписывает; новые узлы —
  `under_review`, новые темы — `review_status = 'pending'`, новые ресурсы —
  `review_status = 'pending'`, рекомендации — `draft` + `visibility = 'internal'`,
  а порог `risk_score >= 80` принудительно включает `human_review_required`.
- **`create_relation`**: на этом пути разрешены только 11 «каузально-осторожных»
  типов; `causes_confirmed` достижим только через `confirm_causal_relation` с
  явной причиной (human review).
- **`create_recommendations`**: дочерние `recommendation_targets` пишутся в той же
  транзакции, что и родительская рекомендация (это и есть проверка «fault на
  child-link откатывает parent row»).

### Файлы

Созданы:

- `supabase/migrations/0042_atomic_psychological_model.sql`
- `tests/integration/atomic-model-mutations.integration.test.ts` (29 тестов, fault-injection)

Изменены:

- `supabase/seed.sql` — в список таблиц для fault-триггера добавлены
  `themes`, `signal_theme_links`, `core_nodes`, `theme_core_node_links`,
  `differential_hypotheses`, `core_node_relations`, `resources`,
  `development_targets`, `purpose_profiles`, `purpose_syntheses`,
  `recommendations`, `recommendation_targets`, `diagnostic_domains`,
  `belief_templates`, `intervention_methods`, `model_changes`,
  `psychological_snapshots`, `model_explanations`, `evidence_clusters`.
- `lib/service/themes.ts`, `core-nodes.ts`, `hypotheses.ts`, `relations.ts`,
  `resources.ts`, `development-targets.ts`, `purpose.ts`, `ai-recommendations.ts`,
  `ontology.ts`, `interventions.ts`, `model-changes.ts`, `explanations.ts`,
  `snapshots.ts` — убраны отдельные `recordAudit`/`withAudit`, вызовы идут через
  `runAtomicRpc`. Публичные контракты (имена функций, camelCase-схемы, типы
  возврата) не менялись.
- `lib/service/ai-model.ts`, `ai-cluster.ts`, `ai-resources.ts` — те же таблицы
  модели, поэтому их compound-мутации тоже переведены на RPC (см. ниже про
  расширение скоупа).

### Что осознанно не менялось

- `lib/service/clustering.ts` — чистые функции (`canonicalContextKey`,
  `clusterByTopicAndContext`, `evidenceLevelFromCluster`), записей в БД нет,
  мигрировать нечего.
- `lib/service/relations.ts` → `createTriggerActivation` — одиночный INSERT без
  audit и без последующих записей, то есть не compound mutation.
- `lib/service/recommendations.ts` в репозитории нет; сервис рекомендаций —
  это `lib/service/ai-recommendations.ts` (он мигрирован).
- Оставлены другим тикетам / вне списка сущностей тикета: `corrections.ts`,
  `observations.ts` (тикет 07), `erasure.ts` (тикет 08), `follow-ups.ts`,
  `reactivation.ts` (model history, тикет 07), `relationships.ts`,
  `life-events.ts`, `requests.ts`, `safety.ts`, `report.ts`, `export.ts`,
  `client-portal.ts`, `supervision-export.ts`.
- `ai-model.ts`, `ai-cluster.ts`, `ai-resources.ts` не были перечислены в списке
  файлов тикета, но пишут ровно те же таблицы психологической модели
  (CoreNodes/DifferentialHypotheses/Relations/Themes/Resources + Evidence Trail).
  Так как критерий приёмки говорит «каждая compound mutation» и отдельно требует
  сохранения pending/L0 семантики для AI-created entities, они мигрированы в том
  же стиле. Это единственное расширение скоупа — прошу проверить.

### Проверки

```
export DOCKER_HOST="unix:///Users/dmitryeliseev/.colima/default/docker.sock"
HOME="$TMPDIR/supabase-home" supabase db reset
```
→ миграция 0042 применилась на чистую БД, seed (с новыми fault-триггерами) прошёл.

```
pnpm exec vitest run tests/integration/atomic-model-mutations.integration.test.ts
```
→ 29 passed.

```
pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration
```
→ 85 files passed, 562 tests passed (0 failed).

```
pnpm typecheck
```
→ passed.

```
pnpm lint
```
→ passed (eslint + `prettier --check`), без ошибок и предупреждений.

```
pnpm test:e2e
```
→ 2 passed (chromium).

Дополнительно проверены привилегии в БД: ни одна из новых функций не исполняема
ролью `anon`; все новые публичные RPC имеют EXECUTE у `authenticated` и
`service_role`; внутренние хелперы недоступны `authenticated`; у всех
`proconfig = search_path=public`.

### Ограничения / на что посмотреть

- Порядок чтения вне транзакции сохранён там, где он нужен для кодов ошибок
  (`NOT_FOUND` у `getModelExplanation`, `getMethod`, домена belief-template).
  Авторитетные проверки всё равно выполняются внутри RPC; предварительные чтения —
  только для совместимости сообщений об ошибках.
- `add_hypothesis_contradiction` по-прежнему понижает confidence инкрементально
  (−10 за вызов, floor 0) — поведение не менялось.
- `generateSnapshot` больше не делает retry на 23505: версия выделяется под
  advisory-lock, конкурентная генерация сериализуется; при нарушении уникальности
  ошибка маппится в `CONFLICT`.
