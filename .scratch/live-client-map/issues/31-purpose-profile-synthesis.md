# 31: Реализовать PurposeProfile и PurposeSynthesis

**What to build:** Специалист сохраняет purpose inputs и формирует осторожный synthesis между несколькими интерпретационными системами.

**Goal:** Поддержать purpose layer без превращения Jyotish или Human Design в объективные факты.

**Context:** Source systems являются источниками гипотез. Synthesis должен показывать совпадения, конфликты и confidence.

**Blocked by:** 17 — Client; 29 — Resources; 30 — DevelopmentTargets.

**Status:** ready-for-agent

## Concrete steps

1. Реализовать PurposeProfile и PurposeSynthesis contracts.
2. Создать services для raw data, interpretation и visibility.
3. Реализовать ручной synthesis matches, conflicts и development vectors.
4. Добавить Purpose UI с явным epistemic disclaimer.
5. Покрыть multi-source, visibility и no-fact-promotion tests.

## Acceptance criteria

- [ ] Каждый PurposeProfile сохраняет source system и raw data.
- [ ] Synthesis не меняет evidence counts психологической модели.
- [ ] Потенциальные конфликты показываются, а не скрываются.
- [ ] Client-visible content контролируется отдельно.

## Checks

- [ ] Пройдены source classification и epistemic-boundary tests.
- [ ] Repository-standard lint, typecheck и tests проходят.
