# Tickets: Record the ghost track live in the booth

Parent spec: `.scratch/spec-ghost-recording.md`
Branch: `learn/matt-skills` (do not land on `main` without the preparer's explicit say-so — see `.hermes/plans/2026-09-23_164402-learn-matt-pocock-skills.md`).

Each ticket below is a self-contained tracer bullet: a subagent can open the ticket file and implement it without reading this index or the full spec, though the spec is linked from each ticket for background/rationale if something is ambiguous. Work the tickets in dependency order; do not start a blocked ticket until everything in its "Blocked by" list is done, committed, and its own tests pass.

## Ticket list

| # | File | Blocked by | Blocks | One-line goal |
|---|---|---|---|---|
| 1 | `01-ghost-replacement-warning.md` | — | 3 | Pure domain function deciding whether/what to warn about on ghost replacement |
| 2 | `02-ghost-recorder-component.md` | — | 3 | New `GhostRecorder` UI component (check mic → meter → record → confirm) |
| 3 | `03-prepare-page-wiring.md` | 1, 2 | — | Wire both into `PreparePage`: render `GhostRecorder`, gate replacement on the warning via `window.confirm` |

Tickets 1 and 2 are independent of each other and can be built in parallel (different files, no shared state). Ticket 3 touches `PreparePage.tsx` and its test file, and needs both of the others to exist first.

## Shared ground rules for every ticket

- Follow this repo's TDD/commit conventions from `AGENTS.md` / `.brain/CONVENTIONS.md`: write the failing test first, then the minimal implementation, then run the full suite.
- Verify with `npm test` (targeted file first, then the full suite) and `npm run lint` before calling a ticket done — `npm run lint` is not run in CI, so it is this ticket's job to catch issues.
- One concern per commit: `feat(prepare): ...` / `test(prepare): ...` style, matching existing history (`git log --oneline -10`).
- Do not touch files outside what the ticket lists. If you believe a wider change is needed, stop and report back instead of expanding scope.
- `domain/` stays pure (no React, Web Audio, IndexedDB, DOM) — see `.brain/ARCHITECTURE.md`.
- When done, update `.brain/CURRENT.md` (what works) and `.brain/TODO.md` (if it closes anything) per `AGENTS.md`'s "a feature is not done until" checklist — but only after ticket 3 lands (the end-to-end feature), not after tickets 1/2 individually.
