SPEC.md

# Живая карта клиента

Production-oriented specification for the project **«Найти свой огонь»**.

Версия: `1.1`  
Статус: готово к реализации  
Цель документа: дать Codex полный рабочий контекст для разработки универсальной системы динамического профиля клиента, а не MVP-наброска и не персональной программы под одного человека.

---

# 1. Назначение продукта

**Живая карта клиента** — это система для построения динамической модели текущего психологического состояния клиента на основе:

- диагностических сигналов;
- установок;
- результатов тестирования;
- самоотчётов клиента;
- наблюдений специалиста;
- жизненных событий;
- триггеров;
- проведённых коррекций;
- поведенческих маркеров;
- ресурсов;
- целей развития;
- изменений во времени.

Система должна быть универсальной и применяться к любому клиенту независимо от:

- пола;
- возраста;
- семейного статуса;
- профессии;
- жизненного запроса;
- используемой специалистом диагностической методики.

Все примеры в этом документе являются демонстрационными и не должны превращаться в жёстко зашитую персональную программу.

Основная задача системы:

> превращать большой массив разрозненных диагностических данных в живую, проверяемую и изменяющуюся модель клиента, позволяющую выбирать минимальное количество наиболее системных коррекций с максимальным ожидаемым эффектом.

Система должна помогать специалисту:

- видеть целостную структуру клиента;
- хранить историю работы;
- превращать результаты тестирования в Signals;
- группировать Signals в Themes;
- формировать CoreNodes;
- строить граф связей;
- видеть конкурирующие объяснения;
- отделять факты от гипотез;
- отслеживать проведённые коррекции;
- проверять их реальный эффект;
- видеть динамику до/после;
- понимать, какие темы ослабли или реактивировались;
- строить план дальнейших коррекций;
- объяснять, почему одна коррекция важнее другой;
- развивать не только устранение проблем, но и ресурсные качества клиента.

AI не заменяет специалиста.

AI является аналитическим помощником.

Финальное решение всегда принимает человек.

---

# 2. Главная концепция системы

Базовый поток данных:

```text
Client
  -> ClientRequests / Goals
  -> LifeEvents
  -> DiagnosticSessions
  -> Signals
  -> EvidenceClusters
  -> Themes
  -> CoreNodes
  -> DifferentialHypotheses
  -> Relations
  -> Triggers
  -> Resources
  -> DevelopmentTargets
  -> Recommendations
  -> Corrections
  -> Observations
  -> BehavioralMarkers
  -> FollowUps
  -> ModelChanges
  -> VersionedPsychologicalSnapshots
```

Ключевой принцип:

> Любой вывод системы должен иметь evidence trail.

Система должна уметь ответить:

- откуда взялся этот вывод;
- какие Signals его поддерживают;
- сколько независимых контекстов его подтверждают;
- какие данные ему противоречат;
- насколько система уверена в гипотезе;
- что изменилось после коррекции;
- почему следующий шаг рекомендован именно сейчас.

---

# 3. Основные принципы

## 3.1. Факт != интерпретация != гипотеза

Система обязана различать уровни знания.

Пример:

```text
"Отец отсутствовал в детстве"
```

может быть биографическим фактом.

```text
"Клиент ищет отцовское признание в начальнике"
```

является психологической гипотезой.

Они не должны иметь одинаковый epistemic status.

Использовать:

```text
epistemic_type:
fact
self_report
test_result
observation
interpretation
hypothesis
```

---

## 3.2. Не диагноз, а рабочая гипотеза

CoreNode, Theme, DifferentialHypothesis, Recommendation и AI-выводы не являются медицинским или психиатрическим диагнозом.

Корректные формулировки:

```text
"похоже, активируется сценарий"
"гипотеза подтверждается следующими сигналами"
"возможно, тема связана с..."
"система видит повторяющуюся связь"
"данных пока недостаточно"
```

Некорректные:

```text
"это точно причина"
"клиент токсичный"
"клиент сломан"
"у клиента психическое расстройство"
```

без соответствующего профессионального медицинского основания.

---

## 3.3. История сохраняется, но право на удаление существует

По умолчанию:

- история версионируется;
- используется soft delete;
- сохраняется audit trail;
- старые snapshots не переписываются.

Но система должна поддерживать:

- hard delete;
- data erasure;
- отзыв согласия;
- удаление чувствительной информации;

в соответствии с правами пользователя, политикой хранения и законодательством.

---

## 3.4. AI не имеет последнего слова

AI может:

- классифицировать;
- нормализовать данные;
- предлагать Themes;
- предлагать CoreNodes;
- предлагать связи;
- находить противоречия;
- строить DifferentialHypotheses;
- рассчитывать рекомендации;
- обновлять snapshot;
- объяснять evidence.

Специалист может:

```text
Approve
Edit
Reject
Merge
Split
Link to existing
Mark as duplicate
Mark as sensitive
Hide from client
Request re-analysis
```

AI не имеет права молча изменять confirmed CoreNode.

