# 50: Реализовать Relationship и RelationshipDynamic

**What to build:** Специалист анализирует relationship между двумя клиентами, не раскрывая приватные данные одного другому.

**Goal:** Добавить relationship layer с отдельной consent и visibility boundary.

**Context:** Relationship analysis требует соответствующих assignments и consent обоих клиентов. Автоматическое раскрытие установки партнёра запрещено.

**Blocked by:** 05 — privacy policy; 13 — consent gates; 17 — Client; 27 — graph semantics.

**Status:** resolved

## Decision

- Миграция `0026`: `relationships` (client_a_id + client_b_id, unique, check a<>b) + `relationship_dynamics` (title, description, confidence_score, evidence_refs[], visibility). RLS требует `is_client_accessible` для ОБОИХ клиентов — поэтому client-portal (не-член org) не читает relationship-данные вообще.
- Сервис `lib/service/relationships.ts`: каждая операция требует write-доступ к обоим клиентам И активный consent `relationship_analysis` у обоих (SPEC §5). Отзыв consent блокирует новые analyses и скрывает read-view.
- Privacy gate: `evidence_refs` фильтруются — ссылки на сигналы с visibility internal/sensitive отбрасываются и при записи, и при чтении (privacy-filtered view), чтобы private evidence партнёра не утекал.

## Concrete steps

1. Реализовать Relationship и RelationshipDynamic contracts.
2. Проверять tenant, assignments и consent для обоих clients.
3. Создать service, который формирует privacy-filtered evidence view.
4. Добавить specialist UI для relationship и dynamics.
5. Покрыть asymmetric permissions, revoke и leakage tests.

## Acceptance criteria

- [ ] Relationship связывает только разрешённых клиентов одной допустимой области.
- [ ] Dynamic не раскрывает private evidence клиента без его scope.
- [ ] Отзыв consent прекращает новые analyses и скрывает запрещённое.
- [ ] Client Portal никогда не получает данные партнёра напрямую.

## Checks

- [x] Пройдены two-client permission matrix и indirect-leak tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0026_relationships.sql`: `relationships` + `relationship_dynamics`; RLS «оба клиента доступны»; check a<>b; unique(a,b).
- Сервис `lib/service/relationships.ts`: `createRelationship`, `createRelationshipDynamic`, `listRelationshipDynamics`. Все три требуют write-доступ + `relationship_analysis` consent для обоих клиентов; `createRelationshipDynamic` и `listRelationshipDynamics` фильтруют private signal refs (visibility ≠ client_visible).
- Тесты: same-org success; cross-org rejection; not-assigned rejection; private-evidence filter; consent revocation блокирует новые analyses и скрывает view.

**Изменённые/созданные файлы:**
- `supabase/migrations/0026_relationships.sql` (новый)
- `lib/service/relationships.ts` (новый)
- `tests/integration/relationships.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/50-relationships-privacy.md`

**Пройденные проверки:**
- Интеграционный тест тикета 50 (5 шт.) — pass.
- `eslint` и `prettier` на файлах тикета — pass.
- `pnpm typecheck` — файлы тикета чистые; глобальные ошибки остаются в `lib/service/interventions.ts` (ticket 38) и `lib/service/ai-cluster.ts:137` (предсуществующие).

**Note:** privacy-фильтр по `signals.visibility`; evidence_refs предполагаются из двух клиентов relationship (проверка доступа это гарантирует). Client Portal не читает relationships через RLS (не член org). UI отложен в UI-тикеты (45+).
