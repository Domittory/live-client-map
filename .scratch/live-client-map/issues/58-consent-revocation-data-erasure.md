# 58: Реализовать отзыв consent и полное data erasure

**What to build:** Ответственный пользователь отзывает согласие или запускает удаление клиента, а система исполняет утверждённую policy во всех хранилищах.

**Goal:** Реализовать право на прекращение обработки и hard delete без нарушения обязательных retention rules.

**Context:** Это end-to-end workflow поверх всех созданных business entities, exports, portal data, audit и backups.

**Blocked by:** 05 — privacy policy; 13 — consent; 14 — AuditLog; 17 — Client; 43 — Snapshots; 50–57 — relationship, portal и exchange.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать impact preview и authorization для revoke/erasure request.
2. Остановить запрещённые AI, portal, relationship и export operations.
3. Выполнить delete/anonymize/retain actions по policy для всех entities.
4. Обработать exports, jobs, caches и backup tombstones.
5. Добавить progress, failure recovery, audit и exhaustive tests.

## Acceptance criteria

- [ ] После revoke новые операции соответствующего scope запрещены.
- [ ] Erasure охватывает все business tables и производные данные.
- [ ] Legally retained records минимизированы и объяснены.
- [ ] Повторный запуск безопасен и продолжает незавершённую операцию.

## Checks

- [ ] Пройден seeded-client erasure audit по всем entity types.
- [ ] Repository-standard lint, typecheck и tests проходят.
