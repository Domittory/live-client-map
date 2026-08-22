# 39: Реализовать планирование Correction

**What to build:** Специалист превращает одобренную Recommendation в Correction с несколькими targets и ожидаемыми markers.

**Goal:** Создать проверяемый план вмешательства до его проведения.

**Context:** CorrectionTarget поддерживает primary, secondary, downstream и context roles. Expected markers задаются до результата.

**Blocked by:** 37 — Recommendations; 38 — InterventionMethod library.

**Status:** resolved

## Concrete steps

1. Реализовать Correction, CorrectionTarget и CorrectionExpectedMarker.
2. Создать flow от Recommendation к planned Correction.
3. Валидировать target references, method contraindications и required consent.
4. Добавить Corrections UI с rationale, expected effect и markers.
5. Покрыть multi-target, status и audit tests.

## Acceptance criteria

- [x] Одна Correction поддерживает несколько типизированных targets.
- [x] Expected markers фиксируются до completed status.
- [x] Priority score before сохраняется для будущего сравнения.
- [x] Нельзя стартовать Correction с нарушенным consent или contraindication rule.

## Checks

- [x] Пройдены create-from-recommendation и multi-target tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0028_corrections.sql`: таблицы `corrections`, `correction_targets`, `correction_expected_markers`; RLS через `is_client_accessible`; RPC `validate_correction_target` для проверки существования target в рамках organization/client.
- Сервис `lib/service/corrections.ts`: `createCorrectionFromRecommendation`, `listCorrections`, `getCorrection`, `updateCorrection`, `archiveCorrection`. Flow от одобренной Recommendation, копирование priority_score_before, валидация targets, consent gate (`data_storage` + `sensitive_psychological_data`, `client_portal` при client-visible summary), contraindication gate (acknowledgment required).
- Server actions `app/actions/corrections.ts` и API routes `app/api/corrections/*`.
- UI `/corrections` (список), `/corrections/[id]` (детальная), `/corrections/new?recommendationId=...` (создание из recommendation с targets и expected markers).
- Ссылка на `/corrections` с главной страницы.
- Типы БД перегенерированы (`pnpm db:types`).

**Изменённые/созданные файлы:**
- `supabase/migrations/0028_corrections.sql`
- `lib/service/corrections.ts`
- `app/actions/corrections.ts`
- `app/api/corrections/route.ts`, `app/api/corrections/[id]/route.ts`
- `app/corrections/page.tsx`, `app/corrections/[id]/page.tsx`, `app/corrections/new/page.tsx`, `app/corrections/forms.tsx`
- `app/page.tsx`
- `lib/supabase/database.types.ts`
- `tests/unit/corrections.unit.test.ts`
- `tests/integration/corrections.integration.test.ts`

**Пройденные проверки:**
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 43 files, 208 tests passed (unit + smoke + integration)
- `pnpm build` — production build OK
- `supabase migration up` — миграция 0028 применена к локальной БД
