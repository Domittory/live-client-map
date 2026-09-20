# 16: Завершить Client Portal feedback

**What to build:** Завершить двусторонний feedback flow: Specialist создаёт и отправляет client-scoped форму, Client Portal User заполняет только свою форму, а ответ поступает Specialist как pending evidence.

**Blocked by:** 05/Сделать intake, review и import мутации атомарными; 15/Завершить Client Portal authentication и published view.

**Status:** resolved

- [x] Specialist создаёт, просматривает и отправляет feedback form из client workspace.
- [x] Portal User видит и отправляет только принадлежащую ему active, unexpired форму.
- [x] Submission атомарно завершает форму, создаёт pending self-report Signal и AuditLog.
- [x] Feedback не увеличивает authoritative evidence/confidence и не подтверждает AI hypothesis автоматически.
- [x] Browser tests покрывают successful submit, expired form, reuse, cross-client denial и consent revocation.

## Implementation result

### Что сделано

**Специалист (client workspace).** Добавлен раздел «Обратная связь» (`/clients/[id]/feedback`): ключ секции `feedback` (requires `write`) в `app/clients/[id]/workspace.ts`, страница с конструктором формы (название + произвольное число вопросов типа «Оценка 1–10 / Свободный ответ / Да-Нет» с флагом «обязательный») и списком существующих форм. Черновик отправляется отдельным действием на карточке формы; ответы заполненной формы показываются только для чтения. Создание/отправка идут через уже существующие `createFeedbackForm` и `sendFeedbackForm` (RLS + атомарный `create_feedback_form`), новых мутаций БД для специалиста не добавлено.

**Портал клиента.** На `/portal` (и на deep-link `/portal/[clientId]`) появился блок «Формы обратной связи». Portal User видит только свои active, unexpired формы и отправляет их через Server Action. `clientId` через границу портала не передаётся: единственный вход — `formId` + ответы, а субъекта определяет RPC.

**Миграция `0050_client_portal_feedback.sql`:**
* `list_client_portal_feedback_forms()` — guarded SECURITY DEFINER RPC в том же стиле, что и `get_client_portal_overview` (ticket 15): резолвит вызывающего через `portal_client_id()`, который заново проверяет и активный доступ, и согласие `client_portal`, и возвращает только формы со статусом `sent` и неистёкшим `expires_at` (title, questions, expires_at — без tenant- и staff-колонок). Любой другой вызывающий получает `42501` → сервис отдаёт тот же нейтральный результат, что и «нет форм».
* `submit_feedback_form` (замена версии из 0041) — тот же контракт, но: portal-identity теперь требует `has_consent(client_id, 'client_portal')` (отзыв согласия действует на следующую отправку), а audit-строка пишется через новый внутренний `append_feedback_audit`, потому что `append_audit` требует членства в организации, которого у portal identity нет — из-за этого прежняя версия откатывала **любую** отправку из портала.
* `append_feedback_audit(uuid, text, uuid, text, jsonb, jsonb, text)` — внутренний SECURITY DEFINER writer: штампует `auth.uid()`, EXECUTE отозван у public/anon/authenticated и не выдаётся обратно, поэтому доступен только из SECURITY DEFINER RPC.
* Политика `portal reads own forms` (0034) пересоздана с теми же ограничениями (live-согласие + неистёкший срок), чтобы базовая таблица не давала более широкое окно, чем RPC. RLS не ослаблялась.

**Атомарность и доказательность.** Логику submission не дублировали: сервис вызывает существующий `submit_feedback_form`, который в одной транзакции завершает форму, создаёт pending Signal (`source_type=follow_up`, `epistemic_type=self_report`, `evidence_level=L1_SINGLE_SIGNAL`, `review_status=pending`) и пишет AuditLog `feedback_form.submit`. Портал вызывает RPC напрямую, без предварительного чтения формы: единственный авторитет — сам RPC (portal identity + live-согласие + статус + срок + обязательные ответы), поэтому «чужая форма», «истёкшая» и «отозванный доступ» неразличимы. Feedback не подтверждает гипотезы, не поднимает evidence level и не меняет confidence — проверяется тестом.

**Авторизация остаётся в БД.** Portal identity не становится участником организации; сервисные чтения портала идут только через guarded RPC. Действия специалиста — через `requireClientWorkspace` + `canUseSection`, плюс RPC заново проверяет write-доступ.

### Файлы

* `supabase/migrations/0050_client_portal_feedback.sql` (новый)
* `lib/service/feedback-forms.ts` — добавлены `FEEDBACK_QUESTION_TYPES`, `FeedbackQuestion`, `FeedbackFormRow`, `PortalFeedbackForm`, `formatFeedbackAnswers`, `submitPortalFeedbackForm`, `listPortalFeedbackForms`; `listFeedbackForms` теперь возвращает статус/сроки/ответы, `getForm` читает только нужные колонки
* `app/actions/feedback.ts` (новый) — `createFeedbackFormAction`, `sendFeedbackFormAction`, `submitPortalFeedbackFormAction`
* `app/clients/[id]/workspace.ts` — секция `feedback`
* `app/clients/[id]/feedback/page.tsx`, `app/clients/[id]/feedback/feedback-forms.tsx` (новые)
* `app/portal/page.tsx`, `app/portal/[clientId]/page.tsx`, `app/portal/portal-view.tsx`, `app/portal/portal-feedback.tsx` (новый)
* `tests/unit/feedback-forms.unit.test.ts` (новый)
* `tests/integration/feedback-forms.integration.test.ts` — добавлен suite «Client portal feedback (ticket 16)»
* `e2e/feedback.spec.ts` (новый)

