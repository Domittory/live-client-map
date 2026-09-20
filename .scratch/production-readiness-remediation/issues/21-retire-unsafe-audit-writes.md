# 21: Удалить небезопасные mutation-then-audit пути

**What to build:** Завершить contract-фазу атомарного refactor: инвентаризировать все production writes, удалить оставшиеся небезопасные compound paths и зафиксировать проверяемую политику допустимых single-statement исключений.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными; 05/Сделать intake, review и import мутации атомарными; 06/Сделать мутации психологической модели атомарными; 07/Сделать Corrections, observations и model history атомарными; 08/Сделать privileged и erasure flows атомарными; 15/Завершить Client Portal authentication и published view; 16/Завершить Client Portal feedback; 19/Ввести асинхронное создание ExportRequest; 20/Защитить download и автоматизировать 30-дневный expiry.

**Status:** resolved

- [x] Ни одна compound business mutation не коммитит domain state отдельно от обязательных child rows, ModelChange или AuditLog.
- [x] Оставшиеся direct single-statement writes перечислены и доказуемо не могут оставить unaudited committed state.
- [x] Automated check или reviewable inventory предотвращает повторное появление unsafe mutation-then-audit patterns.
- [x] RPC permissions, fixed search paths, tenant/assignment/consent checks и actor attribution повторно проверены.
- [x] Generated database types обновлены, а service row contracts остаются локальными и проходят schema verification.
- [x] Полный fault-injection suite подтверждает rollback при intermediate и AuditLog failures.

## Implementation result

### Что сделано

1. **Инвентаризация** — `docs/audit-write-inventory.md`: перечислен каждый production-путь,
   добавляющий запись AuditLog, с вердиктом. Компаундные мутации (миграции 0007, 0039–0053) —
   атомарные RPC. Read-only пути (`exportSignalsCsv`, `exportClientArchive`, `exportSupervision`,
   `auditReport`) — разрешённое исключение: они не пишут domain-состояние вообще, поэтому сбой
   аудита не может оставить unaudited committed state. Оставшиеся прямые одиночные записи
   (`sendFeedbackForm`, `createTriggerActivation`) документированы: один statement, нет дочерних
   строк, аудит продуктовым контрактом не предусмотрен.

2. **Миграция `0053_atomic_life_events_relationships_requests.sql`** — последние пять
   mutation-then-audit пар переведены в атомарные RPC по конвенции 0039–0052: `create_life_event`,
   `create_trigger`, `create_relationship`, `create_relationship_dynamic`,
   `create_client_request`, `change_request_status`, `create_client_goal`, `change_goal_status`
   (+ внутренние `relationship_visible_evidence_refs`, `request_status_transition_allowed`,
   `goal_status_transition_allowed`, которые не выданы ролям клиента). Актор — из `auth.uid()`,
   tenant/assignment/consent проверяются внутри транзакции, аудит идёт через `append_audit`.
   Осознанное ужесточение: `create_relationship_dynamic` теперь **отклоняет** приватные
   evidence-ссылки (22023) вместо молчаливого вырезания — молчаливый strip мог проскочить при
   конкурентной переклассификации сигнала. `withAudit` удалён: после миграции его не использует
   ни один файл (`grep` + guard).

3. **Guard против реинтродукции** — `scripts/check-unsafe-audit-writes.mjs` парсит
   `lib/service/*.ts` через TypeScript AST и валит сборку, если `recordAudit(`/`withAudit(`
   появился вне задокументированного allowlist или если domain-запись идёт **до** аудита.
   Запускается в `pnpm lint`-контуре через `pnpm audit:writes`, в `pnpm test:unit`
   (`tests/unit/audit-write-guard.unit.test.ts`, второй кейс доказывает, что guard реально
   детектит нарушение) и отдельным шагом CI (`quality`). Политика описана в
   `docs/development.md` § «Аудит и атомарность мутаций».

4. **Типы БД** — `pnpm db:types` перегенерировал `lib/supabase/database.types.ts` (3578 → 4518
   строк): добавлены `clients.legal_hold`, `erasure_requests`, `export_requests`, enum-типы
   `export_*`, все RPC с 0037. Локальные row-контракты сервисов остались локальными
   (компилятор проверяет их во время `pnpm typecheck`; `as any` не добавлялся — регенерация не
   вызвала ни одной ошибки типов). Дрейф виден через `pnpm db:types:check`,
   `scripts/db-types-check.mjs` и тест `tests/integration/schema-verification.integration.test.ts`.

5. **Права/`search_path`** — `scripts/check-rpc-permissions.mjs` (`pnpm audit:rpc-permissions`)
   проверяет: EXECUTE у `anon` только для документированного allowlist (RLS-хелперы + liveness +
   trigger-функции), каждая SECURITY DEFINER функция пинует `search_path`, внутренние helper'ы не
   выданы `authenticated`, RPC 0053 существуют и доступны `authenticated`. Прогон: 140 функций,
   0 находок. В CI добавлен шаг в job `integration`; в тестах —
   `collectFindings()` внутри `schema-verification.integration.test.ts`.

6. **Fault-injection** — `tests/integration/atomic-ticket21-mutations.integration.test.ts` (11
   тестов): для каждой из 8 новых мутаций проверяется rollback и при сбое domain/child-записи, и
   при сбое AuditLog (отдельно для create и для status transition). `supabase/seed.sql` получил
   fault-триггеры на `life_events`, `triggers`, `relationships`, `relationship_dynamics`,
   `client_requests`, `client_goals`; в CI добавлен `supabase db reset`, потому что без сида
   fault-injection suite молча скипался (`supabase start` сид не применяет).

