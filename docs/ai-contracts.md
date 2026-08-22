# AI Provider and Function Contracts

Статус: approved for development and test.

Источник продуктовых правил: SPEC.md. Этот документ фиксирует provider boundary и transport contracts; он не добавляет психологическую теорию и не заменяет deterministic scoring.

## Provider decision

### Development and test

- Provider: OpenAI API.
- API: Responses API.
- Model family: GPT-5.5.
- Pinned model snapshot: gpt-5.5-2026-04-23.
- Reasoning: effort = high.
- Persistence at provider: store = false.
- Conversation state: stateless, one response per domain function; previous_response_id не используется.
- Structured output: strict JSON Schema.
- Input data: только synthetic или irreversibly de-identified fixtures.

Если pinned snapshot недоступен, вызов завершается состоянием provider_model_unavailable. Silent fallback на alias или другую модель запрещён.

### Production

Production AI выключен feature gate. Его можно включить только отдельным одобренным решением о provider, data region, договоре обработки, retention и трансграничной передаче. Текущий dev/test provider не является production approval.

### Replaceability

Business services вызывают AiProvider interface, а не OpenAI SDK напрямую. Adapter получает function name, contract version, prompt version, redacted payload и execution policy; возвращает validated contract result или typed failure. Новый provider обязан пройти тот же contract/evaluation pack.

## Data boundary

До provider разрешено передавать:

- opaque UUID сущностей;
- synthetic или de-identified diagnostic text;
- domain enums, scores и version identifiers;
- минимальный evidence subset, необходимый одной функции.

До provider запрещено передавать:

- имена, email, телефоны, адреса и документы;
- точные даты рождения, места рождения и работодателей;
- свободный текст, не прошедший redaction;
- secrets, private specialist notes и данные другого клиента;
- данные без active ai_analysis consent в production-capable environments.

Redaction заменяет идентификаторы стабильными placeholders внутри одного request: CLIENT, PERSON_1, ORGANIZATION_1, PLACE_1, DATE_1. Mapping остаётся только в приложении и не логируется. Перед отправкой выполняются consent gate, environment gate, tenant/assignment check, redaction и sensitive-case pre-check.

Для OpenAI dev/test request устанавливаются store = false и privacy-preserving safety_identifier как HMAC внутреннего user id. Raw prompt и raw response не записываются в application logs.

## Common request envelope

Каждая функция получает закрытый object со следующими обязательными полями:

| Field                   | Type            | Rule                                     |
| ----------------------- | --------------- | ---------------------------------------- |
| contract_version        | string          | Точная версия функции                    |
| request_id              | UUID            | Генерируется приложением                 |
| organization_id         | UUID            | Opaque tenant reference                  |
| client_id               | UUID            | Opaque client reference                  |
| language                | string          | ISO language code, default ru            |
| ontology_version        | string          | Версия онтологии                         |
| scoring_model_version   | string or null  | Null, если функция не использует scoring |
| prompt_version          | string          | Immutable prompt version                 |
| source_snapshot_version | integer or null | Версия входной модели                    |
| payload                 | object          | Function-specific input                  |

## Common response envelope

Каждая функция возвращает закрытый object:

| Field            | Type   | Rule                                   |
| ---------------- | ------ | -------------------------------------- |
| contract_version | string | Должен точно совпасть с request        |
| request_id       | UUID   | Должен точно совпасть с request        |
| result           | object | Function-specific result               |
| warnings         | array  | Только известные warning codes         |
| safety           | object | review_required, categories, rationale |

Gateway отклоняет mismatched request_id/version, unknown fields, invalid enum, dangling reference и score вне 0–100.

## Shared schema rules

- additionalProperties = false на каждом object.
- Все описанные поля required. Семантически необязательное значение представляется null.
- Score — integer 0–100 или null; модель не заменяет null на 0.
- Existing entity references могут использовать только IDs, присутствовавшие во входе.
- Новые предложения используют candidate_key, уникальный внутри response; модель не генерирует database UUID.
- evidence_refs ссылаются только на переданные Signal, EvidenceCluster, Observation, FollowUp или ModelChange.
- AI-created records сохраняются с review_status = pending.
- Deterministic service повторно рассчитывает counts, evidence levels, scores и status gates; значения модели не являются authority.
- Empty result допустим и предпочтительнее выдуманного вывода. В этом случае warnings содержит insufficient_data.

## Function contracts

### ai.ingest-signals.v1

Input payload:

- diagnostic_session_id: UUID;
- raw_input: redacted string;
- source_type: Signal source_type enum;
- input_format: enum;
- language: string;
- known_life_areas: string array.