---

## 3.5. AI-гипотеза не является доказательством самой себя

Критическое правило:

```text
AI-generated hypotheses MUST NOT increase:
- evidence_count
- contexts_count
- confidence_score
- rootness_score

until independently confirmed.
```

Подтверждением могут быть:

- kinesiology_test;
- client_report;
- specialist_observation;
- questionnaire;
- behavioral observation;
- retest;
- correction response;
- human confirmation.

`L0_AI_ONLY` не считается независимым evidence.

---

# 4. Правило позитивной формулировки со стрессом

В системе диагностики проекта:

> позитивная формулировка, на которой выявлен стресс, НЕ означает наличие ресурса.

Пример:

```text
raw_statement:
"Мне безопасно быть заметным"

statement_polarity:
positive

test_result:
stress
```

Нормализованное значение:

```text
"Стресс вокруг доступа к безопасной проявленности и заметности."
```

Нельзя автоматически утверждать:

```text
"Клиент считает, что быть заметным опасно."
```

Корректно:

```text
"Есть стресс при контакте с идеей безопасной заметности. Возможные гипотезы: проявленность связана с риском оценки, отвержения, давления или потери безопасности."
```

---

# 5. Роли пользователей

## 5.1. Owner

Владелец пространства.

Права:

- управлять организацией;
- управлять пользователями;
- видеть billing/settings;
- управлять политикой хранения данных;
- экспортировать данные;
- управлять системными настройками.

---

## 5.2. Specialist

Основной пользователь.

Права:

- создавать клиентов;
- проводить диагностику;
- вводить Signals;
- подтверждать AI-гипотезы;
- проводить Corrections;
- вести Observations;
- создавать Recommendations;
- работать с назначенными клиентами.

---

## 5.3. Supervisor

Методолог / супервизор.

Получает доступ только к конкретно разрешённым клиентам.

Не должен автоматически видеть всех клиентов организации.

---

## 5.4. Client portal user

Не является organization member.

Имеет отдельный controlled access.

Может видеть только:

- опубликованные summaries;
- согласованные DevelopmentTargets;
- client-visible Recommendations;
- собственные feedback forms.

Не видит:

- private notes;
- raw AI hypotheses;
- hidden CoreNodes;
- чужие данные;
- risk assessments;
- differential hypotheses без разрешения специалиста.

---

# 6. Access control per client

Добавить:

```text
ClientAssignment
```

Поля:

```text
id
client_id
user_id
access_role
created_at
revoked_at
```

`access_role`:

```text
primary_specialist
secondary_specialist
supervisor
read_only
```

RLS должна проверять:

```text
organization membership
AND
client assignment
```

а не только принадлежность к организации.

---

# 7. Consent

Добавить обязательную сущность:

```text
ConsentRecord
```

Поля:

```text
id
client_id
consent_type
scope
document_version
granted_at
revoked_at
created_at
```

Типы согласия:

```text
data_storage
ai_analysis
sensitive_psychological_data
health_related_data
supervisor_access
client_portal
anonymized_analytics
relationship_analysis
```

---

# 8. Основные сущности

# 8.1. Client

```text
id
organization_id
owner_user_id
first_name
last_name
display_name
birth_date
birth_time
birth_place
gender
relationship_status
occupation
current_role
children_info
specialist_notes_private
client_visible_notes
status
created_at
updated_at
archived_at
```

---

# 8.2. ClientRequest

Запрос клиента должен существовать отдельно от Client.

```text
id
client_id
title
description
life_areas[]
priority
status
started_at
completed_at
success_criteria
current_progress
created_at
updated_at
```

`status`:

```text
active
paused
completed
abandoned
```

Примеры:

```text
Карьерный рост
Налаживание отношений
Подготовка к родительству
Снижение тревоги
Рост дохода
Проявленность
```

---

# 8.3. ClientGoal

Долгосрочная цель.

```text
id
client_id
title
description
importance
target_state
status
created_at
updated_at
```

Пример:

```text
"Научиться спокойно занимать лидерскую позицию без гиперответственности."
```

---

# 8.4. LifeEvent

LifeEvent != Trigger.

LifeEvent — объективно важное жизненное событие.

```text
id
client_id
date
title
description
event_type
significance
source_type
visibility
created_at
```

Примеры:

```text
смена работы
брак
развод
рождение ребёнка
смерть родственника
переезд
смена руководства
операция
банкротство
```

---

# 8.5. Trigger

Trigger — событие, которое активировало внутренний паттерн.

LifeEvent может быть Trigger, но не обязан.

```text
id
client_id
life_event_id nullable
title
description
life_areas[]
intensity
occurred_at
source_type
visibility
created_at
updated_at
```

---

# 8.6. DiagnosticSession

```text
id
organization_id
client_id
title
session_type
source_type
raw_input
input_format
performed_at
performed_by_user_id
ai_processing_status
human_review_status
notes
created_at
updated_at
```

`session_type`:

