# 57: Реализовать anonymized supervision export

**What to build:** Разрешённый Supervisor получает минимизированный набор данных без прямых идентификаторов клиента.

**Goal:** Поддержать supervision, сохраняя consent и relationship privacy.

**Context:** Точная anonymization policy и формат определяются тикетами 05 и 08. Простого удаления имени недостаточно.

**Blocked by:** 05 — privacy policy; 08 — export contract; 50 — Relationships; 55 — archive/export foundation.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать approved field allowlist и pseudonymization.
2. Исключить direct и утверждённые indirect identifiers.
3. Проверять supervisor assignment и active consent.
4. Добавить export preview, confirmation и AuditLog.
5. Покрыть re-identification-risk fixtures и revoke cases.

## Acceptance criteria

- [ ] Export содержит только allowlisted supervision fields.
- [ ] Direct identifiers и private relationship data отсутствуют.
- [ ] Без active supervisor_access consent export запрещён.
- [ ] Каждый export трассируется в AuditLog.

## Checks

- [ ] Пройдены identifier leakage и authorization tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
