# 40: Реализовать Observation и BehavioralMarker

**What to build:** Специалист фиксирует наблюдения и измеримые поведенческие признаки до и после Correction.

**Goal:** Дать evaluateCorrection данные, независимые от AI-гипотез.

**Context:** Observation может относиться к Correction или клиенту. BehavioralMarker может быть связан с CoreNode, Theme или Resource.

**Blocked by:** 39 — Correction planning.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать Observation и BehavioralMarker contracts.
2. Создать services для baseline, current value, trend и evidence links.
3. Добавить UI ввода observation и изменения marker.
4. Валидировать scales, source, visibility и supports improvement.
5. Покрыть baseline/history и permission tests.

## Acceptance criteria

- [ ] Baseline не перезаписывается текущим значением.
- [ ] Observation сохраняет source, valence, intensity и confidence.
- [ ] Marker имеет не более одного link каждого разрешённого типа по data contract.
- [ ] Client-visible и private observations разделены.

## Checks

- [ ] Пройдены baseline/change/history и RLS tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