```text
individual
topic_test
follow_up_test
correction_check
import
baseline
```

---

# 8.7. DiagnosticSessionSummary

```text
id
diagnostic_session_id
summary
strongest_findings[]
new_hypotheses[]
confirmed_hypotheses[]
contradicted_hypotheses[]
priority_changes[]
created_at
```

---

# 8.8. Signal

Атомарная единица evidence.

```text
id
organization_id
client_id
diagnostic_session_id nullable
source_type
source_ref_id nullable
epistemic_type
raw_statement
statement_polarity
test_result
normalized_meaning
inferred_opposite nullable
intensity
confidence
life_areas[]
tags[]
context
time_scope
evidence_level
visibility
review_status
created_by
created_at
updated_at
archived_at
```

`source_type`:

```text
kinesiology_test
client_report
specialist_observation
life_event
questionnaire
partner_report
follow_up
imported_note
ai_hypothesis
```

`epistemic_type`:

```text
fact
self_report
test_result
observation
interpretation
hypothesis
```

`statement_polarity`:

```text
positive
negative
neutral
mixed
unknown
```

`test_result`:

```text
stress
no_stress
unknown
not_tested
```

---

# 8.9. EvidenceCluster

Необходимо избежать ложного эффекта:

> 30 похожих фраз = 30 независимых доказательств.

```text
id
client_id
diagnostic_session_id
semantic_topic
context_key
signals_count
independent_weight
created_at
updated_at
```

Правило:

```text
Many semantically similar Signals from one session
must not be counted as many independent confirmations.
```

---

# 8.10. Context model

Контекст определяется минимум следующими измерениями:

```text
life_area
relationship_role
trigger_type
time_period
environment
diagnostic_session
```

Пример:

15 установок про одного начальника = один контекст.

А одна и та же тема, проявленная:

- с начальником;
- с отцом;
- с наставником;
- с супругом;
- в роли родителя;

может считаться multi-context.

---

# 8.11. Theme

```text
id
organization_id
client_id
name
description
domain
activity_score
confidence_score
evidence_count
independent_evidence_count
contexts_count
trend
status
visibility
first_seen_at
last_seen_at
created_at
updated_at
archived_at
```

---

# 8.12. CoreNode

CoreNode — корневая рабочая гипотеза.

```text
id
organization_id
client_id
title
hypothesis
root_domain
strength_score
confidence_score
impact_score
activation_score
rootness_score
client_relevance_score
readiness_score
unlock_score
risk_score
evidence_count
independent_evidence_count
contexts_count
status
trend
visibility
created_by
last_confirmed_by
created_at
updated_at
last_confirmed_at
archived_at
```

`status`:

```text
hypothesis
active
in_treatment
treated_unverified
weakened
integrated
reactivated
contradicted
under_review
rejected
archived
```

---

# 8.13. DifferentialHypothesis

Хранит конкурирующие объяснения.

```text
id
client_id
title
description
confidence_score
status
evidence_for[]
evidence_against[]
created_by
created_at
updated_at
```

Пример:

```text
Гипотеза A:
страх начальника связан с поиском отцовского признания

Гипотеза B:
страх вызван объективно токсичной корпоративной средой

Гипотеза C:
страх связан с опытом прошлых увольнений
```

Система не должна преждевременно выбирать одну как абсолютную истину.

---

# 8.14. SignalThemeLink

```text
id
signal_id
theme_id
relevance_score
link_rationale
created_by
created_at
```

---

# 8.15. ThemeCoreNodeLink

```text
id
theme_id
core_node_id
relationship_type
confidence
link_rationale
created_by
created_at
```

---

# 8.16. CoreNodeRelation

Использовать осторожные causal semantics.

```text
id
organization_id
client_id
from_core_node_id
to_core_node_id
relation_type
strength
confidence
evidence_summary
created_by
created_at
updated_at
```

`relation_type`:

```text
may_contribute_to
reinforces
protects_from
compensates_for
triggers
depends_on
contradicts
unlocks
is_variant_of
associated_with
supports_hypothesis_of
```

AI не должен автоматически создавать `causes`.

Если специалист вручную подтверждает сильную причинную связь, можно использовать:

```text
causes_confirmed
```

---

# 8.17. TriggerActivation

```text
id
trigger_id
theme_id nullable
core_node_id nullable
activation_delta
confidence
rationale
created_by
created_at
```

---

# 8.18. Resource

Resource — не отсутствие проблемы, а отдельная способность.

```text
id
organization_id
client_id
name
description
domain
strength_score
confidence_score
trend
evidence_summary
status
visibility
created_at
updated_at
```

Критическое правило:

```text
CoreNode activation ↓
DOES NOT imply
Resource strength ↑
```

Пример:

снижение страха конфликта не означает автоматического формирования навыка здоровых границ.

---

# 8.19. DevelopmentTarget

Определяет, каким человеком клиент хочет становиться.

