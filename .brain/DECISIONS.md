# Decisions

Record only choices that future work must not silently reverse.

## Product

- **Booth + planner, not a DAW.** Finish in a real DAW via stems. No auto-tune, no clip nudging.
- **Local-first, single device.** Zip is backup and the inter-device bus. No server copy of songs.
- **Zip import always forks a new project (2026-09).** Never `put`-overwrites an existing project by id, even when the zip's embedded id matches one already on the device. `forkProjectForImport` (`domain/project.ts`) gives every import a fresh project id, fresh blob ids for everything it references, and a title from `uniqueImportedTitle` (`"$title (imported)"`, then `(imported 2)`, ...). This is how SATB fan-out/fan-in works: Preparer sends one zip to N singers, each sings and returns their own zip, and importing all N lands as N separate projects side by side — never silently discarding an earlier singer's takes. Reclaiming a project's "slot" (freeing its title/id) still requires an explicit delete first; import itself never deletes or replaces. Combining N singers' takes into one project is still manual (no merge tool) — see TODO.
- **Ghost timeline is truth.** Sections are feels on a run of phrases (`ghost-follow` vs `fixed-tempo`), never a second clock.
- **Singer UX:** one Record press = one pass, then Hear / Keep / Scrap. Good enough and Next both mark the cell `enough` (session planner skips it).
- **Default stack density:** `targetTakes` default 4. Keepers (not star ratings) are what later doubles hear and what stem export prefers.
- **Deploy is manual.** Publishing on every `main` push is explicitly unwanted.
- **Phrase overlay tints (2026-09):** even/odd by `sortPhrases` order (gold vs bronze), not gap-based colouring and not slate/forest (those are section/voice).
- **Waveform phrase click (2026-09):** click selects, Option-click plays once. Click vs mark-drag is pointer travel (`TIMELINE_CLICK_PX` 8), not `MIN_PHRASE_MS` — on a long ghost 50 ms is sub-pixel. Unused space keeps `ew-resize`.
- **Waveform gap double-click (2026-09):** double-click unused space fills the gap (`gapContainingMs`). A double-click on a marked region does not create.
- **Phrase mark-along (2026-09):** Play ghost (ghost-only, once, from 0) auto-opens at 0 when 0 is free; first tap commits `[0, tap]`. Later taps are phrase starts. Adjacent marks are `[start,end]`; `addPhrase` still writes 2000/2000 rolls. Stop without taps commits `[0, now]` if ≥ 50 ms. No tap compensation. No Continue-from-last-phrase. Drag-to-mark stays for gaps/repair. Selecting a phrase during a pass does not persist. Listen cannot steal the engine mid-pass.
- **Multi-crop sheet cue (2026-09):** a phrase's `sheetRefs` may now hold more than one crop, in append order (`addSheetRefToPhrase`); `bindSheetRefToPhrase` still exists for the "just replace it" one-crop path used by the original drag-and-bind flow. The booth renders every crop as a slide in a horizontal filmstrip, each sized to its own true aspect ratio at a shared fixed height (`SHEET_CUE_SLIDE_HEIGHT_PX`) — never an equal-width share of the track — so a 4:4 crop next to a 16:4 crop renders at 1x vs 4x width and neither is stretched. Scroll is a real hard-left-to-hard-right sweep of the whole strip: `sheetScrollFrame` returns `{ slides, progress }` where `progress` is a plain 0–1 ratio of elapsed/duration (phrase's own `[startMs,endMs]`, not the play window with pre/post-roll); the UI maps 0 to the strip's own left edge flush with the viewport's left edge (every part of the first crop visible from the start) and 1 to the strip's own right edge flush with the viewport's right edge (last crop's right edge exactly at the edge, zero trailing empty space), clamping the scroll range to `max(0, totalWidth - viewportWidth)` so a strip narrower than the viewport never scrolls at all. `SheetCue` measures the viewport with a **callback ref** (`useState`, not `useRef`), not a ref + empty-deps effect — the caller resolves crop images asynchronously so the real `<figure>` often first mounts several renders in, and a plain `useRef`/`useEffect(fn, [])` only fires once at the component's very first commit (with no element yet), permanently stuck at viewport width 0 — which made `maxScrollPx` equal the strip's whole width and scrolled everything, including the last crop, off past the left edge at elapsed = duration. `SingPage` dedupes `URL.createObjectURL` calls by blob id (two crops can share one page) and only samples `engine.getPositionMs()` on a rAF loop when the phrase has 2+ crops.

## Schema

- **v2 (2026-09):** Section is `fromPhraseId`/`toPhraseId`. v1 `[startMs,endMs]` migrated by claiming phrases that overlap the old region in timeline order; empty regions dropped. `ProjectSchema` describes **only** current shape; history lives in `migrations.ts`.
- Unversioned historical JSON is implicit v1 (`withVersionStamped`).
- Optional field additions do not bump `schemaVersion`.
- **New-phrase rolls (2026-09):** `addPhrase` writes `preRollMs`/`postRollMs` = 2000. Missing `preRollMs` on disk still means 0. Do not Zod-default or migrate old phrases to 2000.

## Audio / export

- Latency lineup: default **tone bleed-through** (880 Hz SNR). Alternate **clap-with-click**: sequential Normal–Normal on MAD inliers, min 16 closed clicks, pair latency capped at 400 ms (below one beat at 100 BPM), louder-peak replacement for headphone click leak. Shared mic meter + Check mic. Manual ms after a miss. Still buffer skip, never phrase shift.
- Decode and play share one AudioContext.
- Mix recipes are three builtins (Ghost Focus / Stack Build / Blend Check), not a user mixer. Take review: ghost / stack / solo. Review page all-keepers: with-ghost / no-ghost, one phrase or whole song.
- Stem format: 16-bit PCM WAV, mono, decode-context sample rate (no extra resampler). Absolute pad from 0:00. Default **lanes**, keepers-only. Naming: `Bass/Bass_A.wav` vs `Bass/B_p1_t1.wav`.
- Lane assignment is greedy interval colouring **after** `bindDecodedDuration`. Do not assign on metadata duration.
- WAV PCM scaling is symmetric `* 32767` (not −32768) to avoid DC tick on looped material.

## Hosting

- GitHub Pages project site. `404.html` clone of `index.html` for SPA reloads. PWA scope follows `BASE_PATH`.
- PWA `autoUpdate` stays on (new SW takes over without a prompt). The open tab reloads once when that happens, otherwise lazy pdfjs chunks 404 after a deploy. First-visit SW claim does not reload.
