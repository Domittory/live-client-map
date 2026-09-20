# Production readiness remediation

Status: ready-for-agent

## Problem Statement

«Живая карта клиента» уже имеет развитую доменную модель, RLS, consent-гейты, AI human-in-the-loop, версионные PsychologicalSnapshots и обширный набор автоматических тестов. Однако в текущем виде систему нельзя безопасно считать готовой к работе с реальными психологическими данными.

В production-зависимостях есть критические и высокие уязвимости. Часть составных мутаций и audit-запись выполняются не в одной транзакции, что может оставить частично записанное состояние. Один из путей обновления BehavioralMarker использует неверное имя поля базы.

Полный браузерный workflow Specialist недоступен: отсутствуют обязательные client-scoped экраны для диагностики, Signals, Themes, Resources, DevelopmentTargets, Purpose, Recommendations, import и access management. Client Portal и feedback forms существуют только на уровне схемы, RLS и сервисов, но не как законченный поток для Client Portal User.

Полный JSON archive не соответствует утверждённому data-exchange contract: нет всех обязательных коллекций, асинхронного ExportRequest, повторной проверки доступа перед скачиванием и 30-дневного retention. Password recovery не имеет завершённого callback. Экран изменений модели не показывает новые DifferentialHypotheses и contradictions.

Наконец, production AI осознанно выключен до отдельного решения о провайдере и обработке данных, а staging smoke, restore drill, rollback drill и production smoke не выполнены и не подписаны ответственным лицом.

## Solution

Довести систему до однозначного production release gate, после которого в ней можно безопасно вести реальных клиентов. Решение включает обновление уязвимых зависимостей, атомарные business mutations с audit trail, законченный Specialist workflow, рабочий Client Portal, полное восстановление пароля, contract-compliant exports с retention, полное объяснение изменений модели и завершённые operational drills.

Проект считается готовым только после прохождения одного сквозного production-readiness journey через браузер, API и Supabase, отсутствия critical/high production vulnerabilities, а также подписанных staging, restore, rollback и production smoke checks.

## User Stories

1. As an Owner, I want the production dependency tree to contain no known critical or high vulnerabilities, so that client data is not exposed through a known framework flaw.
2. As an Owner, I want every release to identify its exact commit and dependency lockfile, so that the deployed version can be audited and rolled back.
3. As an Owner, I want the release checklist to block production until all mandatory checks are signed, so that documentation cannot be mistaken for completed operational verification.
4. As an Owner, I want organization and client mutations to be atomic with their AuditLog entries, so that business data and its audit trail never disagree.
5. As an Owner, I want failed compound operations to roll back completely, so that clients never remain in a partially updated state.
6. As an Owner, I want a complete client archive, so that I can satisfy access, portability and compliance requests.
7. As an Owner, I want exports to expire automatically after 30 days, so that sensitive files are not retained indefinitely.
8. As an Owner, I want every export request, completion, download, denial and expiry audited, so that sensitive data movement is traceable.
9. As an Owner, I want access and consent rechecked immediately before download, so that revoked access prevents delivery of a previously prepared export.
10. As a Specialist, I want to complete the entire client workflow from the browser, so that I do not need database access or test helpers to perform my work.
11. As a Specialist, I want to create and review DiagnosticSessions and Signals, so that raw evidence can enter the model through a supported interface.
12. As a Specialist, I want to review Themes, CoreNodes and DifferentialHypotheses, so that AI-created hypotheses remain subject to human approval.
13. As a Specialist, I want to manage Resources, DevelopmentTargets and PurposeProfile, so that the model covers strengths and development rather than only problems.
14. As a Specialist, I want to generate and review Recommendations, so that correction priorities remain explainable and human-controlled.
15. As a Specialist, I want to import supported text, CSV and JSON data from a client-scoped screen, so that imported evidence follows the same review rules as manually entered evidence.
16. As a Specialist, I want to manage client assignments and access from the client context, so that only authorized colleagues can see or change the client.
17. As a Specialist, I want BehavioralMarker links to Themes to update correctly, so that behavioral evidence remains connected to the intended model entity.
18. As a Specialist, I want the model-change screen to show new DifferentialHypotheses and contradictions, so that I can understand all material changes between snapshots.
19. As a Specialist, I want every model conclusion to retain its Evidence Trail, so that I can explain why the system reached it.
20. As a Specialist, I want insufficient data to be shown explicitly, so that absence of evidence is not presented as a conclusion.
21. As a Specialist, I want password recovery to return me to a secure password-update screen, so that I can regain access without administrator intervention.
22. As a Supervisor, I want access only to explicitly assigned clients, so that supervision does not grant organization-wide visibility.
23. As a Supervisor, I want anonymized supervision exports to preserve privacy rules, so that I can review cases without unnecessary identifiers.
24. As a Client Portal User, I want a time-limited authentication link, so that I can access my portal without becoming an organization member.
25. As a Client Portal User, I want to see only published summaries, approved DevelopmentTargets and client-visible Recommendations, so that private specialist reasoning remains private.
26. As a Client Portal User, I want to complete my own feedback forms, so that my observations can enter the review process.
27. As a Client Portal User, I want submitted feedback to become pending evidence rather than an automatic conclusion, so that I do not accidentally confirm an AI hypothesis.
28. As a Client Portal User, I want revoked portal consent to remove access immediately, so that I retain control over my data.
29. As a data protection reviewer, I want the full archive contract to include every required collection, including empty collections, so that consumers receive a stable and complete schema.
30. As a data protection reviewer, I want relationship privacy and visibility rules applied to exports, so that third-party and relationship data is not leaked.
31. As a data protection reviewer, I want filenames and logs to exclude direct identifiers and raw export content, so that operational metadata does not become another source of sensitive data.
32. As a security reviewer, I want authentication and authorization behavior retested after framework upgrades, so that a dependency fix does not weaken RLS or middleware protections.
33. As a security reviewer, I want production AI disabled until provider, data region, processing agreement, retention and cross-border transfer are approved, so that sensitive data is not sent under a development-only decision.
34. As an operator, I want a staging deployment built from the exact release commit, so that production behavior is tested against the intended artifact.
35. As an operator, I want post-deploy smoke tests to verify both service identity and database readiness, so that a different service on the same port cannot produce a false pass.
36. As an operator, I want a completed restore drill, so that backups are proven usable rather than merely configured.
37. As an operator, I want a verified rollback procedure, so that a bad deployment can be reversed within an agreed recovery window.
38. As an operator, I want production logging, redaction, metrics and alerts verified with synthetic data, so that failures are visible without exposing client information.
39. As a developer, I want local E2E tests to use an isolated server, so that an unrelated process cannot be mistaken for this application.
40. As a developer, I want one reproducible production-readiness command or CI workflow, so that the release result does not depend on undocumented manual sequencing.
41. As a developer, I want generated database types to be refreshed while service row contracts remain locally controlled, so that schema drift is visible without coupling services to incomplete generated types.
42. As a developer, I want failed AuditLog writes and intermediate database failures covered by rollback tests, so that transaction guarantees are proven rather than assumed.
43. As a maintainer, I want the README, development guide and release-readiness document to describe the actual gates, so that future contributors do not rely on stale status claims.
44. As a maintainer, I want the final release SHA pushed and checked by remote CI, so that local success is not treated as production evidence.

