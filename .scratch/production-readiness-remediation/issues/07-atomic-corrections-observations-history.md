# 07: Сделать Corrections, observations и model history атомарными

**What to build:** Перевести Corrections, BehavioralMarkers, FollowUps, reactivation, ModelChanges, PsychologicalSnapshots и explanations на атомарные write paths, чтобы history всегда соответствовала фактическому состоянию модели.

**Blocked by:** 01/Ввести шаблон атомарной business mutation.

**Status:** ready-for-agent

- [ ] Correction и её targets/expected markers фиксируются вместе с AuditLog или полностью откатываются.
- [ ] Observation/BehavioralMarker и FollowUp transitions не расходятся со связанными ModelChanges.
- [ ] Reactivation decision, snapshot generation и explanation decision сохраняют все связанные rows атомарно.
- [ ] Failed AuditLog append и intermediate insert/update не оставляют видимого business state.
- [ ] Existing scoring, snapshot, explanation и intellectual-correctness tests остаются зелёными.
