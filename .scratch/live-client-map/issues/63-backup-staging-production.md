# 63: Настроить backup/restore, staging и production deployment

**What to build:** Приложение воспроизводимо развёртывается, данные резервируются, а восстановление регулярно проверяется.

**Goal:** Завершить operational production foundation.

**Context:** Environments и providers определены тикетом 01; backup retention и erasure behavior — тикетом 05.

**Blocked by:** 01 — deployment decision; 05 — retention; 58 — erasure; 60 — RLS; 61 — runtime security; 62 — monitoring.

**Status:** ready-for-agent

## Concrete steps

1. Создать reproducible staging и production deployment pipelines.
2. Настроить encrypted backups и documented restore procedure.
3. Обеспечить environment-specific secrets, migrations и approvals.
4. Проверить backup handling для erasure tombstones и retention.
5. Провести restore drill и post-deploy smoke tests.

## Acceptance criteria

- [ ] Staging и production создаются согласованным pipeline.
- [ ] Backup encrypted и доступен только разрешённой роли.
- [ ] Restore drill восстанавливает консистентную систему в целевой RTO/RPO.
- [ ] Deployment failure не оставляет частично применённый production release.

## Checks

- [ ] Выполнены staging deployment, backup restore и rollback drills.
- [ ] Production smoke checklist проходит без использования реальных клиентских данных.
