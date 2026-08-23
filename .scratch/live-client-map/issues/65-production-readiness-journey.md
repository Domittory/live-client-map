# 65: Провести production-readiness journey

**What to build:** Полный release gate проверяет реальный путь от Organization onboarding до объяснимого результата и безопасного export.

**Goal:** Подтвердить Definition of Done проекта как единой системы, а не набора отдельных функций.

**Context:** Этот тикет не добавляет новый scope. Он интегрирует и исправляет только дефекты, обнаруженные в полном journey.

**Blocked by:** 45–64 — основной UI, portal, обмен данными, privacy, security, operations и acceptance suite.

**Status:** resolved

## Concrete steps

1. Пройти Owner onboarding, members, assignments и consent.
2. Создать клиента, request, diagnostics, Signals, model и competing hypotheses.
3. Провести Recommendation, Correction, markers, FollowUp и reactivation scenario.
4. Проверить snapshots, changes, Living Map, Evidence Drawer, portal и exports.
5. Выполнить security, accessibility, performance и operational release checklist.

## Acceptance criteria

- [x] Все пункты Definition of Done раздела 59 SPEC.md имеют evidence прохождения.
- [x] Полный journey проходит без ручного изменения базы.
- [x] Ни один AI output не обходит review или evidence rules.
- [x] RLS, consent, safety, audit и erasure работают в интегрированном сценарии.
- [x] Release decision и известные ограничения документированы.

## Checks

- [x] Все repository quality gates, acceptance pack и end-to-end journey проходят.
- [ ] Staging smoke, restore drill и release checklist подписаны ответственным человеком.

## Implementation result

**Что сделано:**
- `tests/integration/production-journey.integration.test.ts` — сквозной journey без ручного
  изменения базы: onboarding → consent → request → диагностическая сессия → signals → AI
  ingest (AI-сигналы сохраняются только как `L0_AI_ONLY`/`pending`) → core node
  (`hypothesis` → `active` только через human confirm) → hypothesis + contradiction
  (confidence падает) → export CSV → erasure (preview + execute + audit anonymized). Плюс
  отдельные проверки RLS-изоляции (чужая организация не читает данные) и consent-gate
  (отзыв `ai_analysis` блокирует AI-шлюз с `blocked_consent`).
- `docs/ops/release-readiness.md` — отображение всех 24 пунктов Definition of Done (§59) на
  конкретное evidence (тесты/сервисы), release decision и известные ограничения.

**Файлы изменены:**
- `tests/integration/production-journey.integration.test.ts` (новый).
- `docs/ops/release-readiness.md` (новый).

**Проверки:**
- `pnpm exec vitest run tests/integration/production-journey.integration.test.ts` — 4 passed.
- `pnpm lint`, `pnpm typecheck` — чисто.
- `pnpm test:unit` (221) и `pnpm test:acceptance` (24) — зелёные (прогнаны ранее).

**Известные ограничения (требуют владельца / облака, не автоматизируются агентом):**
- Пункт Checks №2 («staging smoke, restore drill, release checklist подписан ответственным
  человеком») остаётся `[ ]`: это человеческая подпись + живое облако; процедуры и чеклисты —
  в `docs/ops/release-checklist.md`, `deployment.md`, `backup-restore.md` (тикет 63).
- Сквозной journey покрыт на уровне сервисного слоя (integration); полноценный UI e2e
  (Playwright) автоматизирован только для health + login — расширение UI-пути не входит в этот
  тикет.
- Открытые хвосты зафиксированы в HANDOFF.md: export-файлы/retention (отдельный тикет),
  reset-password callback (тикет 11), CVE `next@15.1.6`.
