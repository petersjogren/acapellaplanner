# AGENTS.md

Instructions for coding agents in this repository. Human product docs stay in `README.md` and `docs/`.

## Second brain (required)

Persistent engineering notes live in `.brain/`. They are the on-ramp for a new senior engineer or agent. **Read them before changing behaviour. Update them in the same change as the code.**

| File | When to read | When to write |
|---|---|---|
| `.brain/PROJECT.md` | What the app is, commands, non-goals | Rarely (product/stack/deploy change) |
| `.brain/ARCHITECTURE.md` | Boundaries, data, audio, export | Layer/invariant/schema-flow change |
| `.brain/CONVENTIONS.md` | How to place code and tests | New convention only if it will be repeated |
| `.brain/CURRENT.md` | What works at HEAD | End of every feature that users can notice |
| `.brain/TODO.md` | Known debt and leftovers | Add holes you discover; **delete** items you close |
| `.brain/LEARNINGS.md` | Pitfalls (alignment, Safari, queues) | After a non-obvious bug or a near-miss |
| `.brain/DECISIONS.md` | Choices not to re-litigate | When you make or reverse a decision |
| `.brain/log/` | Recent work | Append a short dated note per landed feature |

Do not duplicate README quickstart or restate filenames. Prefer invariants, ownership, and “do not do X”. If unsure, write `uncertain:` rather than inventing.

A feature is not done until:

1. Tests and `npm run lint` / `npm test` (and `npm run build` if routing, PWA, or Vite config changed).
2. `.brain/CURRENT.md` and `.brain/TODO.md` match HEAD.
3. A new decision, pitfall, or schema bump is recorded.
4. `.brain/log/YYYY-MM-DD-<slug>.md` exists for the change.

## Product rails (do not violate)

- This is a ghost-track **booth**, not a DAW. No mixer, clip editor, auto-tune, or second timebase.
- Ghost ms is the clock. Click only in in-time sections.
- Domain stays pure. Untrusted JSON goes through `migrateAndParseProject`.
- Breaking `Project` shape → bump `CURRENT_SCHEMA_VERSION` + migration step + tests.
- Play-window math has multiple consumers (schedule, mix song playback, DAW export, recording). Change all of them.
- Decode on the singleton AudioContext. Raw mic capture (no AEC/NS/AGC).
- `.acapella.zip` is round-trip; `.stems.zip` is one-way. Do not merge them.
- Deploy stays manual (`workflow_dispatch`).

## Commands

```bash
npm test
npm run lint
npm run build
```

Default build base is `/acapellaplanner/`. Do not commit, push, or rewrite git history unless asked. Do not touch `.env` or secrets (none expected here).

## Tests

Vitest, jsdom. UI tests colocated under `src/ui/**`. Domain/audio/storage/pages under `tests/`. Dexie files must `import 'fake-indexeddb/auto'`. Inject the repository; do not use the default DB.

## Scope

Touch only what the task needs. Match existing style. One concern per commit if you are asked to commit.
