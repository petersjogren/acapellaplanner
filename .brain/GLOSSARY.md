# Glossary

The language of this repo. UI copy, domain names, and agent notes use these words.

Update this file in the same change as the code when you add, rename, or retire a term a singer, a preparer, or domain code uses. If the UI word and the code word differ, record both. Delete entries that no longer match HEAD. Do not promote a schema-only hook by writing it as if it shipped — those stay in the last section until the product uses them.

Link to `DECISIONS.md` for the why. Do not restate the README quickstart.

## Place and people

- **Booth.** The app. A room where you hear a guide and sing back. Not a DAW.
- **Preparer.** Desktop Chrome. Imports the ghost, marks phrases, sets the roster and sections, crops the sheet, reviews, exports.
- **Singer.** Same origin, later an iPad. Picks a part, hears a mix, records. Never names files, sets loops, or arms tracks.
- **Song / project.** One `Project` in this browser. Nothing syncs.

## Time

- **Ghost.** The lead vocal that carries text, vowels, rubato, and intention. Bonnie Herman’s track, in the method docs. `ghostTrackId` plus a blob.
- **Ghost ms.** The only clock. Bar and beat are not a second timeline.
- **Phrase.** A musical sentence on the ghost: `[startMs, endMs]`. Phrases do not overlap. Minimum 50 ms.
- **Play window.** What you hear and record. The phrase plus **head start** (`preRollMs`, 2000 on new phrases) and **crossfade tail** (`postRollMs`, 2000). Those windows may overlap neighbours. The phrase boundary does not. Missing `preRollMs` on disk means 0 — do not migrate old phrases to 2000.
- **Section.** A feel on a run of phrases (`fromPhraseId`–`toPhraseId`). Not its own time range. Sections must not share a phrase.
- **Follow the ghost.** Code: `ghost-follow`. Rubato. No click.
- **In time.** Code: `fixed-tempo`. Optional click, and only inside that section.
- **Click.** A 1 kHz tick on an in-time section. Never on rubato.

## Singing

- **Part.** A voice on the roster (`shortLabel`, e.g. S1, A2). **Doubles** are `targetTakes` (default 4). Density comes from humans, not a chorus plugin.
- **Cell.** One phrase × one part. Status is `not-started`, `in-progress`, `enough`, or `final`.
- **Pass.** One Record press, one playback, one recorder. Then Hear / Keep / Scrap.
- **Sing through** (a.k.a. multi-phrase Record). A per-press, default-off toggle next to Record. Resets every press. When on, one Record press covers a **run** instead of stopping at the current phrase’s play-window end. See `DECISIONS.md` → “Sing-through / multi-phrase Record”.
- **Run** (a.k.a. span). An unbroken, adjacent sequence of phrases sung in one sing-through pass. On disk: `Take.spanPhraseIds`, ordered, first entry is the take’s `phraseId`. A performance grouping, not a section — no tempo semantics, and it need not line up with section boundaries.
- **Spanning take.** A `Take` whose `spanPhraseIds` covers more than one phrase. Credits every covered cell independently. Keep, Scrap, and rating apply to the whole take (no partial keep). Per-phrase Hear seeks into the shared blob by that phrase’s offset from the run start, the same way `latencyCompMs` skips into a buffer.
- **Keeper.** What later doubles hear, and what stem export prefers. **Scratch** is kept but not in the stack. Stars 1–5 exist in Review and do not drive the stack. Code: `rating === 'keeper'`.
- **Good enough / Next.** Both mark the cell `enough`. The session planner then skips it.
- **Enough.** The singer says this line can rest. **Final** is the preparer override. Completion is re-derived on every save (`deriveCompletion`).

## What you hear

- **Ghost Focus.** Ghost full, keepers silent. First doubles.
- **Stack Build.** Ghost down, keepers up. Later doubles. Default for the YouTube film.
- **Blend Check.** Ghost muted. Does the choir hold alone?
- **Line up.** Default latency check: 880 Hz bleed-through. Device profile in `localStorage`. Applied as a buffer skip (`latencyCompMs`), never by moving the phrase.
- **Clap with the click.** The other latency check. Same saved profile.
- **Play.** Follow the sheet. No recording. **Once through**, **Loop this phrase**, **Loop this section**. Play windows are phrase boundaries, not the recording play window.

## The sheet

- **Score film** (sheet film). `project.sheetCrops`. One ordered strip for the whole song. Phrases do not own crops.
- **Crop / rect.** A region of a sheet page in normalized page space (`regionNorm`, 0–1).
- **Crop draft.** Ephemeral rects on Prepare (`CropDraft`). Lost on navigate-away or sheet-doc switch. Only **Add all** or **Replace film** writes `sheetCrops`.
- **Film position.** The badge on a staged rect. Page-major, then that page’s array order. Not sorted by geometry — a top-then-left sort breaks two-column music.
- **Pin.** A Play click that ties a ghost ms to a content fraction `u` along the film (`filmPins`). Warps the camera. Does not reorder slides. **Clear all** drops them. Do not pin on Prepare.
- **Occupied time.** The camera moves only while a phrase is sounding. It holds in the gaps. No pins means a uniform occupied-time camera, edge-flush.

## Files

- **`.acapella.zip`.** Round-trip. `project.json` plus every blob. **Import forks**: new project id, new blob ids, title `(imported)`. Never overwrites an existing song.
- **`.stems.zip`.** One-way WAVs for a DAW. Padded from ghost 0:00. Default is keepers, one track per part (**lanes**).
- **`.film.mp4`.** One-way YouTube export from Review. Not a zip. Do not merge the three formats.
- **Blob.** Audio or page image in IndexedDB. A take points at one. The zip is how a blob leaves the device.

## Rules (say these)

- Ghost ms is the clock.
- Headphones are the score. The sheet is a cue.
- Click only in an in-time section.
- One Record press is one pass.
- Keepers are the stack.
- The zip is the bus. There is no server copy.
- Film order is append order. A wrong order is redrawn, not sorted.
- Optional fields do not bump the schema. A breaking `Project` shape does.

## In the schema, not in the product

Say these only if you mean the unused hook: **tonal guide**, **reference-stack**, **MusicXML**, **OPFS**, user **mix presets** (`project.mixPresets` is always empty; the three builtins are the product), **pan** (stored, never applied).