## Implementation Decisions

- Treat this effort as a release-remediation program with one acceptance outcome: a production release may proceed only when all mandatory gates are green and signed. Individual subfeatures do not independently make the product production-ready.
- Keep the existing Next.js and Supabase architecture. A framework migration, microservice split or replacement of PostgreSQL is not required.
- Upgrade Next.js and all affected transitive production dependencies to supported patched versions. Regenerate the lockfile, review framework migration notes, and rerun authentication, middleware, Server Action, image and RSC regression coverage.
- Add a CI dependency-security gate. Critical and high production vulnerabilities block release; accepted exceptions require an explicit, time-bounded documented decision rather than an ignored audit result.
- Implement every compound business mutation as one PostgreSQL transaction exposed through a narrowly scoped RPC. The domain mutation, related child rows, ModelChange where applicable, and AuditLog append must commit or roll back together.
- Preserve least privilege for RPCs: fixed search path, minimal grants, tenant and ClientAssignment checks, consent checks and authenticated actor attribution remain mandatory.
- Replace the generic mutation-then-audit wrapper where atomicity is required. It may remain only for operations that are demonstrably single-statement and cannot leave an unaudited committed state.
- Correct the BehavioralMarker Theme-link database field mapping and keep public service inputs in the existing camel-case convention while database payloads use schema column names.
- Keep local service row interfaces as the service boundary. Generated database types remain schema verification output, not the primary domain contract for service modules.
- Complete client-scoped Specialist screens for DiagnosticSessions, Signals, Themes, CoreNodes, Resources, DevelopmentTargets, Purpose, Recommendations, import and access management. Screens must call existing service boundaries rather than duplicate domain rules in UI code.
- Preserve human-in-the-loop semantics in every new screen: AI-created Theme, CoreNode, DifferentialHypothesis, Recommendation and Relation starts pending and cannot silently change a confirmed model entity.
- Complete Client Portal authentication with time-limited, single-client controlled access. A portal identity does not become an organization member and cannot query base domain tables directly.
- Add Client Portal and specialist-review interfaces for feedback forms. Submission creates pending evidence and never directly increases authoritative evidence or confidence counts.
- Complete password recovery with an explicit redirect target, recovery-session verification, password update form, expired-link handling and safe post-success navigation.
- Introduce asynchronous ExportRequest lifecycle states for request, generation, availability, download, expiry, denial and failure. Export creation is idempotent and partial files never become downloadable.
- Store generated export files in private storage with opaque filenames. Apply a 30-day retention policy and auditable expiry/deletion process.
- Make the full JSON archive conform exactly to the approved contract. Every required top-level collection is always present, absent collections are empty, manifest counts and hashes are authoritative, and silent truncation is forbidden.
- Recheck tenant, assignment, role, consent, visibility and relationship privacy both when assembling an export and immediately before issuing a download.
- Keep PsychologicalSnapshot categories stable unless a separately approved data-model change is necessary. Show new DifferentialHypotheses and contradictions through the version-bounded ModelChange/read-model layer so the model-change screen satisfies the product requirement without fabricating snapshot data.
- Keep production AI feature-gated off until a human-approved provider and data-processing decision exists. Enabling it requires approved provider, region, retention, processing agreement and cross-border transfer terms, plus a production evaluation run using non-real data.
- Configure E2E to launch or address an isolated application instance. Readiness checks must validate a service identity/version payload, not merely accept any HTTP response on a common port.
- Produce a release artifact from one exact commit. The same artifact proceeds through staging verification and production deployment; the final commit must be pushed and pass remote CI.
- Complete and sign staging smoke, migration dry-run, integration tests against the target environment, restore drill, rollback drill, logging/alert verification and production smoke before allowing real client data.
- Update operational and developer documentation as part of the same change set so stated readiness matches executable gates and signed evidence.