```text
id
client_id
name
description
domain
current_level
target_level
importance
status
linked_resources[]
linked_core_nodes[]
success_markers[]
created_at
updated_at
```

Примеры:

```text
Внутренняя опора
Спокойная сила
Сострадание
Щедрость
Самопринятие
Способность принимать любовь
Способность просить помощь
Здоровая амбиция
Способность отдыхать
Позитивное мышление
Эмоциональная зрелость
Границы
```

---

# 8.20. PurposeProfile

Отдельный слой предназначения.

```text
id
client_id
source_system
raw_data
interpretation
strengths[]
potential_roles[]
development_directions[]
confidence
visibility
created_at
updated_at
```

`source_system`:

```text
jyotish
human_design
specialist_assessment
client_self_report
other
```

Важно:

Jyotish / Human Design рассматриваются как интерпретационные системы и источники гипотез, а не объективные психологические факты.

---

# 8.21. PurposeSynthesis

```text
id
client_id
summary
cross_system_matches[]
potential_conflicts[]
recommended_development_vectors[]
created_at
updated_at
```

---

# 8.22. InterventionMethod

```text
id
organization_id nullable
name
description
category
contraindications
default_follow_up_days
is_system
created_at
updated_at
```

---

# 8.23. Recommendation

```text
id
organization_id
client_id
created_at
proposed_correction
rationale
rootness_score
impact_score
activation_score
confidence_score
client_relevance_score
readiness_score
unlock_score
risk_score
systemic_leverage_score
final_priority_score
status
reviewed_by
reviewed_at
```

---

# 8.24. RecommendationTarget

```text
id
recommendation_id
target_type
target_id
role
expected_effect
created_at
```

`role`:

```text
primary
secondary
downstream
resource
```

---

# 8.25. Correction

```text
id
organization_id
client_id
date
title
intervention_method_id nullable
method_notes
rationale
expected_effect
priority_score_before
status
specialist_notes
client_visible_summary
created_by
created_at
updated_at
archived_at
```

---

# 8.26. CorrectionTarget

```text
id
correction_id
target_type
target_id
role
expected_effect
created_at
```

`role`:

```text
primary
secondary
downstream
context
```

---

# 8.27. CorrectionExpectedMarker

```text
id
correction_id
marker
life_area
expected_direction
measurement_type
baseline_value nullable
target_value nullable
created_at
updated_at
```

---

# 8.28. Observation

```text
id
organization_id
client_id
correction_id nullable
date
source_type
description
life_areas[]
valence
intensity
supports_improvement
confidence
visibility
created_by
created_at
updated_at
```

---

# 8.29. BehavioralMarker

```text
id
organization_id
client_id
name
description
life_area
marker_type
scale_min
scale_max
current_value
baseline_value
trend
linked_core_node_id nullable
linked_theme_id nullable
linked_resource_id nullable
created_at
updated_at
```

---

# 8.30. FollowUp

```text
id
organization_id
client_id
correction_id
scheduled_at
completed_at
retest_result
behavioral_result
client_feedback
specialist_assessment
ai_assessment
result_status
created_at
updated_at
```

---

# 8.31. ModelChange

Отдельно от AuditLog.

Хранит изменение именно психологической модели.

```text
id
client_id
occurred_at
entity_type
entity_id
previous_state
new_state
change_reason
evidence_refs[]
created_at
```

Пример:

```text
Confidence:
72 -> 88

Reason:
new multi-context evidence from work + authority + father themes
```

---

# 8.32. PsychologicalSnapshot

```text
id
organization_id
client_id
version
generated_at
generated_by
reason
summary
active_core_nodes
active_themes
resource_state
development_targets
recent_triggers
recent_corrections
recommendations
trend_summary
risk_notes
evidence_digest
model_hash
scoring_model_version
ontology_version
ai_model
prompt_version
created_at
```

---

# 8.33. AuditLog

```text
id
organization_id
actor_user_id
entity_type
entity_id
action
before_data
after_data
reason
created_at
ip_address nullable
user_agent nullable
```

---

# 8.34. DiagnosticDomain

Библиотека диагностических тем.

```text
id
organization_id nullable
slug
name
description
domain_group
life_areas[]
default_priority
version
language
applicable_contexts[]
contraindicated_contexts[]
is_system
created_by
created_at
updated_at
archived_at
```

---

# 8.35. BeliefTemplate

```text
id
organization_id nullable
diagnostic_domain_id
code nullable
statement
statement_polarity
default_life_areas[]
default_tags[]
interpretation_hint
root_hypothesis_hint
version
language
is_system
created_by
created_at
updated_at
archived_at
```

BeliefTemplate не является evidence.

Evidence появляется только после реального тестирования и создания Signal.

---

# 9. Relationship layer

Система должна поддерживать пары, но не смешивать приватные данные.

## 9.1. Relationship

```text
id
organization_id
client_a_id
client_b_id
relationship_type
created_at
updated_at
```

---

## 9.2. RelationshipDynamic