Result:

- signals: array of candidate_key, raw_statement, statement_polarity, test_result, normalized_meaning, inferred_opposite or null, confidence, life_areas, tags, context, proposed_evidence_level and rationale.

Rules:

- raw_statement является точной подстрокой или явно помеченным объединением исходного текста;
- positive + stress описывается как stress around access и не создаёт Resource;
- proposed_evidence_level не применяется до human review;
- каждый Signal атомарен.

### ai.cluster-evidence.v1

Input payload:

- diagnostic_session_id: UUID;
- signals: reviewed Signal projections with id, normalized_meaning, session, source and context dimensions;
- existing_clusters: cluster projections.

Result:

- clusters: candidate_key, action create/update/no_change, existing_cluster_id or null, semantic_topic, signal_ids, context_key, independence_assessment, rationale.

independence_assessment enum: same_context, possibly_independent, independent, insufficient_data.

Rules:

- модель не выдаёт authoritative independent count или confidence;
- deterministic Context engine рассчитывает counts после review;
- похожие Signals одной session по умолчанию same_context.

### ai.classify-themes.v1

Input payload:

- reviewed_signals: Signal projections;
- evidence_clusters: approved cluster projections;
- existing_themes: Theme projections;
- current_model_summary: redacted string.

Result:

- theme_proposals: candidate_key, action create/link_existing/no_change, existing_theme_id or null, name, description, domain, confidence, signal_links and rationale.
- signal_links: signal_id, relevance_score, link_rationale.

Rules:

- предложение новой Theme и link остаются pending;
- rationale содержит evidence_refs;
- при недостатке evidence возвращается no_change.

### ai.update-core-nodes.v1

Input payload:

- approved_themes and links;
- existing_core_nodes and links;
- contradictions;
- deterministic_score_inputs;
- current_client_request summary.

Result:

- core_node_proposals: candidate_key, action create/update/no_change, existing_core_node_id or null, title, hypothesis, root_domain, proposed_status, theme_links, evidence_refs, contradictions_considered, confidence and rationale.

Rules:

- confirmed CoreNode не меняется без нового human review;
- модель предлагает score inputs, но не является authority для calculated scores;
- diagnostic language и absolute causality запрещены.

### ai.generate-differential-hypotheses.v1

Input payload:

- focal_entity_refs;
- evidence_for;
- evidence_against;
- context_summary;
- existing_hypotheses.

Result:

- hypotheses: от 0 до 5 candidates с candidate_key, title, description, confidence, evidence_for_refs, evidence_against_refs, missing_evidence, disconfirming_questions and rationale.

Rules:

- при достаточной неоднозначности возвращаются минимум две конкурирующие hypotheses;
- hypotheses не подтверждают друг друга;
- objective environment explanation должна оставаться допустимой альтернативой.

### ai.detect-contradictions.v1

Input payload:

- reviewed Signals, Themes, CoreNodes and DifferentialHypotheses;
- existing contradictions;
- relevant contexts.

Result:

- contradictions: candidate_key, entity_refs_for, entity_refs_against, description, relevance_score, context_refs, rationale and suggested_follow_up.

Rules:

- contradiction не помечается data error автоматически;
- confidence меняет только deterministic scoring engine после review;
- duplicate existing contradiction возвращает existing reference.

### ai.evaluate-correction.v1

Input payload:

- Correction and targets;
- expected markers and baselines;
- Observations and BehavioralMarkers;
- FollowUps, retest and feedback;
- affected contexts;
- current deterministic scores.

Result:

- assessment: proposed_result_status, confidence, evidence_refs, context_changes, marker_changes, missing_evidence, proposed_core_node_status or null, rationale and follow_up_recommendation.

proposed_result_status enum: effective, partially_effective, ineffective, unclear.

Rules:

- completed Correction сама по себе не означает effective;
- integrated не предлагается без deterministic integration gate;
- missing follow-up evidence даёт unclear.

### ai.update-resources.v1

Input payload:

- existing Resources;
- reviewed positive evidence, Observations and BehavioralMarkers;
- CoreNode changes только как context;
- existing links.

Result:

- resource_proposals: candidate_key, action create/update/link_existing/no_change, existing_resource_id or null, name, description, domain, proposed_strength, proposed_confidence, proposed_trend, evidence_refs and rationale.

Rules:

- снижение CoreNode activation не является evidence усиления Resource;
- positive + stress не создаёт Resource;
- каждое изменение требует отдельного evidence_ref.

### ai.generate-recommendations.v1

