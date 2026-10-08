# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Single-context. The glossary and decisions already live in `.brain/`. Do not create a second glossary at the repo root, and do not create `docs/adr/`.

## Before exploring, read these

- **`.brain/GLOSSARY.md`**: the language of this repo. UI word and code word both, when they differ.
- **`.brain/DECISIONS.md`**: choices not to re-litigate. This is the ADR log.

If a term is missing, note it. Do not invent a synonym the glossary avoids. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) updates `.brain/GLOSSARY.md` and `.brain/DECISIONS.md` when terms or decisions actually get resolved. Do not flag their absence and do not suggest creating root copies.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `.brain/GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

## Flag decision conflicts

If your output contradicts an existing entry in `.brain/DECISIONS.md`, surface it explicitly rather than silently overriding:

> _Contradicts the phrase-label decision (2026-10-08), but worth reopening because…_