## Testing Decisions

- The primary seam is one browser-to-database production-readiness journey executed against an isolated application and a clean Supabase instance. It covers Owner onboarding, Specialist access, client creation, consent, DiagnosticSession and Signals, AI proposal review, CoreNode and DifferentialHypothesis handling, Recommendation and Correction, BehavioralMarker update, FollowUp, snapshots and model changes, full export, Client Portal feedback, consent revocation and erasure.
- The primary journey tests external behavior only: visible UI state, HTTP contracts, persisted state through authorized reads, RLS denial, downloadable archive contract and audit evidence. It must not assert private helper calls or implementation-specific query ordering.
- Use the existing production journey, access-matrix, authentication, portal, export, erasure, snapshot, explanation and acceptance test suites as prior art. Extend them rather than creating parallel domain fixtures and incompatible setup conventions.
- Add focused integration fault-injection tests at the RPC boundary for compound mutations. Force failures during child-row insertion and AuditLog append and assert that no portion of the business mutation commits.
- Add a focused integration regression test that updates a BehavioralMarker Theme link and verifies the stored relation and audit result through the public service boundary.
- Add contract tests for the full client archive. Validate required keys, empty collections, record counts, stable version, content hash, privacy filtering, idempotency, denial after consent revocation and expiry after the retention period.
- Add browser tests for password recovery using the local email capture service: request link, follow callback, update password, reject expired or reused links, and sign in with the new password.
- Add browser tests for Client Portal authentication, published content visibility, feedback submission, cross-client denial and immediate access loss after consent revocation.
- Add browser tests for each mandatory Specialist navigation path, but keep one main journey rather than one isolated end-to-end setup per screen.
- Rerun intellectual-correctness acceptance tests unchanged after UI and transaction work. Evidence independence, L0 AI-only behavior, competing hypotheses, medical boundaries and insufficient-data wording are regression invariants.
- Rerun the complete RLS access matrix after the framework upgrade and after adding portal/export endpoints.
- Add a test that occupies the default development port with an unrelated service and proves the E2E harness either selects another port or fails explicitly instead of reusing it.
- Run dependency audit, lint, typecheck, unit, smoke, acceptance, integration, E2E and production build as blocking CI gates. The dependency audit evaluates production dependencies separately from development tooling.
- Verify migrations from a clean database, not only against an already migrated developer database. A clean rebuild and the documented rollback policy are release evidence.
- Operational checks use synthetic data only. Staging smoke, production smoke, alert verification, backup restore and rollback produce timestamped evidence attached to the release checklist and require human sign-off.

## Out of Scope

- New psychological theories, scoring formulas, ontology categories or diagnostic methodologies.
- Replacing the current human-in-the-loop policy with autonomous AI decisions.
- Selecting or enabling a production AI provider without the separate human legal, privacy and data-region decision.
- A full visual redesign, brand system or native mobile application. UI work in scope is functional completion of required workflows.
- Billing, subscription management and commercial packaging.
- Migrating from Next.js/Supabase to a different platform or splitting the application into microservices.
- Changing the default right-to-erasure policy beyond integration needed for exports, retention and portal access.
- Automating the accountable human signature for restore, rollback and production smoke checks.

## Further Notes

- No real client or other production PII may be loaded until the release checklist is fully green and signed.
- The existing test baseline is valuable: lint, typecheck, production build, 230 unit tests, 2 smoke tests, 24 acceptance tests and 221 Supabase integration tests passed during the readiness review. This baseline must remain green.
- The current local E2E failure was caused by reuse of an unrelated service already listening on the configured port. Direct verification of this application's health endpoint succeeded, but the harness behavior itself must be corrected because it can produce false results locally.
- The dependency audit observed 39 production vulnerabilities at review time: 4 critical, 15 high, 17 moderate and 3 low. Counts are time-sensitive; the release criterion is based on a fresh audit of the release lockfile, not these historical numbers.
- Production AI is intentionally unavailable until separately approved. The non-AI parts of the product may proceed only if the release scope and user-facing behavior clearly communicate that limitation.
- Existing unrelated working-tree changes must be preserved. Each implementation ticket created from this spec should end in its own focused commit.
