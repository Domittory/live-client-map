# 22: Расширить browser-to-database production journey

**What to build:** Создать один воспроизводимый внешний production-readiness journey с synthetic data, который проходит реальный Owner, Specialist и Client Portal workflow через browser, API и чистый Supabase.

**Blocked by:** 09/Создать client workspace с access management; 10/Добавить client-scoped DiagnosticSessions и Signals; 11/Добавить client-scoped import workflow; 12/Добавить review workflow для Themes, CoreNodes и DifferentialHypotheses; 13/Добавить Resources, DevelopmentTargets, Purpose и Recommendations; 14/Закрыть пробелы BehavioralMarker и ModelChange; 15/Завершить Client Portal authentication и published view; 16/Завершить Client Portal feedback; 17/Завершить password recovery; 18/Собрать полный privacy-safe archive contract; 19/Ввести асинхронное создание ExportRequest; 20/Защитить download и автоматизировать 30-дневный expiry.

**Status:** ready-for-agent

- [ ] Journey покрывает onboarding, Specialist access, Client creation, consent, diagnostics, Signals, model review, Recommendations, Correction, BehavioralMarker, FollowUp, snapshots и model changes.
- [ ] Journey скачивает и валидирует full archive, проходит Client Portal feedback, затем проверяет consent revocation и erasure.
- [ ] Assertions используют только visible UI, HTTP contracts, authorized persisted reads, RLS denial, archive contract и audit evidence.
- [ ] Intellectual-correctness invariants остаются неизменными: evidence independence, L0 AI-only, competing hypotheses, medical boundaries и insufficient-data wording.
- [ ] Journey работает против изолированного приложения и clean database без real PII и private helper assertions.
