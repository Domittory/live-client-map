# 15: Завершить Client Portal authentication и published view

**What to build:** Дать Client Portal User отдельный time-limited authentication flow и privacy-filtered portal, который показывает только опубликованные summaries, approved DevelopmentTargets и client-visible Recommendations.

**Blocked by:** 04/Сделать Organization, Client, access и consent мутации атомарными.

**Status:** ready-for-agent

- [ ] Portal identity входит по ограниченной по времени ссылке и не получает Organization membership.
- [ ] Portal User связан ровно с разрешённым Client и не может читать base domain tables напрямую.
- [ ] UI показывает только published/client-visible content и скрывает private notes, risks, pending AI output и DifferentialHypotheses.
- [ ] Cross-client access запрещён, а revocation portal consent или access действует немедленно.
- [ ] Browser tests покрывают login link, expiry/reuse, visible content и RLS denial.
