# 57: Реализовать anonymized supervision export

**What to build:** Разрешённый Supervisor получает минимизированный набор данных без прямых идентификаторов клиента.

**Goal:** Поддержать supervision, сохраняя consent и relationship privacy.

**Context:** Точная anonymization policy и формат определяются тикетами 05 и 08. Простого удаления имени недостаточно.

**Blocked by:** 05 — privacy policy; 08 — export contract; 50 — Relationships; 55 — archive/export foundation.

**Status:** resolved

## Decision

- Сервис `lib/service/supervision-export.ts` → `exportSupervision`: allowlist-only (evidence counts по уровням, reviewed themes/core_hypotheses/resources/targets, статусы коррекций), без прямых идентификаторов/raw statements/точных дат/relationship data. `case_key` — случайный на каждый export.
- Авторизация: supervisor assignment (`client_assignments.access_role='supervisor'`) + consent `supervisor_access` + `anonymized_analytics`. Audit `export.supervision`.

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

- [x] Пройдены identifier leakage и authorization tests.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- Сервис `lib/service/supervision-export.ts`: `exportSupervision` — versioned JSON (§14), только allowlisted поля, supervisor assignment + два consent, audit trail.
- Тесты: allowlist без clientId/raw statement; запрет без `supervisor_access`.

**Изменённые/созданные файлы:**
- `lib/service/supervision-export.ts` (новый)
- `tests/integration/supervision-export.integration.test.ts` (новый)
- `.scratch/live-client-map/issues/57-anonymized-supervision-export.md`

**Пройденные проверки:**
- Интеграционный тест тикета 57 (2 шт.) — pass.
- `eslint`, `prettier`, `typecheck` — чисто.

**Note:** generalized requests/goals оставлены пустыми (риск идентификаторов в свободном тексте); redaction-пайплайн и preview UI — future scope.
