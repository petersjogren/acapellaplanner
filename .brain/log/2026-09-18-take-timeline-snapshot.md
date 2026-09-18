# Take timing survives phrase edits/deletes

Confirmed a real bug reported by the user: sing a phrase, then edit or
delete that phrase on Prepare, and "All phrases" on Review (and DAW stem
export) would misplace or drop the already-recorded take.

Root cause: `Take` only stored `phraseId`. Whole-song playback
(`loadAllKeepersMixForSong` in `src/audio/mix.ts`) and export planning
(`planSegments` in `src/storage/dawExport.ts`) both recomputed a take's
timeline position by looking up its *current* phrase every time. Editing
`startMs`/`preRollMs` moved a take that had already been sung against the
old geometry; deleting the phrase orphaned the take, and the all-keepers
mix's fallback (`phrase ? ... : 0`) then stacked the orphan at position 0
instead of leaving it where it was recorded.

Fix (user explicitly wants orphaned takes to keep playing, not disappear):

- Added `Take.timelineStartMs` (optional, `domain/schemas.ts`) — a snapshot
  of the phrase's play-window start at record time.
- Added `phraseTimelineStartMs(phrase)` to `domain/phrases.ts` as the one
  formula (`max(0, startMs - preRollMs)`), shared by the take snapshot,
  `dawExport.segmentStartMs`, and the all-keepers mix's `startDelayMs`.
- `RecordControl.persistTake` writes the snapshot when a take is created.
- `planSegments` now keeps a take if it has a snapshot OR a live phrase
  (previously required a live phrase); it uses the snapshot when present.
  A deleted phrase's take gets `phraseName: 'Deleted phrase'`.
- `loadAllKeepersMixForSong` prefers `take.timelineStartMs` over
  recomputing from the live phrase for `startDelayMs`.
- Takes recorded before this field existed have no snapshot and keep the
  old live-phrase-lookup (or 0) fallback — no migration needed, schema
  version unchanged (additive optional field).

Tests added: `tests/domain/phrases.test.ts` (`phraseTimelineStartMs`),
`tests/audio/mix.test.ts` (moved/deleted phrase keeps take position),
`tests/storage/dawExport.test.ts` (same, plus placeholder phrase name),
`src/ui/singer/RecordControl.test.tsx` (snapshot value on record).

Full suite (620 tests), lint, and build all green after the change.
