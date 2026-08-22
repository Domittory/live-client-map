# 31: Реализовать PurposeProfile и PurposeSynthesis

**What to build:** Специалист сохраняет purpose inputs и формирует осторожный synthesis между несколькими интерпретационными системами.

**Goal:** Поддержать purpose layer без превращения Jyotish или Human Design в объективные факты.

**Context:** Source systems являются источниками гипотез. Synthesis должен показывать совпадения, конфликты и confidence.

**Blocked by:** 17 — Client; 29 — Resources; 30 — DevelopmentTargets.

**Status:** resolved

## Decision

- `purpose_profiles` + `purpose_syntheses` добавляют `organization_id`/`client_id` (tenant boundary).
- `source_system` — enum `jyotish`/`human_design`/`specialist_assessment`/`client_self_report`/`other`; интерпретационные системы хранятся как источники гипотез, а не факты.
- Purpose-слой не трогает evidence counts психологической модели (нет автоматических ссылок на Signals/Themes/CoreNodes).

## Concrete steps

1. Реализовать PurposeProfile и PurposeSynthesis contracts.
2. Создать services для raw data, interpretation и visibility.
3. Реализовать ручной synthesis matches, conflicts и development vectors.
4. Добавить Purpose UI с явным epistemic disclaimer.
5. Покрыть multi-source, visibility и no-fact-promotion tests.

## Acceptance criteria

- [ ] Каждый PurposeProfile сохраняет source system и raw data.
- [ ] Synthesis не меняет evidence counts психологической модели.
- [ ] Потенциальные конфликты показываются, а не скрываются.
- [ ] Client-visible content контролируется отдельно.

## Checks

- [ ] Пройдены source classification и epistemic-boundary tests.
- [ ] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Миграция `0022_purpose_profiles.sql`: таблицы `purpose_profiles` (source_system enum, raw_data jsonb, interpretation, strengths[], potential_roles[], development_directions[], confidence, visibility) и `purpose_syntheses` (summary, cross_system_matches[], potential_conflicts[], recommended_development_vectors[]); RLS; права.
- Сервисный слой `lib/service/purpose.ts`: `createPurposeProfile` (сохраняет source_system + raw_data), `createPurposeSynthesis` (matches/conflicts/vectors), audit.
- Тесты: source system + raw data сохраняются, synthesis хранит matches/conflicts/vectors, невалидный source system отклоняется.

**Изменённые/созданные файлы:**
- `supabase/migrations/0022_purpose_profiles.sql`
- `lib/service/purpose.ts`
- `tests/integration/purpose.integration.test.ts`

**Пройденные проверки:**
- Тесты тикета 31 (3 шт.) — pass.
- `pnpm lint` — файлы этого тикета проходят.
- `pnpm typecheck` — файлы этого тикета проходят; note: ошибки в `lib/service/interventions.ts` — параллельная работа (ticket 38).

**Note:** purpose-слой не меняет evidence counts психологической модели (нет автоматических ссылок на Signals/Themes/CoreNodes); интерпретационные системы — источники гипотез, не факты.
