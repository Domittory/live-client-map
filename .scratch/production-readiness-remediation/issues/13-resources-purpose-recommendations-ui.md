# 13: Добавить Resources, DevelopmentTargets, Purpose и Recommendations

**What to build:** Завершить положительную и развивающую часть client workspace: Specialist управляет Resources, DevelopmentTargets и PurposeProfile, затем создаёт и ревьюит объяснимые Recommendations.

**Blocked by:** 06/Сделать мутации психологической модели атомарными; 12/Добавить review workflow для Themes, CoreNodes и DifferentialHypotheses.

**Status:** resolved

- [x] Specialist создаёт, изменяет и просматривает Resources, DevelopmentTargets и PurposeProfile из client context.
- [x] Purpose synthesis и Recommendations ссылаются на разрешённое evidence и показывают limitations.
- [x] Recommendation ranking объясним, а AI-created Recommendation остаётся pending до human review.
- [x] Specialist управляет visibility/published state без раскрытия private reasoning Client Portal User.
- [x] Browser tests покрывают полный путь от evidence к reviewed Recommendation и insufficient-data state.

## Implementation result

### Что сделано

Три реальных client-scoped экрана вместо заглушек; каждый проходит через `requireClientWorkspace` + `canUseSection`, поэтому база (RLS), а не UI, решает вопрос доступа.

**`/clients/[id]/resources` — Resources + DevelopmentTargets.**
Решение по размещению: DevelopmentTargets живут на экране Resources, потому что это «развивающая» половина того же положительного слоя, и цель связывается именно с ресурсами и ключевыми узлами; отдельный полупустой раздел не создавался.
- Resources: создание, редактирование (переиспользованы существующие `createResource` / `updateResource` — оценка меняется только вместе с evidence/причиной) и просмотр вместе с полем «Доказательства ресурса», evidence-refs и ограничениями.
- DevelopmentTargets: создание и редактирование через новую сервисную функцию `updateDevelopmentTarget` (RPC `update_development_target`), просмотр уровней, маркеров успеха, связей и ограничений.

**`/clients/[id]/purpose` — PurposeProfile + PurposeSynthesis (только ручной ввод и просмотр).**
Автоматический алгоритм определения предназначения не создавался. Профиль вносится специалистом с указанием источника (`jyotish` / `human_design` / `specialist_assessment` / `client_self_report` / `other`), исходных данных (JSON-объект), интерпретации, сильных сторон, ролей, направлений и видимости. Синтез — ручной вывод, который всегда показывается вместе со списком профилей-источников. Для интерпретационных систем всегда выводится ограничение «источник гипотез, а не объективный психологический факт».

**`/clients/[id]/recommendations`.**
- Генерация через существующий сервис `generateRecommendations` (AI gateway + consent + versioned scoring). Новый `generateClientRecommendations` только собирает контекст клиента (активный запрос, подтверждённые темы и узлы, approved-ресурсы, цели развития, score cards, риски, прошлые коррекции, методы) — доменные правила не дублируются.
- Ranking объясним: для каждой рекомендации пересчитывается итоговый приоритет по той же версионированной формуле SPEC §16 и выводится таблица «оценка / значение / вес / вклад», обоснование порядка от AI, версия scoring-модели и явное предупреждение, если сохранённое значение расходится с пересчитанным.
- Ревью: явное «Подтвердить»/«Отклонить» с причиной (отклонение без причины отклоняется и в UI, и в БД). Повторное ревью уже решённой рекомендации невозможно.
- Публикация: отдельное действие специалиста (внутренняя ↔ опубликована в клиентском портале); в БД запрещено публиковать не подтверждённое человеком или высокорисковое (`risk_score >= 80`, SPEC §20), а также без согласия `client_portal`.
- Private reasoning (`rationale`, `risk_notes`, обоснование порядка) видно только специалисту: клиентский портал (`getClientPortal`) отдаёт исключительно `id`, `proposed_correction`, `final_priority_score`.

**Каждое conclusion показано с evidence и ограничениями.** Синтез предназначения и рекомендации переиспользуют канонический Evidence Drawer (`lib/service/evidence.ts`); пустые данные помечаются «недостаточно данных» и никогда не подаются как вывод. Для рекомендаций лимиты складываются из отсутствия целей/доказательств, неразрешённых целей, неполного score card, отметок AI о нехватке данных, статуса draft/rejected и высокого риска.

### Новые / изменённые файлы

Новые:
- `supabase/migrations/0048_client_positive_layer.sql` — три атомарных RPC: `update_development_target`, `review_recommendation`, `set_recommendation_visibility` (security definer, `assert_client_write`, audit row в одной транзакции, revoke/grant по шаблону 0047).
- `lib/service/recommendations.ts` — read model рекомендаций (targets + evidence + limits), сбор контекста, `generateClientRecommendations`, `reviewRecommendation`, `setRecommendationVisibility`.
- `lib/service/resources-presentation.ts`, `lib/service/purpose-presentation.ts`, `lib/service/recommendations-presentation.ts` — русские подписи, правило «недостаточно данных» и объяснение ранжирования (чистые функции).
- `app/actions/resources.ts`, `app/actions/purpose.ts`, `app/actions/recommendations.ts` — Server Actions по конвенции тикетов 09–12.
- `app/clients/[id]/resources/resources-forms.tsx`, `app/clients/[id]/purpose/purpose-forms.tsx`, `app/clients/[id]/recommendations/recommendations-forms.tsx`.
- `e2e/recommendations.spec.ts` — 5 браузерных тестов.
- `tests/unit/resources-labels.unit.test.ts`, `tests/unit/purpose-labels.unit.test.ts`, `tests/unit/recommendations-labels.unit.test.ts`, `tests/integration/recommendation-review.integration.test.ts`.