### Файлы

- `supabase/migrations/0053_atomic_life_events_relationships_requests.sql` (новый)
- `supabase/seed.sql` — fault-триггеры для шести таблиц
- `lib/service/life-events.ts`, `lib/service/relationships.ts`, `lib/service/requests.ts` —
  через `runAtomicRpc`, без `recordAudit`
- `lib/service/audit.ts` — `withAudit` удалён, добавлен комментарий-политика
- `lib/supabase/database.types.ts` — регенерация
- `scripts/check-unsafe-audit-writes.mjs`, `scripts/check-rpc-permissions.mjs`,
  `scripts/db-types-check.mjs` (новые)
- `tests/unit/audit-write-guard.unit.test.ts`,
  `tests/integration/atomic-ticket21-mutations.integration.test.ts`,
  `tests/integration/schema-verification.integration.test.ts` (новые)
- `tests/integration/relationships.integration.test.ts` — приватная evidence-ссылка теперь
  отклоняется, а не вырезается
- `docs/audit-write-inventory.md` (новый), `docs/development.md`
- `package.json`, `.github/workflows/ci.yml`

### Проверки

| Команда | Результат |
| ------- | --------- |
| `pnpm exec vitest run tests/unit tests/smoke tests/acceptance tests/integration` | 110 файлов / 852 теста — green |
| `pnpm typecheck` | green |
| `pnpm typecheck:scripts` | green |
| `pnpm lint` | green (ESLint + Prettier) |
| `pnpm test:e2e` | 41 тест — green |
| `pnpm audit:writes` | 0 нарушений |
| `pnpm audit:rpc-permissions` | 140 функций, 0 находок |
| `pnpm db:types:check` | типы совпадают со схемой |
| `supabase db reset` | миграции 0001–0053 + seed применяются без ошибок |

### Замечания для ревью

- Прямые PostgREST-записи в 45 таблиц всё ещё разрешены RLS-политиками (`authenticated`).
  Сужать эту поверхность в тикете 21 нельзя (это изменение авторизации), поэтому в
  инвентаризации она зафиксирована отдельным пунктом как открытый вопрос политики доступа.
- `create_relationship_dynamic` изменил контракт в сторону fail-closed: приватная evidence-ссылка
  теперь ошибка, а не silent strip. Тест обновлён; если продукт ожидал старое поведение —
  это решение нужно подтвердить.
- `sendFeedbackForm` остаётся чтением-проверкой + одиночным `UPDATE` без аудита; аудита для
  `feedback_form.send` нет и в продуктовом контракте. Если он нужен — это отдельный тикет.

## Ревью ведущего

- **Сторож проверен «в бою»**: я временно добавил в сервис функцию с паттерном
  «сначала запись в таблицу, потом `recordAudit`» — `pnpm audit:writes` упал с
  внятным сообщением (`mutation-then-audit ... move the write and the append into
  one atomic RPC`) и кодом 1; после отката снова 0 нарушений. То есть защита от
  повторного появления небезопасного паттерна реально работает, а не только
  задекларирована.
- **Дрейф типов БД закрыт** (я находил его ещё в тикете 01): `database.types.ts`
  регенерирован с локальной схемы, появились `clients.legal_hold`,
  `erasure_requests`, `export_requests` и RPC после 0037. `pnpm db:types:check`
  сравнивает закоммиченный файл со свежей генерацией и проходит; service row
  contracts остались локальными, `as any` не добавлялись, typecheck зелёный.
- **Инвентаризация и политика зафиксированы** в `docs/audit-write-inventory.md`:
  мигрировано 8 RPC (life events, triggers, relationships, requests, goals),
  `withAudit` удалён как мёртвый, а четыре «read-only» исключения (export/report
  helpers) обоснованы тем, что файл не содержит ни одной записи в таблицы — аудит
  там единственная запись, поэтому частичного состояния быть не может.
- **Автоматические проверки** (все зелёные): `pnpm audit:writes` (TS-AST-скан),
  `pnpm audit:rpc-permissions` (140 функций, 8 anon-исключений, 0 находок —
  проверяет `search_path` у каждой SECURITY DEFINER функции и что внутренние
  помощники не выданы `authenticated`), `pnpm db:types:check`. Они подключены в CI.
- **CI улучшен**: в integration-job добавлен `supabase db reset` перед прогоном —
  гейт теперь стартует с чистой БД с seed (детерминированность; важно для тикета 23).
- **Прогоны**: полный набор 110 файлов / 852 теста — зелёный; `pnpm test:e2e` —
  41 тест; `pnpm typecheck`, `pnpm typecheck:scripts`, `pnpm lint` — зелёные.
- **Открытые вопросы, которые агент правильно не стал менять молча**: (1) RLS всё
  ещё разрешает `authenticated` прямые INSERT/UPDATE на 45 таблиц — сужение было бы
  изменением авторизационной модели и требует вашего решения; (2)
  `sendFeedbackForm` — одиночный UPDATE без аудита (по контракту такого события и
  не было); (3) `create_relationship_dynamic` теперь отклоняет приватные
  `evidence_refs` вместо тихого вырезания (гонка чтения/записи устранена).
