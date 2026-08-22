# 08: Утвердить форматы import и export

**What to build:** Зафиксировать точные внешние форматы данных и поведение при частичных ошибках.

**Goal:** Обеспечить переносимость данных без несовместимых форматов от разных agents.

**Context:** SPEC.md перечисляет plain text, CSV, JSON, Markdown, ChatGPT analysis и несколько exports, но не задаёт schemas, limits, encoding, report layout и error policy.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Concrete steps

1. Утвердить CSV columns, JSON schema и формат ChatGPT analysis.
2. Определить encoding, locale, size limits и duplicate handling.
3. Описать partial success, validation report и idempotent retry.
4. Утвердить состав JSON archive, Markdown/PDF report и anonymized export.
5. Явно оставить PDF/docx extraction future scope, если оно не входит в текущую реализацию.

## Acceptance criteria

- [x] Каждый текущий формат имеет versioned schema или layout.
- [x] Определено поведение при invalid row, duplicate и interrupted import.
- [x] Exports учитывают visibility, consent и anonymization.
- [x] Решение одобрено владельцем проекта.

## Checks

- [x] Round-trip expectations определены там, где они обязательны.
- [x] Тикеты 53–57 могут быть реализованы без догадок о формате.

## Resolution

Решение одобрено владельцем проекта 2026-08-22.

- Канонический contract suite: `docs/data-exchange-contracts.md`.
- Import v1: plain text, Markdown, canonical ChatGPT analysis, Signals CSV и Signals JSON; UTF-8, максимум 10 MiB и 50 000 structured records.
- Каждый принятый import создаёт DiagnosticSession, проходит AI parsing и явный human review; imported conclusions не являются confirmed evidence.
- Partial success разрешён только в staging. Commit выбранных records атомарен; invalid и duplicate records имеют typed validation report.
- Retry идемпотентен по organization, client, contract version и idempotency key; exact duplicate определяется по source checksum и external ID.
- Export v1: full client JSON archive, Signals CSV, общий Markdown/PDF snapshot report и JSON supervision export.
- Visibility, assignments, consent, relationship privacy, audit и 30-дневный retention export-файлов обязательны.
- Supervision export использует закрытую allowlist, random per-export case key и исключает direct identifiers, exact events, raw statements и relationship data.
- Full JSON archive lossless для разрешённого portable read model; CSV — только semantic Signal portability; reports и supervision export не round-trip formats.
- PDF/DOCX extraction, OCR и privileged archive restore явно оставлены вне v1.
