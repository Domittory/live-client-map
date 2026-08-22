# 07: Выбрать AI-платформу и контракты функций

**What to build:** Утвердить provider, модели и строгие input/output contracts для каждой AI-функции.

**Goal:** Сделать AI-слой проверяемым, заменяемым и безопасным для чувствительных данных.

**Context:** SPEC.md запрещает mega-prompt и требует strict JSON, но не выбирает provider, region, модели и полные схемы большинства функций.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Concrete steps

1. Выбрать AI provider, модели, data region и no-training guarantees.
2. Определить input/output JSON schema каждой функции из раздела 27.
3. Описать timeouts, retries, idempotency, rate limits и failure states.
4. Утвердить redaction, sensitive-case handling и human-review boundary.
5. Определить prompt, model и contract versioning.

## Acceptance criteria

- [x] Каждая AI-функция имеет отдельный versioned contract.
- [x] Unknown fields, invalid enums и scores вне 0–100 отклоняются.
- [x] Никакой AI output не становится confirmed без human review.
- [x] Решение одобрено ответственным человеком.

## Checks

- [x] Provider policy совместима с privacy policy и запретом обучения на данных.
- [x] Тикет 32 может реализовать gateway без выбора продуктовых правил.

## Resolution

Решение одобрено владельцем проекта 2026-08-22.

- Канонический provider и function contract: docs/ai-contracts.md.
- Для development/test используется OpenAI Responses API.
- Единственная модель: gpt-5.5, pinned snapshot gpt-5.5-2026-04-23.
- Reasoning configuration: effort = high.
- Provider persistence: store = false; вызовы stateless.
- В OpenAI разрешены только synthetic или irreversibly de-identified данные.
- Production AI выключен до отдельного решения о provider, data region, retention и трансграничной обработке.
- Все функции имеют отдельные strict versioned JSON contracts, typed failures, idempotency, bounded retries, redaction и human-review boundary.
- Provider подключается через adapter; смена OpenAI на Yandex AI Studio не меняет domain services и contracts.