```text
id
relationship_id
title
description
confidence_score
evidence_refs
visibility
created_at
updated_at
```

Пример:

```text
"Потребность одного партнёра во внешней опоре сталкивается с сопротивлением второго родительской роли."
```

Запрещено автоматически раскрывать:

```text
"У партнёра X установка Y"
```

без разрешения соответствующего клиента.

---

# 10. Medical / body boundary

Необходимо различать:

```text
MedicalFact
SymptomReport
PsychologicalHypothesis
```

Психологическая модель не должна автоматически создавать медицинскую причинность.

Пример:

```text
"болит палец"
```

не может автоматически превращаться в:

```text
"подавленная агрессия является причиной"
```

Разрешённый тип связи:

```text
possible_association
```

или:

```text
psychological_context_of
```

Запрещено:

```text
causes_confirmed
```

без соответствующего медицинского подтверждения.

---

# 11. Evidence levels

```text
L0_AI_ONLY
L1_SINGLE_SIGNAL
L2_MULTIPLE_SIGNALS
L3_MULTI_CONTEXT
L4_RETEST_CONFIRMED
L5_BEHAVIOR_CONFIRMED
L6_CORRECTION_RESPONSE_CONFIRMED
L7_SPECIALIST_CONFIRMED_LONGITUDINAL
```

Правила:

```text
L0
не увеличивает confidence автоматически

L1
только слабая гипотеза

L2
несколько сигналов, но не обязательно независимых

L3
только при реально независимых контекстах

L4
повторное тестирование

L5
реальное изменение поведения

L6
системное изменение после targeted correction

L7
долгосрочная подтверждённая динамика
```

---

# 12. Интерпретация Signals

```text
positive + stress
=> stress around access to positive possibility

positive + no_stress
=> possible resource/integration

negative + stress
=> active charge around negative scenario

negative + no_stress
=> no active stress detected now

neutral + stress
=> context investigation required
```

Raw statement всегда сохраняется.

---

# 13. Graph logic

Типы узлов:

```text
Signal
EvidenceCluster
Theme
CoreNode
DifferentialHypothesis
Trigger
Resource
DevelopmentTarget
Correction
Observation
BehavioralMarker
Recommendation
```

Типы связей:

```text
supports
contradicts
activates
weakens
reinforces
may_contribute_to
compensates_for
protects_from
depends_on
unlocks
associated_with
supports_hypothesis_of
is_surface_expression_of
is_resource_for
was_targeted_by
changed_after
possible_association
```

---

# 14. Rootness

Rootness повышается, если CoreNode:

- объясняет несколько Themes;
- проявляется в разных жизненных областях;
- имеет независимые подтверждения;
- повторяется во времени;
- активируется разными Trigger;
- связан с несколькими downstream nodes;
- после targeted correction меняются смежные темы.

Rootness не должен расти только из-за большого количества похожих Signals.

---

# 15. Contradictions

Система обязана искать противоречия.

Пример:

```text
"Мне можно быть главным" stress
"Я хочу высокой должности"
"Я боюсь ответственности"
```

Вывод:

```text
possible internal conflict:
desire for leadership
vs
stress around leadership responsibility
```

Система не должна считать противоречие ошибкой данных.

---

# 16. Приоритизация рекомендаций

Использовать:

```text
rootness_score
impact_score
activation_score
confidence_score
client_relevance_score
readiness_score
unlock_score
risk_score
systemic_leverage_score
```

Формула:

```text
final_priority_score =
  0.18 * rootness_score
+ 0.17 * impact_score
+ 0.17 * activation_score
+ 0.13 * confidence_score
+ 0.13 * client_relevance_score
+ 0.08 * readiness_score
+ 0.09 * unlock_score
- 0.05 * risk_score
```

`systemic_leverage_score` рассчитывается отдельно:

> ожидаемый системный эффект одной коррекции относительно стоимости, риска и количества downstream-тем.

Формула должна быть конфигурируемой и версионируемой.

---

# 17. Client relevance

Оценивает связь CoreNode с текущим ClientRequest.

Например:

глубокая тема может быть очень корневой, но сейчас не мешать реализации текущего запроса.

Система не должна автоматически выбирать самый глубокий CoreNode.

---

# 18. Readiness

Readiness учитывает:

- текущее состояние клиента;
- стресс;
- ресурс;
- согласие;
- запрос;
- стабильность;
- способность выдерживать работу.

---

# 19. Unlock score

Показывает:

> сколько других направлений потенциально станет доступнее после коррекции.

---

# 20. Risk

Высокий Risk должен требовать review.

Если:

```text
risk_score >= 80
```

то:

```text
Recommendation.status = draft
human_review_required = true
client_visible = false
```

---

# 21. Correction lifecycle

```text
1 Detect
2 Link evidence
3 Build/Update hypothesis
4 Prioritize
5 Human review
6 Plan correction
7 Define expected markers
8 Complete correction
9 Schedule follow-up
10 Collect observations
11 Retest if needed
12 Evaluate effect
13 Update graph
14 Create ModelChange records
15 Generate new snapshot
16 Recalculate recommendations
```

