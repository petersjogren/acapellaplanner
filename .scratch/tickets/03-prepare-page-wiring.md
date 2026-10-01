# Ticket 3 — Wire `GhostRecorder` + replacement warning into `PreparePage`

Spec: `.scratch/spec-ghost-recording.md` (all sections — this is the integration ticket).

Blocked by: Ticket 1 (`ghostReplacementWarning` in `src/domain/project.ts`), Ticket 2 (`GhostRecorder` component). Do not start until both are committed, tested, and green.

## Goal

1. Render the new `GhostRecorder` in `src/pages/PreparePage.tsx`, next to `GhostImporter`, in both the no-ghost and has-ghost UI branches.
2. Gate `PreparePage`'s existing `handleImported` behind a `window.confirm` using `ghostReplacementWarning`, so that replacing a ghost (by upload **or** by recording) on a song that already has phrases asks for confirmation first — and leaves everything untouched on cancel.

## Context you need (read in full before editing)

- `src/pages/PreparePage.tsx` — read the whole file, but specifically:
  - The `handleImported` function (currently writes a new blob, updates `ghostTrackId`/`guides`/`settings.ghostMeta`, and calls `setProject`). This is the function you're adding the confirm-gate to.
  - The two places `<GhostImporter .../>` is rendered: once inside the `hasGhost && ghostMeta` branch (with `label="Replace ghost track"`), and once in the `else` branch for a song with no ghost yet (no `label` override, default "Import ghost track"). `GhostRecorder` must be added right next to both.
  - The existing import block at the top of the file, where you'll add the new imports.
- `src/ui/preparer/GhostRecorder.tsx` (from Ticket 2) — its exported `GhostRecorder` component and `GhostRecorderProps`.
- `src/domain/project.ts` (from Ticket 1) — the exported `ghostReplacementWarning` function.
- `tests/pages/PreparePage.test.tsx` — read in full. Specifically:
  - The existing ghost-import test (`'imports a ghost track, shows name and duration, and persists ghostTrackId'`) — this test currently assumes no confirmation happens (there are no phrases on a fresh project), so it should keep passing unchanged once your gate is in place — if it breaks, your `phrases.length === 0` short-circuit is wrong.
  - The existing `vi.spyOn(window, 'confirm').mockReturnValue(true)` usage (around the part-delete-cascade test) — this is your prior art for spying on `window.confirm` in this exact test file; follow the same pattern.
  - `renderPrepare()` / however this suite sets up a project with phrases already in it, to build a fixture for your new tests (a project with existing phrases, and a separate one with existing phrases + takes).

## What to change

### 1. `PreparePage.tsx` imports

Add:
```ts
import { GhostRecorder } from '../ui/preparer/GhostRecorder.tsx'
import { ghostReplacementWarning } from '../domain/project.ts'
```
(Adjust the exact import line for `ghostReplacementWarning` to sit alongside the existing `import { renameProject, phrasesBeyondGhost, reconcileGhostDuration } from '../domain/project.ts'` line — add it to that same import rather than a new line, matching existing style.)

### 2. Gate `handleImported`

At the top of `handleImported` (before the existing blob-write logic), add the confirmation check:

```ts
async function handleImported({ blob, meta }: GhostImportResult) {
  const warning = ghostReplacementWarning(loaded)
  if (warning && !window.confirm(warning)) {
    return
  }
  // ...existing body unchanged below this point
}
```

Use `loaded` (the already-destructured current project in scope at this point in the file — confirm the exact variable name by reading the function; it may be `loaded` or `projectRef.current ?? loaded` depending on what's most current — prefer whichever the rest of `handleImported`'s existing body already reads from, for consistency, since you are not changing what "current project" means here, only adding a gate in front of it).

This single change covers **both** paths (`GhostImporter`'s onImported and `GhostRecorder`'s onImported), since both will be wired to call the same `handleImported`.

### 3. Render `GhostRecorder`

In the `hasGhost && ghostMeta` branch, directly after the existing `<GhostImporter label="Replace ghost track" onImported={handleImported} />` line, add:
```tsx
<GhostRecorder onImported={handleImported} />
```

In the `else` branch (no ghost yet), directly after the existing `<GhostImporter onImported={handleImported} />` line, add the same:
```tsx
<GhostRecorder onImported={handleImported} />
```

