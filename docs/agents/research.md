# Research before writing

**Hard rule: do not write from memory.** When a task depends on a crate version, an API signature, platform behavior, an algorithm or performance approach, or the meaning of an unfamiliar error, research it online first and cite the source. Guessing is a defect even when the guess happens to be right.

## When it applies

- Dependency selection and version numbers: `Cargo.toml`, `package.json`, Tauri plugin versions, `ncm-api-rs`.
- API usage: Tauri v2 commands and plugins, Vue 3 / Pinia / Vite, Rust crate APIs.
- Platform behavior: winit / wgpu / cosmic-text, WebView2 and WebKitGTK, window / tray / multi-monitor / DPI behavior, updater install paths.
- Algorithms and performance plans: scheduling, caching, interpolation, rendering budgets, allocation strategy.
- Unfamiliar errors: compiler, clippy, Tauri build, CI failures, panic messages.

## Where to look (in order)

1. Official reference and source: docs.rs, crates.io, the upstream repository source, official documentation.
2. Release notes, changelogs, migration guides.
3. Upstream GitHub issues and pull requests — check whether the report was reproduced and confirmed.
4. Blog posts, forums, AI answers — inference only. Never the sole basis for a version or API decision.

## Record the result

When the conclusion affects design, dependencies, or public API, write `docs/research/<topic>.md` (create `docs/research/` if it does not exist; use a kebab-case topic name). Each record must contain:

- the conclusion and the decision it supports;
- source links, each labelled `official docs` / `release notes` / `upstream source` / `issue` vs `blog inference`;
- the date the research was done (ISO `YYYY-MM-DD`) and the exact versions checked — docs.rs and guides change over time;
- the impact: which crates, APIs, or files the decision constrains;
- what remains unconfirmed and what would invalidate the conclusion.

Research that changes nothing stays in the conversation. Research that changes a dependency, an API, or a design goes in the file — not recording it means researching it again next time.

## Conflict and uncertainty

- If sources disagree, state the conflict; do not silently pick one.
- If a fact cannot be confirmed online, record it as unconfirmed and gate the decision on it instead of filling the gap from memory.
- Do not link a source you did not open.