---

# 22. Correction status

```text
planned
in_progress
completed
follow_up_scheduled
under_review
effective
partially_effective
ineffective
unclear
reactivated
cancelled
```

---

# 23. Integration status rules

CoreNode не может получить `integrated` только потому, что проведена коррекция.

Для `integrated` желательно:

- снижение стресса при ретесте;
- изменение поведения;
- подтверждение во времени;
- изменение минимум в двух контекстах;
- отсутствие значимой реактивации.

Иначе:

```text
weakened
```

---

# 24. Reactivation

Пример:

```text
CoreNode:
status = weakened
activation_score = 25
```

Новый Trigger + свежие Signals:

```text
activation_score >= 60
```

и прирост > configurable threshold.

Тогда:

```text
status = reactivated
```

Порог должен быть конфигурируемым.

---

# 25. Dynamic psychological snapshot

Snapshot показывает:

```text
Active CoreNodes
Active Themes
Resources
DevelopmentTargets
Weakened nodes
Reactivated nodes
Recent Triggers
Recent Corrections
Current Requests
Top Recommendations
Risk zones
Evidence digest
Changes since previous snapshot
```

---

# 26. Ключевой UI-блок: «Что изменилось в модели?»

После каждой новой диагностики система должна показывать:

```text
Что усилилось
Что ослабло
Какие новые Themes появились
Какие CoreNodes появились
Какие гипотезы стали слабее
Какие DifferentialHypotheses появились
Как изменился приоритет коррекций
Какие новые противоречия найдены
```

Пример:

```text
Confidence узла "Внешнее признание" вырос:
72 -> 88

Причина:
новые независимые сигналы в контекстах:
- работа
- авторитет
- отец
```

---

# 27. AI functions

Нельзя использовать один mega-prompt.

Обязательные функции:

```text
ingestSignals
clusterEvidence
classifyThemes
updateCoreNodes
generateDifferentialHypotheses
detectContradictions
evaluateCorrection
updateResources
generateRecommendations
generateSnapshot
explainModelChanges
```

---

# 28. ingestSignals

Input:

```json
{
  "client_id": "uuid",
  "diagnostic_session_id": "uuid",
  "raw_input": "Мне безопасно быть главным - стресс\nЯ боюсь ответственности - стресс",
  "source_type": "kinesiology_test",
  "language": "ru"
}
```

Output:

```json
{
  "signals": [
    {
      "raw_statement": "Мне безопасно быть главным",
      "statement_polarity": "positive",
      "test_result": "stress",
      "normalized_meaning": "Стресс вокруг безопасного права занимать лидерскую позицию",
      "inferred_opposite": "Возможный страх последствий лидерства",
      "confidence": 82,
      "life_areas": ["leadership", "authority", "safety"],
      "evidence_level": "L1_SINGLE_SIGNAL"
    }
  ]
}
```

---

# 29. clusterEvidence

Должна:

- находить семантически похожие Signals;
- объединять их в EvidenceCluster;
- не считать их независимыми evidence;
- учитывать session/context.

---

# 30. classifyThemes

Должна:

- связывать Signals с Themes;
- предлагать новые Themes;
- объяснять rationale;
- учитывать существующую карту.

---

# 31. updateCoreNodes

Должна:

- обновлять существующие CoreNodes;
- предлагать новые;
- учитывать contradictions;
- учитывать independent evidence;
- обновлять Scores;
- создавать ModelChange.

---

# 32. generateDifferentialHypotheses

Должна создавать несколько возможных объяснений при неоднозначности.

Например:

```text
A: паттерн связан с родительской фигурой
B: реакция на объективно токсичную среду
C: реакция на прошлый опыт
```

---

# 33. evaluateCorrection

Должна учитывать:

- retest;
- observations;
- behavioral markers;
- client feedback;
- specialist feedback;
- change across contexts.

---

# 34. generateRecommendations

Output:

```json
{
  "recommendations": [
    {
      "proposed_correction": "Работа с внутренней опорой рядом с авторитетной фигурой",
      "rootness_score": 92,
      "impact_score": 88,
      "activation_score": 79,
      "confidence_score": 83,
      "client_relevance_score": 94,
      "readiness_score": 70,
      "unlock_score": 86,
      "risk_score": 42,
      "systemic_leverage_score": 91,
      "final_priority_score": 83.2,
      "human_review_required": true
    }
  ]
}
```

---

# 35. JSON validation

Все AI outputs:

- strict JSON;
- schema validation;
- no unknown fields;
- scores 0..100;
- enum validation;
- review_status pending;
- unsafe/sensitive outputs -> specialist review.

---

# 36. Human-in-the-loop

Любое AI-created:

```text
Theme
CoreNode
DifferentialHypothesis
Recommendation
Relation
```

получает:

```text
review_status = pending
```

до human approval.

---

