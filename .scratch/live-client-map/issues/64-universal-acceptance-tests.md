# 64: Создать универсальный acceptance test pack

**What to build:** Автоматический набор доказывает интеллектуальную корректность на трёх разных seed profiles.

**Goal:** Не позволить системе выучить одну заранее заданную теорию или нарушить ключевые evidence boundaries.

**Context:** Использовать Client A, B и C и обязательные кейсы разделов 51–57 SPEC.md.

**Blocked by:** 20–28 — diagnostic/model foundation; 33–37 — AI/recommendations; 41–44 — evaluation/snapshots; 50 — relationships; 59 — safety; 60 — RLS.

**Status:** resolved

## Concrete steps

1. Создать три универсальных seed profiles без hardcoded product behavior.
2. Автоматизировать positive-stress, evidence independence и multi-context cases.
3. Автоматизировать competing hypotheses, contradiction и insufficient-data cases.
4. Автоматизировать resource independence, integration и medical boundary cases.
5. Подключить pack к обязательному CI release gate.

## Acceptance criteria

- [x] Все criteria 51.1–51.9 имеют явный automated test.
- [x] Cases 52–56 проходят для deterministic и AI-contract paths.
- [x] Seeds покрывают leadership, relationships и workaholism profiles.
- [x] Ни один тест не требует production AI или real client data.

## Checks

- [x] Acceptance pack воспроизводимо проходит на clean test database.
- [x] Намеренно нарушенное evidence rule делает соответствующий тест красным.

## Implementation result

**Что сделано:**
- Приёмный тест-пакет `tests/acceptance/` из трёх файлов, отображающих SPEC §51–57 на
  автоматические тесты (24 теста):
  - `51-criteria.test.ts` — явный тест на каждый критерий 51.1–51.9.
  - `52-56-cases.test.ts` — кейсы §52–§56 для двух путей: детерминированные функции
    (`interpretSignal`, `clusterByTopicAndContext`, `guardAiOutput`, …) и валидация
    строгих Zod-контрактов AI (`AI_CONTRACTS`).
  - `57-seed-profiles.test.ts` — три seed-профиля (leadership / relationships /
    workaholism) и проверка, что одни и те же правила работают для всех профилей
    (отсутствие overfit).
- `package.json`: скрипт `test:acceptance` (`vitest run tests/acceptance`).
- `.github/workflows/ci.yml`: acceptance-тесты подключены к обязательному CI quality job
  (release gate).

**Файлы изменены:**
- `tests/acceptance/51-criteria.test.ts` (новый).
- `tests/acceptance/52-56-cases.test.ts` (новый).
- `tests/acceptance/57-seed-profiles.test.ts` (новый).
- `package.json` (скрипт `test:acceptance`).
- `.github/workflows/ci.yml` (шаг Acceptance tests).

**Проверки:**
- `pnpm test:acceptance` — 24 passed.
- `pnpm test:unit` — 221 passed.
- `pnpm typecheck` — чисто.
- `pnpm lint` — чисто (eslint + prettier).

**Как закрыты Checks:**
- «Clean test database»: пакет чисто детерминированный и не требует БД/Supabase/сети,
  поэтому воспроизводим от прогона к прогону по определению; реальные данные и production
  AI не используются (`FakeAiProvider`/контракты, а не вызовы модели).
- «Нарушенное evidence rule → красный тест»: каждый AI-contract тест содержит негативную
  проверку (например, 6 гипотез отклоняется, `independence_assessment: "made_up"`
  отклоняется, гипотеза без disconfirming questions отклоняется, medical causality
  блокируется) — намеренно сломанное правило даёт `success === false`.
