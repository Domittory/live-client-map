# 10: Добавить client-scoped DiagnosticSessions и Signals

**What to build:** Позволить Specialist создавать и просматривать DiagnosticSessions и Signals в client workspace, включая source lineage, review state, Evidence Trail и явное отсутствие достаточных данных.

**Blocked by:** 05/Сделать intake, review и import мутации атомарными; 09/Создать client workspace с access management.

**Status:** ready-for-agent

- [ ] Specialist создаёт DiagnosticSession и добавляет Signals через браузер без database helpers.
- [ ] UI показывает source, epistemic type, review status, evidence level и lineage каждого Signal.
- [ ] Pending evidence нельзя принять или отклонить без явного user action и reason там, где он обязателен.
- [ ] Пустое или недостаточное evidence отображается как «недостаточно данных», а не как conclusion.
- [ ] Browser-to-database tests проверяют persisted state, audit evidence и RLS denial.