Изменённые:
- `app/clients/[id]/resources/page.tsx`, `app/clients/[id]/purpose/page.tsx`, `app/clients/[id]/recommendations/page.tsx` — реальные экраны вместо `ClientSectionPlaceholder` (сам placeholder не тронут).
- `lib/service/resources.ts` (+`listClientResources`), `lib/service/development-targets.ts` (+`listDevelopmentTargets`, `updateDevelopmentTarget`), `lib/service/purpose.ts` (+`getClientPurpose`), `lib/service/core-nodes.ts` (+`listLinkableCoreNodes`).
- `tests/integration/resources.integration.test.ts`, `tests/integration/development-targets.integration.test.ts`, `tests/integration/purpose.integration.test.ts` — тесты на новые read model и update.

Существующие публичные контракты не менялись: только добавления. Переиспользованы `createResource`, `updateResource`, `createDevelopmentTarget`, `createPurposeProfile`, `createPurposeSynthesis`, `generateRecommendations`, `getEvidence`, `conclusionLimits`, `finalPriorityScore`, `getClientPortal`.

### Проверки

- `pnpm typecheck` — успешно.
- `pnpm lint` (eslint + prettier --check) — успешно.
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 97 файлов / 682 теста, все зелёные (до тикета 93 файла / 643 теста).
- `pnpm test:e2e` — 23 теста, все зелёные (было 18). Новые тесты:
  - `client resources, development targets and purpose › specialist creates and edits a resource and a development target in the client context`;
  - `client resources, development targets and purpose › specialist enters the purpose profile and synthesis manually and sees the limits`;
  - `client recommendations › full path from evidence to a reviewed and published recommendation`;
  - `client recommendations › generation without confirmed data and a recommendation without evidence stay insufficient data`;
  - `client recommendations › unassigned, read-only and portal users are denied in the browser and in the database`.
- Перед запуском тестов выполнен `supabase db reset` (локальная dev-база), чтобы применить миграцию 0048.

### Решения и риски, требующие внимания lead

1. **Новая миграция.** Добавлена одна миграция `0048` с тремя RPC. Без неё ревью рекомендаций и публикация были бы возможны только «сырым» UPDATE без audit row и без state-guard, что противоречит контракту атомарных мутаций (тикет 01/06). Нужно подтвердить, что добавление миграции в рамках тикета 13 приемлемо.
2. **Что считается «изменением».** `update_resource` не позволяет менять name/description/domain — редактирование ресурса в UI ограничено оценками и evidence (как и было в существующем контракте сервиса). Для DevelopmentTarget редактируются все поля, но смена уровней/статуса требует причины.
3. **Идемпотентность AI-запуска.** AI gateway кэширует одинаковый вход и при повторе возвращает пустой результат, поэтому повторное нажатие «Сформировать рекомендации» без изменения данных не создаёт дублей, а сообщение честно говорит об обоих вариантах (недостаточно данных либо предложения уже сформированы). Существующий контракт `generateRecommendations` не менялся.
4. **Ограничение AI-контракта.** Для `ai.generate-recommendations.v1` проекция ресурса строго `{id, name, domain}`; сборщик контекста приведён к контракту (до этого вызовов не было, поэтому несоответствие не проявлялось).
5. **Публикация и портал.** Публикация запрещена для `human_review_required` (в т.ч. `risk_score >= 80`) — это трактовка SPEC §20; если бизнес захочет публиковать одобренную человеком высокорисковую рекомендацию, правило придётся пересматривать осознанно.
6. **Purpose.** Никакой автоматической детекции нет и не добавлено; редактирование уже сохранённого профиля/синтеза не реализовано (в тикете требуется ручной ввод и просмотр) — при необходимости это отдельная задача с новыми RPC.

## Ревью ведущего

- **Права миграции 0048**: `update_development_target`, `review_recommendation`,
  `set_recommendation_visibility` — `SECURITY DEFINER`, `assert_client_write` внутри,
  audit в той же транзакции; `anon` выполнять не может, `authenticated` — может;
  общий список anon-доступных функций не изменился (8). RLS/consent не ослаблены.
- **Приватность клиентского портала проверена по коду**: проекция для портала
  (`lib/service/client-portal.ts`) выбирает только `id, proposed_correction,
  final_priority_score` — `rationale`, `risk_notes`, `rank_rationale` и прочие
  внутренние обоснования в портал не попадают. Публикация запрещена без
  подтверждения человеком, при `human_review_required` и без согласия
  `client_portal`.
- **Автоматического определения предназначения нет** — профиль и синтез вводятся и
  просматриваются вручную, что соответствует SPEC и handoff-записке.
- **Прогоны**: полный набор 97 файлов / 682 теста — зелёный; `pnpm test:e2e` —
  **23 теста** (5 новых + 18 прежних); `pnpm typecheck`, `pnpm lint` — зелёные.
- **Решения, требующие подтверждения владельца**: (1) DevelopmentTargets размещены
  на экране Resources, а не в отдельном разделе; (2) публикация одобренной
  высокорисковой рекомендации (`risk_score >= 80`) запрещена — трактовка SPEC §20;
  (3) редактирование уже сохранённого PurposeProfile/Synthesis не реализовано
  (тикет требует ручной ввод и просмотр).