Input payload:

- active ClientRequest;
- approved model entities;
- Resources and DevelopmentTargets;
- deterministic score cards and version;
- risks, prior Corrections and outcomes;
- allowed InterventionMethods.

Result:

- recommendations: candidate_key, proposed_correction, rationale, target_refs with role and expected_effect, score_card_ref, risk_notes, human_review_required, missing_evidence and rank_rationale.

Rules:

- числовые scores копируются только из входной deterministic score card и проверяются gateway;
- risk >= 80 принудительно draft, human review required и client hidden;
- допустим результат collect_more_data вместо Correction.

### ai.generate-snapshot.v1

Input payload:

- deterministic current-state projection;
- prior snapshot projection or null;
- ModelChanges;
- ontology, scoring, model and prompt versions.

Result:

- narrative: summary, trend_summary, risk_notes, evidence_digest;
- grouped_entity_refs: active_core_nodes, active_themes, resources, development_targets, weakened_nodes, reactivated_nodes, recent_triggers, recent_corrections and recommendations.

Rules:

- application собирает и хэширует canonical snapshot; модель создаёт только grounded narrative и grouping;
- каждый returned ID должен присутствовать во входе;
- модель не создаёт ModelChange.

### ai.explain-model-changes.v1

Input payload:

- persisted ModelChanges;
- before and after snapshot projections;
- supporting evidence projections;
- deterministic score diffs.

Result:

- explanations: model_change_id, headline, explanation, evidence_refs, score_breakdown_summary, uncertainty and missing_evidence.

Rules:

- одна explanation относится к существующему ModelChange;
- invented before/after values и evidence refs отклоняются;
- explanation не изменяет model state.

## Execution policy

### Timeouts and retries

- Per-attempt timeout: 120 seconds.
- Maximum attempts: 3.
- Maximum wall time: 300 seconds.
- Retry only network failure, 408, 409, 429 and 5xx.
- Honor Retry-After; otherwise exponential delays 1 and 4 seconds plus jitter.
- Validation failure, refusal, consent block, redaction failure and safety block не retry.

### Idempotency

Idempotency key включает organization, client, function, source revision/hash, contract version, prompt version и model snapshot. Один successful result переиспользуется для того же ключа. Provider response не применяет business mutation напрямую; application transaction применяет только approved result.

### Application limits for dev/test

- Maximum 2 concurrent AI calls per organization.
- Maximum 10 calls per minute per organization.
- Maximum redacted input: 100,000 characters per call.
- Limits configurable, но их повышение требует load/cost review.

### Failure states

queued, running, succeeded, needs_review, blocked_environment, blocked_consent, redaction_failed, provider_model_unavailable, provider_timeout, provider_rate_limited, provider_error, invalid_output, safety_blocked, cancelled.

Каждый terminal failure сохраняет typed code, retryability, request metadata и safe message без raw prompt/response.

## Human review and safety

- Signal, Theme, CoreNode, DifferentialHypothesis, Recommendation, Relation и Resource, созданные или изменённые AI, получают review_status = pending.
- Approve, Edit, Reject, Merge, Split, Link to existing, Duplicate, Sensitive, Hide и Request re-analysis выполняются человеком и записываются в AuditLog.
- AI result никогда не увеличивает evidence_count, independent_evidence_count, contexts_count, confidence_score или rootness_score до independent confirmation и deterministic recalculation.
- Sensitive-case flag создаёт safety review. До его закрытия recommendation и client visibility заблокированы.
- Medical causality, diagnosis, cure/fertility promise и causes relation от AI отклоняются.

## Versioning and audit

- Contract identifier: ai.<function>.v<major>.<minor>.<patch>.
- Любое изменение JSON shape, enum или semantics требует новой major version.
- Backward-compatible capability за version negotiation использует minor.
- Documentation-only correction использует patch.
- Prompt versions immutable и версионируются отдельно от contracts.
- Model config хранит provider, exact snapshot, reasoning effort and adapter version.
- Каждый AI run сохраняет request id, input hash, output hash, redaction version, contract, prompt, provider, model snapshot, effort, token usage, latency, status and reviewer; raw payloads в operational logs не сохраняются.
- Новая contract/prompt/model version проходит golden fixtures разделов 51–56 SPEC.md до включения.

## Approved dev/test configuration

- Provider key: openai-dev.
- Model snapshot: gpt-5.5-2026-04-23.
- Reasoning effort: high.
- API: Responses.
- Provider storage: disabled with store = false.
- Allowed data: synthetic or irreversibly de-identified only.
- Production enabled: false.
