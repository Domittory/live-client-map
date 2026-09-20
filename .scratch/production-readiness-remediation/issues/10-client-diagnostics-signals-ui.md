# 10: Добавить client-scoped DiagnosticSessions и Signals

**What to build:** Позволить Specialist создавать и просматривать DiagnosticSessions и Signals в client workspace, включая source lineage, review state, Evidence Trail и явное отсутствие достаточных данных.

**Blocked by:** 05/Сделать intake, review и import мутации атомарными; 09/Создать client workspace с access management.

**Status:** resolved

- [x] Specialist создаёт DiagnosticSession и добавляет Signals через браузер без database helpers.
- [x] UI показывает source, epistemic type, review status, evidence level и lineage каждого Signal.
- [x] Pending evidence нельзя принять или отклонить без явного user action и reason там, где он обязателен.
- [x] Пустое или недостаточное evidence отображается как «недостаточно данных», а не как conclusion.
- [x] Browser-to-database tests проверяют persisted state, audit evidence и RLS denial.

## Implementation result

### Что реализовано

**1. Экран `/clients/[id]/diagnostics` (замена заглушки тикета 09)**

- Серверная страница `app/clients/[id]/diagnostics/page.tsx`: тот же guard `requireClientWorkspace` + правило раздела `canUseSection(access, "diagnostics")`, что и в остальном workspace. Client id приходит из маршрута; ручного ввода `client_id` нет.
- Список существующих DiagnosticSessions с их сигналами и отдельный список сигналов без сессии. Для каждой сессии показаны тип, ревью-статус, статус AI, дата создания, исходные данные и заметки.
- Две формы (клиентские компоненты `diagnostics-forms.tsx`): «Новая диагностическая сессия» (название, тип сессии, raw input, заметки) и «Новый сигнал» (source type, epistemic type, raw statement, polarity, test result, normalized meaning, intensity, confidence, life areas, tags, visibility). Все мутации — формы на Server Actions, никаких database helpers в браузере.

**2. Каждый Signal показывает provenance**

Строка сигнала выводит: источник, эпистемический тип, статус ревью, уровень доказательности (L0…L7 с человекочитаемой расшифровкой), видимость, lineage («сессия "…" (тип)» либо «без сессии»), дату фиксации, формулировку, результат теста, интенсивность, уверенность, сферы жизни и теги. Enum-значения переводятся через единый словарь `lib/service/diagnostics-presentation.ts`; неизвестное значение рендерится как нейтральное «Неизвестное значение», а не как сырой токен БД.

**3. Ревью — только явное действие человека**

- У каждого сигнала своя форма ревью (`review_signal` через Server Action): действие выбирается пользователем, причина пишется в audit-строку. Для действий, убирающих evidence (`reject`, `hide`), причина обязательна: Server Action возвращает ошибку «Для отклонения или скрытия сигнала укажите причину», а причина из формы уходит в `p_reason` и сохраняется в `audit_log.reason`.
- Pending evidence не промотируется само: пока `review_status = 'pending'`, значение сигнала показывается как «недостаточно данных». Ручной сигнал, созданный специалистом через интерфейс, в БД остаётся `approved` (правило RPC `create_signal`, SPEC §36: человеческий ввод подтверждён человеком) — это не менялось.

**4. «Недостаточно данных» вместо вывода**

Правило `signalReadiness()` (`lib/service/diagnostics-presentation.ts`) возвращает интерпретацию только если: есть непустое `raw_statement`, сигнал не AI-only (`L0_AI_ONLY` / `source_type = ai_hypothesis`), ревью не `pending`/`rejected` и есть `normalized_meaning`. Во всех остальных случаях в слоте значения стоит «недостаточно данных» с причиной. Пустая сессия, пустой raw input и отсутствие сигналов тоже подписаны как «недостаточно данных». UI не додумывает выводы.

**5. Authorization остаётся в БД**

- Guard и RLS не менялись; новых миграций нет.
- Право записи проверяется для рендера: формы сессии/сигнала и контролы ревью показываются только при `access.canWrite`; read-only/supervisor видит нейтральную подсказку и не видит недоступных контролов.
- Любая мутация всё равно идёт через guarded atomic RPC (`create_diagnostic_session`, `create_signal`, `review_signal`) — UI не является единственным гейтом. Server Action дополнительно проверяет, что сигнал принадлежит клиенту из маршрута.

**6. Слой сервисов**

- `lib/service/diagnostics.ts`: добавлен read model `getDiagnosticsReadModel(client, { organizationId, clientId })` — сессии с вложенными сигналами, сигналы без сессии и `Map` lineage (типы `DiagnosticSessionWithSignals`, `DiagnosticSignalWithLineage`). Существующие `createSession`, `createSignal`, `listSignals`, схемы и константы не изменены — публичные контракты сохранены.
- `lib/service/diagnostics-presentation.ts` (новый): русские словари и правило `signalReadiness`, `reasonRequired`, `labelFor`. Чистая логика без БД и React, поэтому покрыта unit-тестами.

### Файлы