Do not add a `disabled` prop unless you find an existing analogous disablement condition already applied to `GhostImporter` in this file that should obviously also apply here (check for a `disabled={...}` prop on either existing `<GhostImporter>` usage — if none exists today, don't invent one).

## Tests to write first (TDD)

Add to `tests/pages/PreparePage.test.tsx`:

1. **No confirmation on a fresh project.** The existing test `'imports a ghost track, shows name and duration, and persists ghostTrackId'` already covers this implicitly (a brand-new project has no phrases) — add an explicit assertion there (or a new adjacent test) that `window.confirm` was **not** called, using a `vi.spyOn(window, 'confirm')` that should remain uncalled.
2. **Confirmation fires and is honored on cancel.** Set up a project that already has at least one phrase (use whatever existing fixture/helper this test file already has for creating phrases — check earlier tests in this same file for a pattern, e.g. via the roster/phrase UI flow already exercised elsewhere in this suite, or by seeding `repo.saveProject` directly with a phrase before rendering, matching how the file already seeds `ghostTrackId`/`guides` directly in its `beforeEach`/individual tests). Spy `window.confirm` to return `false`. Trigger a ghost replace (reuse the existing `pickFile`-style helper this suite already has, or add one via `fireEvent.change` on the "Replace ghost track" input). Assert: `window.confirm` was called with a message containing the phrase count; the project's `ghostTrackId` in the repo is unchanged from before the attempt; no new blob was written (if easy to assert directly, otherwise assert the UI still shows the old `ghostMeta.filename`).
3. **Confirmation fires and is honored on accept.** Same setup as (2), but spy returns `true`. Assert the replacement proceeds exactly as the existing no-confirmation import test already asserts (new `ghostTrackId`, new `ghostMeta`, new blob row).
4. **Takes are mentioned when present.** Same as (2)/(3) but seed at least one `Take` on that phrase as well (check `tests/domain/takes.test.ts` or existing `PreparePage.test.tsx` fixtures for a minimal valid `Take` object, or reuse the `TakeSchema` minimal fields from `schemas.ts`). Assert the `window.confirm` call's message argument contains a reference to the take count (substring match, not exact string, since Ticket 1 owns exact wording).
5. **`GhostRecorder` is actually rendered.** A render-only test (no interaction) asserting a `GhostRecorder`-identifying element (whatever accessible label/role Ticket 2 gives it — check that component's own test file for the right query) is present in both the no-ghost state and the has-ghost state of this page. This is the only test in this ticket that needs no mocking of mic APIs — you are only asserting the component mounts, not exercising its recording behavior (that's already covered by Ticket 2's own test file).

Run `npm test -- tests/pages/PreparePage.test.tsx` to confirm new cases fail first (red) before implementing, then green after.

## Acceptance criteria

- [ ] `GhostRecorder` rendered in both branches of the ghost section in `PreparePage.tsx`, wired to the same `handleImported`.
- [ ] `handleImported` gated by `ghostReplacementWarning` + `window.confirm`, short-circuiting (no blob write, no save, no state change) on cancel.
- [ ] A project with zero phrases never triggers `window.confirm` on ghost import/record (existing behavior stays frictionless).
- [ ] All 5 test cases above pass.
- [ ] `npm test -- tests/pages/PreparePage.test.tsx` passes.
- [ ] Full `npm test` run has no regressions.
- [ ] `npm run lint` is clean.
- [ ] `npm run build` succeeds (this ticket changes a page component and its imports — confirm nothing broke the build per `.brain/CONVENTIONS.md`/AGENTS.md's "verify" step for routing/build-relevant changes).
- [ ] Commit message style: `feat(prepare): wire ghost recorder and replacement confirmation` (test file in the same commit).
- [ ] After this ticket (and only after this ticket — not after 1 or 2 individually), update `.brain/CURRENT.md` to mention the new Record-ghost capability and replacement confirmation, and remove/adjust anything in `.brain/TODO.md` this closes, per `AGENTS.md`'s "a feature is not done until" checklist. Also add a dated note under `.brain/log/` (e.g. `2026-10-01-ghost-recording.md` or the actual date you land this) summarizing what shipped, matching the existing log entries' style and length.

## Out of scope for this ticket

- Any change to `GhostRecorder.tsx`'s internals — treat it as a finished, tested black box from Ticket 2. If you find a genuine defect in it while wiring, stop and report rather than patching it inside this ticket.
- Any change to `ghostReplacementWarning`'s exact wording — treat Ticket 1's output as given; only assert substrings/presence, not exact copy, in your new tests.
- A styled confirm modal — plain `window.confirm()` only, per the spec.
