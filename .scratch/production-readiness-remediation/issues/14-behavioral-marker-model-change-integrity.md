# 14: Закрыть пробелы BehavioralMarker и ModelChange

**What to build:** Исправить сохранение Theme-link у BehavioralMarker и дополнить version-bounded model-change read model, чтобы Specialist видел новые DifferentialHypotheses и contradictions между версиями без изменения состава PsychologicalSnapshot.

**Blocked by:** 06/Сделать мутации психологической модели атомарными; 07/Сделать Corrections, observations и model history атомарными; 12/Добавить review workflow для Themes, CoreNodes и DifferentialHypotheses.

**Status:** ready-for-agent

- [ ] Public service input обновляет Theme-link через правильное database column mapping.
- [ ] Regression test читает сохранённую связь и AuditLog через public service boundary.
- [ ] Сравнение двух snapshot versions показывает созданные в интервале DifferentialHypotheses и contradictions.
- [ ] Read model не добавляет новые snapshot categories и не фабрикует historical state.
- [ ] UI связывает изменения с Evidence Trail и явно сообщает недостаток данных.
