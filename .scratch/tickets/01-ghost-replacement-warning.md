# Ticket 1 — Ghost-replacement warning (pure domain function)

Spec: `.scratch/spec-ghost-recording.md` (see "Ghost-replacement confirmation" in Implementation Decisions, and user stories 11–14).

Blocked by: none. Blocks: Ticket 3.

## Goal

Add a pure function to `src/domain/project.ts` that decides whether replacing a song's ghost track should be confirmed first, and produces the exact warning message to show, based on how much work (phrases, takes) is already riding on the current ghost.

## Context you need

- Read `src/domain/project.ts` in full first — it already has the sibling pure functions `reconcileGhostDuration` and `phrasesBeyondGhost`, which this new function should sit alongside, in the same style (plain input `Project` → output, no side effects, no DOM/React import).
- Read `src/domain/schemas.ts` for the `Project` type — specifically `project.phrases: Phrase[]` and `project.takes: Take[]`.
- Read `tests/domain/project.test.ts` in full — it has helper functions (`phrase(...)`, `withGhost(...)`) you should reuse or extend rather than duplicate, and it shows the existing test style for this file (`describe`/`it`, plain assertions, no mocks needed since everything here is pure).

## What to build

A function (suggested name: `ghostReplacementWarning`, but choose whatever reads best alongside the existing two — keep it in this same file) with this shape:

```ts
export function ghostReplacementWarning(project: Project): string | null
```

Behavior:

- Returns `null` when `project.phrases.length === 0` — nothing is at stake yet, so no confirmation should ever interrupt the common first-ghost flow (user story 13).
- Otherwise returns a non-null message string that:
  - Names the phrase count, e.g. `"This song already has 12 phrases marked on the current ghost."` (singular "1 phrase" vs plural "N phrases" — handle both).
  - When `project.takes.length > 0`, also names the take count in the same message, e.g. `"...(and 34 recorded takes)"` — only mention takes when the count is non-zero (user story 12). Singular/plural applies here too ("1 recorded take" vs "N recorded takes").
  - Ends with a question inviting the decision to continue, e.g. `"Replacing it may shift where they land. Continue?"`
  - The exact wording is yours to finalize, but it must satisfy the assertions below (which check for presence of the counts and key phrases, not an exact string match) — do not make the tests brittle to a specific sentence structure; match on substrings/regex.

This function does **not** call `window.confirm`, does not touch React, and does not know about `GhostImporter`/`GhostRecorder` — it is pure decision logic only. Ticket 3 is the one that wires it to an actual confirm dialog.

## Tests to write first (TDD)

Add to `tests/domain/project.test.ts` (new `describe('ghostReplacementWarning', ...)` block):

1. Returns `null` for a project with `phrases: []` (use `createEmptyProject`, or the existing `withGhost(duration, [])` helper with an empty phrases array), regardless of ghost/take state.
2. Returns a non-null string mentioning the phrase count (e.g. assert it contains `"3 phrases"` or similar) for a project with phrases but `takes: []`. Assert the message does **not** mention takes in this case (e.g. does not contain the word "take").
3. Returns a non-null string mentioning both the phrase count and the take count when `project.takes` is non-empty. Build a `Take` fixture — check `tests/domain/takes.test.ts` or `TakeSchema` in `schemas.ts` for the minimal required fields to construct one, or construct a project via existing test helpers that already produce takes if such a helper exists in this test file or `tests/domain/singThrough.test.ts`.
4. Singular wording: exactly 1 phrase and 0 takes produces a message that reads naturally singular (e.g. contains "1 phrase" not "1 phrases") — same check for exactly 1 take.

Run `npm test -- tests/domain/project.test.ts` to confirm these fail first (red), then implement, then confirm green.

## Acceptance criteria

- [ ] `ghostReplacementWarning` exported from `src/domain/project.ts`, pure, no new imports beyond what's already in that file (or only type-only imports from `schemas.ts` if needed).
- [ ] All 4+ test cases above pass.
- [ ] `npm test -- tests/domain/project.test.ts` passes with no regressions in the rest of that file.
- [ ] `npm run lint` is clean.
- [ ] Full `npm test` run has no regressions elsewhere.
- [ ] Commit message style: `feat(domain): add ghostReplacementWarning` (or similar, matching `git log --oneline -10` conventions) with the test file in the same commit.

## Out of scope for this ticket

- Calling `window.confirm` anywhere — that is Ticket 3.
- Any change to `PreparePage.tsx` — that is Ticket 3.
- Any change to `GhostImporter.tsx` or a new recorder component — that is Ticket 2.
