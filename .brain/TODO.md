# TODO / debt

Active product work is whatever the user asks next. This list is **code-backed**, not a roadmap.

## Schema / storage leftovers

- `AudioBlobRecord.opfsKey` — planned OPFS path, unused. All audio is IDB Blobs.
- `project.mixPresets` — always `[]`; runtime uses `builtinMixPresets()`.
- `Phrase.sectionId`, `preRollBeats` — unused. Section membership is computed from spans.
- `LoopPolicy.mode` includes `section-continuous` / `once`; booth always `loop: false`. Play mode loops a phrase or section at runtime using `loopDefault.gapMs` and does not persist `LoopPolicy`. Preparer preview can loop.
- Guide kinds `tonal` / `click` / `reference-stack` and sheet source `musicxml` — schema only.
- Numeric take ratings exist in Review; session/export logic treats **`rating === 'keeper'`** as the stack.

## Blob lifetime holes

- `removePart` drops takes from JSON but does not `deleteAudioBlob`.
- Replacing a ghost writes a new blob and does not delete the old one.
- Scrap in RecordControl **does** delete the take blob. Review has no scrap/delete-take UI (uncertain whether that’s intentional).
- `removePhrase` still leaves orphaned takes' blobs in place (by design now — see Engine / mix; those takes stay playable via `Take.timelineStartMs`), but there is no UI affordance telling the singer/preparer which takes are orphaned, nor a way to clean up their blobs if the user actually wants them gone.

## Engine / mix

- `pan` is stored on mix layers and never applied (no StereoPanner).
- `take.durationMs` is wall-clock from `Date.now()` around MediaRecorder, not decoded length. DAW export therefore **must** `bindDecodedDuration` before `assignLanes`.

## Platform / CI

- No PR CI — lint/test run only on the manual Pages workflow.
- iPad mic, Home Screen permission, and MediaRecorder mime are **manual**. Chrome is the supported recorder if Safari blocks.
- Google Fonts missing offline; UI falls back to Georgia / Helvetica Neue.

## Product (from original plan, still true)

- **Play sheet crops jump at phrase boundaries.** v1 reuses `SheetCue` per phrase (`phraseForPlayhead` swaps the active phrase). Crossing a boundary remounts a new crop/filmstrip — a hard cut, not a continuous scroll. Adjacent phrases that share a line of music (or a multi-crop sequence that should feel like one strip across the song) will snap. A whole-song filmstrip vs page+highlight-box vs smarter crossfade needs design, not a quick patch. Do not “fix” this by concatenating `sheetRefs` until that design exists.
- No multi-device sync (zip is the bus). Zip import forks a new project (own id, own blobs) instead of overwriting — safe for one-preparer/many-singers fan-out, but there is still no way to merge N singers' returned projects' takes back into one project; combining them today means DAW stem export from each and mixing externally.
- No tonal guide layer under the ghost.
- No auto phrase-split by silence.
- No Tauri / desktop wrapper.
- UI English only.

When closing an item, delete it here and note the decision in `DECISIONS.md` if behaviour changed.
