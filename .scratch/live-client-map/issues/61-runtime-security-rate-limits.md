# 61: Добавить rate limiting и runtime security

**What to build:** Public и authenticated operations защищены от abuse, утечки secrets и небезопасных ошибок.

**Goal:** Закрыть runtime attack surface перед production.

**Context:** Особое внимание AI, import/export, auth и sensitive-data endpoints. Secrets разрешены только server-side.

**Blocked by:** 05 — privacy policy; 07 — AI contracts; 32 — AI gateway; 53–54 — imports; 59 — safety; 60 — RLS audit.

**Status:** ready-for-agent

## Concrete steps

1. Применить утверждённые rate limits по actor, tenant и operation cost.
2. Проверить server-side secret management и environment separation.
3. Добавить safe error mapping без sensitive payload.
4. Защитить uploads, downloads, retries и expensive AI operations.
5. Добавить abuse, bypass и secret-scanning tests.

## Acceptance criteria

- [ ] Rate limits действуют на критичные operations и возвращают безопасный response.
- [ ] Provider/service secrets отсутствуют в client bundles и logs.
- [ ] Ошибки не раскрывают private data, SQL или prompts.
- [ ] Trusted internal jobs имеют явно ограниченный bypass.

## Checks

- [ ] Пройдены burst, cross-tenant, upload abuse и secret leakage tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