# 37. UI screens

```text
/clients
/clients/:id
/clients/:id/requests
/clients/:id/life-events
/clients/:id/signals
/clients/:id/themes
/clients/:id/core-nodes
/clients/:id/resources
/clients/:id/development
/clients/:id/purpose
/clients/:id/map
/clients/:id/corrections
/clients/:id/dynamics
/clients/:id/recommendations
/clients/:id/history
/clients/:id/import
/clients/:id/diagnostic-library
/clients/:id/access
```

---

# 38. Client overview

Показывает:

- активный запрос;
- top CoreNodes;
- top Resources;
- DevelopmentTargets;
- последние Triggers;
- последнюю коррекцию;
- что изменилось;
- следующую Recommendation;
- pending review.

---

# 39. Living Map

Граф:

- CoreNodes;
- Themes;
- Resources;
- Triggers;
- Corrections;
- DevelopmentTargets.

Настройки:

- filter by life area;
- timeline;
- snapshot version;
- evidence strength;
- hide AI-only hypotheses.

---

# 40. Evidence Drawer

Для любого вывода:

```text
Почему система так считает?
```

Показывать:

- raw Signals;
- EvidenceClusters;
- independent contexts;
- contradictions;
- Observations;
- Correction effects;
- score breakdown;
- human confirmations;
- AI rationale;
- DifferentialHypotheses.

---

# 41. Model change screen

Отдельный экран:

```text
После последней диагностики:
+ усилился узел X
- ослабла тема Y
+ появилась гипотеза Z
+ изменился top priority
```

---

# 42. Supabase core additions

Кроме уже перечисленных таблиц добавить:

```text
client_requests
client_goals
client_assignments
consent_records
life_events
diagnostic_session_summaries
evidence_clusters
differential_hypotheses
development_targets
purpose_profiles
purpose_syntheses
intervention_methods
correction_targets
recommendation_targets
model_changes
relationships
relationship_dynamics
ontology_versions
```

---

# 43. RLS requirements

RLS включить на ВСЕ business tables.

Нельзя писать:

```text
apply same policy
```

в реализации.

Должны быть реальные policies.

Доступ:

```text
organization member
AND
client assignment
```

Исключение:

Owner при наличии соответствующего administrative scope.

Client portal не получает прямого доступа к base tables.

---

# 44. Safe helper function

Если используется:

```sql
security definer
```

обязательно:

```sql
set search_path = public
```

и минимальные privileges.

---

# 45. Import / export

Import:

```text
plain text
CSV
JSON
Markdown
ChatGPT analysis
future PDF/docx extraction
```

Всегда:

```text
Import
-> DiagnosticSession
-> AI parsing
-> Human review
-> Signals
```

Export:

```text
JSON full archive
Markdown report
CSV Signals
PDF snapshot
Anonymized supervision export
```

---

# 46. Production security

Требования:

- encrypted transit;
- authenticated access;
- RLS;
- client assignments;
- consent tracking;
- audit logging;
- data erasure;
- rate limiting;
- sensitive prompt redaction;
- secrets server-side only;
- no model training on user data unless explicitly enabled.

---

# 47. Sensitive cases

Если обнаружено:

- self-harm;
- suicidal ideation;
- violence;
- abuse;
- coercive control;
- severe psychiatric symptoms;
- child safety risk;
- medical emergency;

AI:

- не ставит диагноз;
- повышает risk;
- создаёт safety review;
- требует human review;
- не выдаёт опасные самостоятельные рекомендации.

---

# 48. Health / fertility boundary

Allowed:

- анализировать стресс;
- страхи;
- установки;
- отношения;
- ответственность;
- внутренний конфликт.

Not allowed:

- объявлять психологические установки причиной заболевания;
- обещать выздоровление;
- обещать зачатие;
- отговаривать от медицинского обследования.

---

# 49. Ontology versioning

Добавить:

```text
OntologyVersion
- id
- version
- life_areas
- relation_types
- domain_types
- created_at
```

Snapshots должны знать:

```text
ontology_version
scoring_model_version
prompt_version
ai_model
```

---

# 50. Diagnostic library

Системные домены:

```text
Сепарация
Отец
Мать
Внутренняя опора
Авторитет
Лидерство
Ответственность
Границы
Деньги
Успех
Проявленность
Личная сила
Работа и страдание
Родительство
Отношения
Свобода
Перфекционизм
Контроль
Стыд
Вина
Принадлежность
Безопасность
Тело / симптом
Ресурсы
```

---

# 51. Acceptance criteria — интеллектуальная корректность

Система должна уметь:

### 51.1

Не считать AI-гипотезу evidence.

### 51.2

Не считать 20 синонимичных Signals 20 независимыми подтверждениями.

### 51.3

Не создавать медицинскую причинность.

### 51.4

Понижать confidence при противоречащих данных.

### 51.5

Говорить:

```text
"данных недостаточно"
```

### 51.6

Менять старую гипотезу.

### 51.7

