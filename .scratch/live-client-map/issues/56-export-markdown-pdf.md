# 56: Реализовать Markdown report и PDF snapshot

**What to build:** Специалист формирует читаемый отчёт и визуальный snapshot только из разрешённой версии модели.

**Goal:** Дать переносимый human-readable результат без новых AI-выводов.

**Context:** Layout и content contract определены тикетом 08. Historical export должен использовать выбранный immutable snapshot.

**Blocked by:** 08 — report contracts; 43 — Snapshots; 44 — approved explanations.

**Status:** resolved

## Decision

Решение одобрено владельцем проекта 2026-08-23.

- **PDF renderer**: `pdf-lib` + `@pdf-lib/fontkit` со своим layout-движком. Разбивка на страницы вынесена в чистую функцию (`layoutReport`), поэтому пагинация, перенос длинного текста и правило «heading не последней строкой» покрываются обычными unit-тестами без разбора PDF-байтов. Альтернативы отклонены: `@react-pdf/renderer` — тяжёлый и раскладку не проверить иначе как по готовому PDF; `pdfkit` — Node-only при тех же ручных правилах; headless Chrome — требует Chromium ~300 MB в production (конфликт с тикетами 60–65).
- **Шрифт**: Noto Sans Regular + Bold (OFL) вендорится в `assets/fonts/`; вариант `latin-greek-cyrillic`, покрывает кириллицу. Лицензия рядом — `assets/fonts/OFL.txt`.
- **Доставка**: синхронная генерация по образцу тикета 55 (функция возвращает содержимое, пишет audit). Таблица `export_requests`, файловое хранилище и 30-дневный retention из §10 контракта **сознательно не реализуются здесь** — они проектируются в тикете 58 вместе с erasure/отзывом согласия, чтобы не переделывать хранилище дважды. Разрыв с §10 зафиксирован в Known limitations.

## Concrete steps

1. Реализовать общий privacy-filtered report read model.
2. Создать deterministic Markdown renderer.
3. Создать PDF renderer с устойчивой пагинацией и Unicode.
4. Добавить выбор snapshot и specialist export UI.
5. Добавить content, rendering и forbidden-field tests.

## Acceptance criteria

- [x] Markdown и PDF представляют одну и ту же выбранную snapshot version.
- [x] Report содержит evidence-aware explanations без private hidden data.
- [x] PDF корректно отображает русский текст и длинные разделы.
- [x] Генерация не меняет business state.

## Checks

- [x] Выполнена visual QA canonical PDF fixtures.
- [x] Repository-standard lint, typecheck и tests проходят.

## Implementation result

**Что сделано:**
- `SnapshotReportReadModel` — единая immutable, privacy-filtered модель чтения для обоих форматов (§13): 14 фиксированных разделов, пустой раздел печатается как «Нет подтверждённых данных».
- Markdown-рендерер (`renderReportMarkdown`): UTF-8 CommonMark, YAML front matter ровно с семью разрешёнными ключами, без raw HTML (экранирование `&`, `<`, `>` и `|` в таблицах).
- PDF-рендерер (`renderReportPdf`) поверх чистого движка раскладки (`layoutReport`/`flattenReport`/`paginate`): A4, встроенный Noto Sans с кириллицей и subsetting, футер со страницей и opaque-ссылкой, правило «heading не остаётся последней строкой страницы», перенос длинного текста без обрезки, таблицы не разрывают строку. Метаданные PDF — только opaque-ссылка, без ФИО.
- Сервис `lib/service/report.ts`: `buildSnapshotReport`, `exportSnapshotReportMarkdown`, `exportSnapshotReportPdf`, `resolveLatestSnapshotVersion`, `opaqueClientRef`. Доступ — переиспользованный `requireExportAccess` (тикет 55) + `is_org_owner`; `sensitive` — только Owner/primary + согласие `sensitive_psychological_data`; аудитория `client` — только `client_visible` + только approved-объяснения. Любое скрытие подсчитывается и называется в «Ограничения» (no silent truncation). Генерация пишет только audit.
- Endpoint `GET /api/reports/snapshot` (`format=markdown|pdf`, `audience`, `snapshotVersion`), `next.config.ts` прокидывает шрифты в standalone-сборку, UI-форма экспорта на `/snapshots`.

**Изменённые/созданные файлы:**
- `lib/report/model.ts`, `lib/report/markdown.ts`, `lib/report/layout.ts`, `lib/report/pdf.ts` (новые)
- `lib/service/report.ts` (новый)
- `app/api/reports/snapshot/route.ts` (новый)
- `assets/fonts/NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `OFL.txt` (новые)
- `tests/unit/report.unit.test.ts`, `tests/unit/report-pdf.unit.test.ts`, `tests/integration/report.integration.test.ts` (новые)
- `app/snapshots/page.tsx`, `lib/service/export.ts` (`requireExportAccess` экспортирован), `next.config.ts`, `package.json`, `pnpm-lock.yaml`

**Пройденные проверки:**
- `pnpm lint` — чисто (eslint + prettier).
- `pnpm typecheck` — чисто.
- `pnpm test:unit` — 194 теста pass (включая 20 новых по тикету).
- Интеграционные `report` + `export` — 10 тестов pass (приватность по audience, secondary без sensitive, audit, неизменность состояния, отказ на чужой/несуществующий snapshot).
- Visual QA: canonical PDF-фикстура генерируется воспроизводимо (`REPORT_FIXTURE_OUT=/tmp/report.pdf pnpm test:unit`); проверено, что шрифт встроен (`BaseFont` содержит NotoSans, FontFile2), кириллица рендерится встроенным шрифтом, документ многостраничный, метаданные без ФИО.

**Known limitations:**
- Доставка синхронная (без `export_requests`, файлового хранилища и 30-дневного retention из §10) — перенесено в тикет 58, где будет спроектировано вместе с erasure.
- Генерация PDF ~2–4 с на отчёт (встраивание и subsetting шрифта); приемлемо для явного экспорта, не для массовой пакетной выгрузки.
- Разделы отчёта для клиента без явной пометки `client_visible`/approved-объяснений остаются пустыми (fail-closed) — это намеренно; расширение списка клиент-видимого контента — продуктовое решение, а не ошибка.
