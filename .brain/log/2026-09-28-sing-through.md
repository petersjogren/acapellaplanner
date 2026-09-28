# Sing through

One Record press can cover an unbroken adjacent phrase run.

- Toggle next to Record, default off, consumed by the press.
- One `engine.play()` over the merged window (first head start through last tail) and one MediaRecorder. Not chained plays.
- `Take.spanPhraseIds` optional; first id is `phraseId`. No schema bump.
- Stop credits only phrases whose `endMs` the playhead has reached. Dead tail stays in the blob.
- Keep marks every spanned phrase enough, then `suggestNext`.
- Per-phrase hear-back adds `spanPhraseSkipMs` to the latency skip. Whole-song mix and DAW export still place the one blob at `timelineStartMs`.
