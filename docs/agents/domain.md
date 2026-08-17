# Domain docs

This repository uses a single-context domain documentation layout.

## Read before exploring

Before working in a domain area, read these files when they exist:

- `CONTEXT.md` at the repository root
- Relevant ADRs under `docs/adr/`

If either location does not exist, proceed silently. Do not suggest creating it pre-emptively. The domain-modeling workflow creates domain documents when terminology or architectural decisions are actually resolved.

## Layout

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

## Use the glossary vocabulary

When naming a domain concept in an issue, refactor proposal, hypothesis, or test, use the term defined in `CONTEXT.md`.

Avoid synonyms that the glossary explicitly rejects. If a needed concept is absent, reconsider whether new terminology is necessary or record the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, state the conflict explicitly instead of silently overriding the decision.
