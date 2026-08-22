# 32: Создать безопасный AI gateway

**What to build:** Все AI-вызовы проходят через единый server-side gateway со strict schemas, privacy controls, versioning и audit.

**Goal:** Не допустить прямых model calls из UI и разрозненных mega-prompts.

**Context:** Реализация следует решениям 05 и 07. Secrets остаются server-side; invalid output не попадает в business tables.

**Blocked by:** 07 — AI contracts; 10 — API foundation; 13 — consent gates; 14 — AuditLog.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать provider adapter и отдельный contract для каждой AI function.
2. Добавить consent check, redaction, schema validation и unknown-field rejection.
3. Реализовать timeout, retry, idempotency и structured failure states.
4. Сохранять model, prompt, schema versions и безопасную telemetry.
5. Добавить fake provider и contract/integration tests.

## Acceptance criteria

- [ ] UI никогда не получает provider secret.
- [ ] Invalid JSON, enum или score отклоняется до business mutation.
- [ ] Каждый вызов связан с consent, actor и version metadata.
- [ ] AI failure не оставляет partially confirmed entities.

## Checks

- [ ] Пройдены malformed output, timeout, retry и no-consent tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
