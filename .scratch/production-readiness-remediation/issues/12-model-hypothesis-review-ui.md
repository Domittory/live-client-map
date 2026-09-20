# 12: Добавить review workflow для Themes, CoreNodes и DifferentialHypotheses

**What to build:** Дать Specialist client-scoped интерфейс для анализа и human review Themes, CoreNodes, DifferentialHypotheses и contradictions с полным Evidence Trail.

**Blocked by:** 06/Сделать мутации психологической модели атомарными; 10/Добавить client-scoped DiagnosticSessions и Signals.

**Status:** resolved

- [x] Specialist просматривает Themes и их Signal links, CoreNodes и несколько competing DifferentialHypotheses.
- [x] Каждая conclusion показывает supporting/contradicting evidence и ограничения данных.
- [x] AI proposals остаются pending/L0 до явного approve/reject и не меняют confirmed entity молча.
- [x] Contradictions видимы и не удаляются при подтверждении одной из competing hypotheses.
- [x] Browser tests проходят review path и проверяют persisted model, audit и unauthorized denial.

## Implementation result

### Что реализовано

**Экран ревью модели** `/clients/[id]/review` (server component, client-scoped) показывает:
- Темы с их связями с сигналами (statement, источник, уровень доказательности, статус ревью, релевантность, обоснование связи);
- Ключевые узлы (CoreNodes) с их связями с темами (название темы, тип связи, обоснование);
- Несколько конкурирующих DifferentialHypotheses для одного клиента — без автоматического выбора «победителя» (явная подсказка и отсутствие автосортировки/автоподтверждения);
- Для каждой conclusion — Evidence Trail: подтверждающие доказательства, противоречащие доказательства и список «Ограничения данных». Если подтверждающих доказательств нет, выводится «недостаточно данных», а не голая conclusion.

**Human-in-the-loop.** AI-предложения из RPC 0042 остаются `pending` / `under_review` / `hypothesis` (L0) до явного решения. Решение принимается только через атомарные RPC, которые сами проверяют запись и пишут AuditLog с актором:
- Themes: новая `review_theme(p_org_id, p_theme_id, p_decision, p_reason)` (миграция 0047) — `pending → approved/rejected`; отклонение требует причины; повторное решение по уже подтверждённой сущности отклоняется (SQLSTATE 55000);
- DifferentialHypotheses: новая `review_hypothesis(...)` (миграция 0047) — `hypothesis → active/rejected`; отклонение требует причины; подтверждение одной гипотезы не трогает остальные и их `evidence_against`;
- CoreNodes: переиспользованы существующие `confirmCoreNode` / `rejectCoreNode` (`set_core_node_status`, миграция 0042) — новых сущностей не создавалось.

Подтверждённая человеком сущность не перезаписывается AI молча (это уже обеспечивает 0042), а экран не даёт повторно «перерешать» её.

**Авторизация.** Остаётся целиком в БД: guard `requireClientWorkspace` + `is_client_accessible` RLS. Раздел `review` по-прежнему `requires: "write"`, поэтому read-only/supervisor не видят пункт навигации и получают нейтральный `client-section-denied` при прямом переходе, без контролов записи. Незакреплённый пользователь получает нейтральный 404. Все мутации дополнительно отклоняются RPC-гардом (`42501`).

### Переиспользованные функции/слои
- `lib/service/evidence.ts` → `getEvidence` (канонический Evidence Trail для каждой сущности);
- `lib/service/core-nodes.ts` → `confirmCoreNode`, `rejectCoreNode`;
- `lib/service/themes.ts`, `lib/service/hypotheses.ts` — расширены новыми `reviewTheme`, `reviewHypothesis` (публичные контракты существующих функций не менялись);
- паттерны ticket 09–11: `requireClientWorkspace`, `canUseSection`, `ClientWorkspaceHeader` / `ClientSectionDenied`, `useActionState`-формы, русские подписи из `diagnostics-presentation.ts`.

### Файлы
- `supabase/migrations/0047_atomic_model_review.sql` — новые;
- `lib/service/themes.ts`, `lib/service/hypotheses.ts` — новые функции ревью;
- `lib/service/model-review.ts`, `lib/service/model-review-presentation.ts` — новые read model и presentation;
- `app/actions/review.ts` — новые Server Actions;
- `app/clients/[id]/review/page.tsx` — заменён placeholder; `app/clients/[id]/review/review-forms.tsx` — новые формы;
- `tests/integration/model-review.integration.test.ts`, `tests/unit/model-review-labels.unit.test.ts`, `e2e/model-review.spec.ts` — новые тесты.

### Проверки
- `pnpm typecheck` — успешно;
- `pnpm lint` (eslint + prettier --check) — успешно;
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — 93 файла / 643 теста passed (было 91/626);
- `pnpm test:e2e` — 18 passed (15 существующих + 3 новых `e2e/model-review.spec.ts`).

### Принятые решения / на что обратить внимание
- Раздел review оставлен `requires: "write"`, чтобы не ломать существующий тест `client-workspace.spec.ts` (supervisor не видит пункт «Ревью модели»). Нейтральный отказ для read-only/supervisor — это section denial, а не read-only версия экрана. Если продукт хочет read-only просмотр ревью, нужно отдельным тикетом сменить `requires` на `"read"` и обновить этот тест.
- Введена миграция 0047: до неё у Theme/DifferentialHypothesis вообще не было guarded-пути подтверждения (только прямой UPDATE). RLS/consent не ослаблялись, новые RPC — `security definer` с `assert_client_write`, EXECUTE только `authenticated`/`service_role`.
- `getModelReview` строит trail через `getEvidence` по каждой сущности (N+1 чтение). Для экрана ревью приемлемо; для больших моделей в будущем стоит bulk-версию.

## Ревью ведущего

- **Права миграции 0047**: `review_theme` и `review_hypothesis` — `SECURITY DEFINER`
  с `assert_client_write` внутри, audit с актором и причиной, переход только из
  pending; `anon` выполнять не может, `authenticated` — может. Общий список
  anon-доступных функций не изменился (8). RLS/consent не ослаблены.
- **Human-in-the-loop**: подтверждение/отклонение идёт только явным действием через
  guarded RPC; AI-предложения остаются pending до решения человека; отдельный
  integration-тест проверяет, что подтверждение одной конкурирующей гипотезы
  сохраняет остальные и их противоречия.
- **Прогоны**: полный набор 93 файла / 643 теста — зелёный; `pnpm test:e2e` —
  **18 тестов** (3 новых review + 15 прежних); `pnpm typecheck`, `pnpm lint` —
  зелёные.
- **Осознанное ограничение**: раздел «Ревью модели» остаётся `requires: "write"`,
  поэтому supervisor/read-only получают нейтральный отказ раздела, а не версию
  только для чтения (так требует уже существующий workspace-тест). Если продукт
  хочет показывать ревью read-only роли — это отдельное решение и правка
  `CLIENT_SECTIONS` + теста.