Добавлены: `app/clients/[id]/diagnostics/diagnostics-forms.tsx`, `app/actions/diagnostics.ts`, `lib/service/diagnostics-presentation.ts`, `e2e/diagnostics.spec.ts`, `tests/unit/diagnostics-labels.unit.test.ts`, `tests/integration/diagnostics-read-model.integration.test.ts`.

Изменены: `app/clients/[id]/diagnostics/page.tsx` (заглушка → реальный экран), `lib/service/diagnostics.ts`, `app/globals.css`, `e2e/client-workspace.spec.ts` (проверка заглушки диагностики заменена на проверку реального экрана), `e2e/support/fixtures.ts` (`serviceRoleClient()`, `userClient()` для browser-to-database проверок).

### Проверки

- `pnpm typecheck` — успешно.
- `pnpm lint` — успешно (`eslint .` без замечаний, `prettier --check .` — «All matched files use Prettier code style»).
- `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` — **90 files / 618 tests passed** (было 88/604; +2 файла: unit-тесты правила «недостаточно данных» и integration-тесты read model с lineage и RLS-пустотой для непривязанного участника).
- `pnpm test:e2e` — **11 passed (23.7s)** на изолированном dev-сервере из тикета 02:
  - `e2e/diagnostics.spec.ts` › specialist creates a session and a signal through the browser and both persist with audit rows (persisted state + `session.created`/`signal.created` в `audit_log` с actor'ом)
  - `e2e/diagnostics.spec.ts` › pending AI evidence is shown as insufficient data and only an explicit review with a reason changes it (отказ без причины, затем approve с причиной; audit `review.approve` с before/after и reason)
  - `e2e/diagnostics.spec.ts` › an unassigned member gets the neutral denial and the database denies the write (404 + пустой RLS-чтение + отказ `42501` на insert и RPC)
  - `e2e/diagnostics.spec.ts` › a read-only supervisor sees diagnostics without write controls (чтение есть, форм и контролов ревью нет, RPC-запись отклонена)
  - `e2e/client-workspace.spec.ts` — 5 прежних тестов зелёные (один обновлён под реальный экран диагностики)
  - `e2e/health.spec.ts` — 2 прежних теста зелёные

### Решения и что стоит проверить

1. **Причина обязательна для `reject` и `hide`** (не для `approve`/`mark_sensitive`). База причину не требует (RPC подставляет «signal <action>»), поэтому правило живёт в Server Action. Владельцу стоит подтвердить набор действий: если причина нужна и для подтверждения — это одна строка в `REASON_REQUIRED_ACTIONS`.
2. **Причина ревью не читается обратно в UI.** `audit_log` по RLS читает только Owner организации, поэтому специалист видит только новый review-статус, а причина остаётся в audit-строке (её проверяет e2e через service role). Чтобы показывать историю ревью специалисту, нужен отдельный guarded read-RPC — это отдельный тикет.
3. **Ручной сигнал создаётся `approved`** (поведение RPC `create_signal`, ticket 05). UI это честно подписывает: «Сигнал, добавленный специалистом через интерфейс, считается подтверждённым человеком. AI-импорт создаёт сигналы только со статусом "ожидает ревью"». Если продукт хочет, чтобы и ручной ввод попадал в pending-очередь ревью, это изменение контракта RPC — вне scope тикета.
4. **Раздел «Диагностика» доступен для чтения всем назначенным ролям** (`requires: "read"` в `CLIENT_SECTIONS`), а запись/ревью — только `canWrite`. Read-only роль не теряет доступ к evidence, но и не получает недоступных контролов.
5. **Проверка принадлежности сигнала клиенту** в Server Action использует RLS-чтение `signals` по `client_id`; это defense in depth поверх `review_signal`, который сам проверяет `is_client_accessible(..., true)`.

## Ревью ведущего

- **Авторизация не ослаблена**: новых миграций и RPC нет; read-model
  (`getDiagnosticsReadModel`) читает `diagnostic_sessions`/`signals` клиентом
  пользователя, то есть под RLS, и валидирует uuid. Write-контролы рендерятся
  только при `access.canWrite`.
- **Прогоны**: полный набор 90 файлов / 618 тестов — 4 прогона подряд зелёные
  (один единичный сбой в самом первом прогоне не воспроизвёлся; в логах БД в этот
  момент только ожидаемые отказы тестов, без deadlock/serialization — см. риск
  ниже); `pnpm test:e2e` — **11 тестов** (4 новых диагностических + 5 workspace +
  2 health); `pnpm typecheck`, `pnpm lint` — зелёные.
- **Риск для тикета 23 (reproducible release gate)**: при полном параллельном
  прогоне 90 integration-файлов один раз наблюдался сбой `beforeAll` (создание
  клиента под нагрузкой), который не воспроизводится. Release gate должен убрать
  эту недетерминированность: либо ограничить параллелизм integration-наборов
  (например, `fileParallelism: false` или меньший `maxThreads`), либо явно
  ретраить инфраструктурные сбои. Нельзя считать флейк «нормальным» — гейт
  обязан быть воспроизводимым.
