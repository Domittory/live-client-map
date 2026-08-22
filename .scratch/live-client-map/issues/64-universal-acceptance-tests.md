# 64: Создать универсальный acceptance test pack

**What to build:** Автоматический набор доказывает интеллектуальную корректность на трёх разных seed profiles.

**Goal:** Не позволить системе выучить одну заранее заданную теорию или нарушить ключевые evidence boundaries.

**Context:** Использовать Client A, B и C и обязательные кейсы разделов 51–57 SPEC.md.

**Blocked by:** 20–28 — diagnostic/model foundation; 33–37 — AI/recommendations; 41–44 — evaluation/snapshots; 50 — relationships; 59 — safety; 60 — RLS.

**Status:** ready-for-agent

## Concrete steps

1. Создать три универсальных seed profiles без hardcoded product behavior.
2. Автоматизировать positive-stress, evidence independence и multi-context cases.
3. Автоматизировать competing hypotheses, contradiction и insufficient-data cases.
4. Автоматизировать resource independence, integration и medical boundary cases.
5. Подключить pack к обязательному CI release gate.

## Acceptance criteria

- [ ] Все criteria 51.1–51.9 имеют явный automated test.
- [ ] Cases 52–56 проходят для deterministic и AI-contract paths.
- [ ] Seeds покрывают leadership, relationships и workaholism profiles.
- [ ] Ни один тест не требует production AI или real client data.

## Checks

- [ ] Acceptance pack воспроизводимо проходит на clean test database.
- [ ] Намеренно нарушенное evidence rule делает соответствующий тест красным.