Предлагать:

```text
"сначала собрать дополнительные данные"
```

вместо обязательной коррекции.

### 51.8

Различать:

```text
problem reduction
и
resource development
```

### 51.9

Не считать CoreNode integrated без follow-up evidence.

---

# 52. Test case: positive statement stress

Input:

```text
Я достоин занимать новую роль - стресс
```

Expected:

```text
statement_polarity = positive
test_result = stress
normalized_meaning =
"Стресс вокруг достоинства/права занимать новую роль"

NO automatic resource creation
```

---

# 53. Test case: evidence independence

Input:

20 похожих формулировок в одной сессии.

Expected:

```text
Signals count = 20
Independent EvidenceCluster count = 1 or low number
Confidence must NOT inflate as if 20 independent contexts existed
```

---

# 54. Test case: multi-context

Signals:

```text
страх ответственности за ребёнка
страх ответственности за команду
страх ответственности за клиента
```

из разных sessions/context.

Expected:

```text
L3_MULTI_CONTEXT
```

Только если система реально подтверждает независимость контекстов.

---

# 55. Test case: competing hypotheses

Input:

```text
клиент боится нового начальника
```

Система должна иметь возможность предложить:

```text
Hypothesis A:
authority/father dynamic

Hypothesis B:
real workplace threat

Hypothesis C:
previous firing trauma
```

---

# 56. Test case: medical boundary

Input:

```text
у клиента повышенное давление
клиент подавляет злость
```

Expected:

```text
possible psychological association
```

NOT:

```text
suppressed anger caused hypertension
```

---

# 57. Universal seed examples

Использовать минимум 3 разных seed profiles.

## Client A

Leadership / authority / money / responsibility.

## Client B

Relationships / attachment / jealousy / boundaries.

## Client C

Workaholism / pleasure / money / perfectionism.

Цель:

> не позволить системе выучить одну заранее заданную теорию психики.

---

# 58. Phased implementation

Это НЕ MVP.

Фазы определяют порядок создания полной системы.

## Phase 1

Foundation:

- Auth;
- Organizations;
- Client assignments;
- Consent;
- Clients;
- Requests;
- Goals;
- LifeEvents;
- DiagnosticSessions;
- Signals;
- EvidenceClusters;
- Diagnostic library;
- RLS;
- Audit.

## Phase 2

Psychological model:

- Themes;
- CoreNodes;
- DifferentialHypotheses;
- Relations;
- Context engine;
- Contradiction detection;
- Evidence levels.

## Phase 3

Resources and development:

- Resources;
- DevelopmentTargets;
- PurposeProfile;
- PurposeSynthesis.

## Phase 4

AI analytical engine:

- ingestSignals;
- clusterEvidence;
- classifyThemes;
- updateCoreNodes;
- generateDifferentialHypotheses;
- detectContradictions;
- explainModelChanges.

## Phase 5

Corrections:

- InterventionMethods;
- Recommendations;
- CorrectionTargets;
- ExpectedMarkers;
- Observations;
- BehavioralMarkers;
- FollowUps;
- evaluateCorrection.

## Phase 6

Living map:

- graph;
- evidence drawer;
- timeline;
- model change UI;
- snapshot comparison.

## Phase 7

Relationship layer:

- Relationships;
- RelationshipDynamics;
- privacy boundaries.

## Phase 8

Production hardening:

- imports;
- exports;
- monitoring;
- backups;
- deletion workflows;
- logging;
- rate limiting;
- staging;
- production.

---

# 59. Definition of done

Проект считается production-ready, когда:

- все основные сущности реализованы;
- история клиента сохраняется;
- client requests работают;
- evidence independence реализована;
- AI hypothesis не подтверждает сама себя;
- RLS защищает каждого клиента;
- consent реализован;
- purpose layer работает;
- resource/development layer работает;
- CoreNodes имеют evidence;
- DifferentialHypotheses работают;
- Corrections поддерживают несколько targets;
- BehavioralMarkers работают;
- FollowUps обновляют модель;
- Reactivation определяется;
- Snapshots версионируются;
- scoring versioned;
- model changes объяснимы;
- recommendation ranking объясним;
- medical causality ограничена;
- relationship privacy работает;
- import/export работает;
- audit trail работает;
- acceptance tests проходят.

---

# 60. Главный продуктовый принцип

Система должна отвечать не только:

> «Какие проблемы есть у клиента?»

а прежде всего:

> **«Какая минимальная следующая коррекция с наибольшей вероятностью даст максимальный системный положительный эффект именно для текущего запроса этого клиента?»**

При этом система должна учитывать:

- корневость;
- актуальность;
- независимость evidence;
- готовность;
- риск;
- ресурсы;
- текущий запрос;
- прошлые коррекции;
- реальную поведенческую динамику;
- конкурирующие гипотезы.

Главная метрика системы:

# Systemic Leverage

> **Максимальное улучшение системы клиента при минимальном количестве точных и безопасных вмешательств.**
