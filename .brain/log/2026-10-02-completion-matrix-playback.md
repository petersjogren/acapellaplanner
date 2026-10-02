# Completion matrix becomes playable

Prepare's completion matrix ("What's left") was read-only — a table of
`n/target` counts and keeper-count dots, derived only from `deriveCompletion`.
It had no connection to playback.

## What changed

- `CompletionMatrix` (`src/ui/preparer/CompletionMatrix.tsx`) now takes
  `playingPhraseId`, `playingTakeId`, `onPlayPhrase`, `onPlayTake`. It builds
  a per-cell `Take[]` (sorted by `takeIndex` — chronological, not
  keeper-first as before) instead of reading `CompletionCell` counts, since
  each take is now an individually clickable `<button>` dot.
- Phrase-name column header is a button: pressing it plays that phrase
  (ghost + stack, same `loadPlaybackMixForPhrase` + click-track recipe the
  existing Listen panel uses) through the page's shared `mixPresetId`.
  Pressing again (or while playing) stops it — simple toggle, no Loop from
  the matrix.
- Each take dot is a button: pressing it plays that one take **solo**
  (`loadTakeReviewMix(..., mode: 'solo')`, the same recipe `TakeReview` /
  `ReviewPage.handlePlayTake` use) — "as it is", nothing else layered in.
  Independent of the phrase toggle.
- `PreparePage` gained `matrixPlayingPhraseId` / `matrixPlayingTakeId` state
  and `handleMatrixPlayPhrase` / `handleMatrixPlayTake`, both routed through
  the existing single `PlaybackEngine` instance. Starting any playback
  (Listen panel, mark-along, the other matrix control) clears whichever
  matrix-playback state was active, since only one thing can play at once.
- A second, compact `MixPresetSelect` ("Headphones") sits next to the
  matrix, bound to the same `mixPresetId` state as the Listen panel's
  selector — one shared preset, rendered in two places.

No schema change. No new mix primitives — this is wiring over
`loadPlaybackMixForPhrase` / `loadTakeReviewMix`, which already existed for
the Listen panel and Review/TakeReview respectively.

## Docs

- `.brain/GLOSSARY.md`: added **Completion matrix** (previously only
  described in code comments as "What's left").
- `.brain/CURRENT.md`: "Just landed" entry.

## Tests

- `src/ui/preparer/CompletionMatrix.test.tsx`: dot chronological ordering,
  phrase-header play/stop toggle, take-dot play wiring.
- `tests/pages/PreparePage.test.tsx` (`PreparePage completion matrix`
  describe block): phrase-name play/stop round trip, take-dot solo play +
  stopped by phrase-name press, and the two Headphones selects sharing
  state.

`npm test`, `npm run lint`, `npm run build` all pass.
