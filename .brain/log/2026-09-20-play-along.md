# Play along (follow the sheet)

Singers can play the whole song while watching the sheet, without recording.

## What shipped

- Route `/project/:id/play` (`PlayPage`) in `SingerShell`, with Sing | Play tabs when a project is loaded. Studio nav (`PreparerShell`) also links Play.
- Once through / Loop this phrase / Loop this section. Nothing records. Mix presets reused.
- Sheet hops phrase-by-phrase via existing `SheetCue`; `phraseForPlayhead` holds the previous phrase in gaps.
- Jump = tap a phrase in the list. No scrub bar.
- Pause/resume only for once-through. Looping is Play/Stop (a mid-loop resume would shrink the loop window).
- Play windows are phrase boundaries, not pre/post-roll. Whole-song keepers are rebased with `rebaseMixToPlayStart`; phrase-loop keepers skip `preRollMs` via `shiftMixLayerOffsetMs`.
- Engine `getPositionMs` wraps across loop passes and freezes during the gap.

No schema bump. `LoopPolicy.mode` is still not persisted; Play reads `loopDefault.gapMs` only.

## Open: sheet crops jump

Phrase-hopping remounts `SheetCue` at every phrase boundary, so the crop hard-cuts instead of scrolling as one strip across the song. Adjacent phrases that share a staff line will snap. Do not concatenate `sheetRefs` as a shortcut — whole-song filmstrip vs full-page highlight vs crossfade needs a design pass. Tracked in `.brain/TODO.md`.