### Проверки

* `supabase db reset` (DOCKER_HOST Colima, локальная dev-БД) — миграция 0050 применилась без ошибок.
* `pnpm exec vitest run --no-file-parallelism tests/unit tests/smoke tests/acceptance tests/integration` — **100 файлов / 723 теста зелёные** (было 99/703; +11 unit, +9 integration). Полный прогон в дефолтном параллельном режиме на общей локальной БД даёт «плавающие» падения у чужих suite'ов (таймауты/лимиты auth при 4+ воркерах) — они воспроизводятся и без моих изменений и проходят в последовательном режиме.
* `pnpm test:e2e` — **35 тестов зелёные** (было 30; +5). Новые: successful submit из портала (с проверкой completed-формы, pending `self_report` сигнала L1 и audit `feedback_form.submit`), expired form, reuse (UI + прямой RPC), cross-client denial (UI + прямой RPC), отзыв согласия `client_portal` в UI с немедленной проверкой на следующем запросе. Полный параллельный прогон дал 35 passed. Промежуточные прогоны под нагрузкой давали «плавающие» падения у **существующих** тестов (`client-workspace` навигация, `portal` published view, `recommendations` purpose) — каждый из них по отдельности проходит стабильно, их файлы не менялись.
* `pnpm typecheck` — успешно; `pnpm lint` (eslint + prettier --check) — успешно, отформатированы только изменённые файлы.

### Замечания для ревью

1. **Найден и починен реальный баг вне ticket 15**: portal-отправка не работала вообще, потому что `submit_feedback_form` писал аудит через `append_audit`, требующий членства в организации. Это исправлено новым внутренним `append_feedback_audit` и подтверждено integration/e2e тестами.
2. `append_feedback_audit` — новое имя внутренней функции; EXECUTE не выдан ни одному клиентскому роли. Стоит подтвердить, что это соответствует выбранному соглашению об именах внутренних helper'ов.
3. Транзиентные сообщения об успехе («Форма создана…», «Форма отправлена…», «Спасибо! Ответы отправлены…») остаются в UI для пользователя, но тесты намеренно проверяют устойчивый результат (статус формы в БД/списке), потому что Server Action с `revalidatePath` перемонтирует список и локальный state действия исчезает.
4. Форма портала показывает только статус `sent`; статус `expired` в БД никем не проставляется (срок проверяется по `expires_at`) — поведение оставлено как есть, RPC/список фильтруют по времени.

## Ревью ведущего

- **Найден и исправлен реальный дефект (важно).** До этого тикета отправка формы
  из Client Portal **не работала вообще**: `submit_feedback_form` писал аудит через
  `append_audit`, который требует членства в организации, а portal-идентичность
  (по определению) членом не является — транзакция откатывалась целиком. Тикет 05
  проверял submission только от специалиста, поэтому дефект не был виден. Теперь
  аудит пишет внутренний `append_feedback_audit`, а portal-путь дополнительно
  требует активное согласие `client_portal`, поэтому отзыв согласия действует на
  следующем же запросе.
- **Права проверены в БД**: `append_feedback_audit` недоступен ни `anon`, ни
  `authenticated` (только внутренний/`service_role`); `submit_feedback_form` и
  `list_client_portal_feedback_forms` недоступны `anon` и доступны
  `authenticated`. Общий список anon-доступных функций не изменился (8).
- **RLS не ослаблен, а усилен**: политика чтения форм порталом теперь учитывает и
  `client_portal` consent, и `expires_at`; базовые таблицы порталу по-прежнему
  недоступны, форма отдаётся только через guarded RPC.
- **Feedback остаётся pending evidence**: после отправки сигнал `self_report` в
  статусе pending, authoritative evidence/confidence не меняются — проверено
  тестами; подтверждение возможно только явным ревью специалиста.
- **Прогоны**: полный набор 100 файлов / 723 теста — зелёный (в этот раз и в
  обычном параллельном режиме); `pnpm test:e2e` — **35 тестов** (5 новых feedback +
  30 прежних); `pnpm typecheck`, `pnpm lint` — зелёные.
- **Подтверждён системный риск флейков** (для тикета 23): агент воспроизвёл падения
  нетронутых тестов при полном параллельном прогоне; в моём прогоне они не
  повторились. Тикет 23 обязан сделать гейт воспроизводимым (ограничение
  параллелизма integration-наборов и/или явная политика повторов), иначе релиз
  будет блокироваться случайно.
