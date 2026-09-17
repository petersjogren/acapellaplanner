# Decisions

Record only choices that future work must not silently reverse.

## Product

- **Booth + planner, not a DAW.** Finish in a real DAW via stems. No auto-tune, no clip nudging.
- **Local-first, single device.** Zip is backup and the inter-device bus. No server copy of songs.
- **Ghost timeline is truth.** Sections are feels on a run of phrases (`ghost-follow` vs `fixed-tempo`), never a second clock.
- **Singer UX:** one Record press = one pass, then Hear / Keep / Scrap. Good enough and Next both mark the cell `enough` (session planner skips it).
- **Default stack density:** `targetTakes` default 4. Keepers (not star ratings) are what later doubles hear and what stem export prefers.
- **Deploy is manual.** Publishing on every `main` push is explicitly unwanted.
- **Phrase overlay tints (2026-09):** even/odd by `sortPhrases` order (gold vs bronze), not gap-based colouring and not slate/forest (those are section/voice).
- **Waveform phrase click (2026-09):** click selects, Option-click plays once. Click vs mark-drag is pointer travel (`TIMELINE_CLICK_PX` 8), not `MIN_PHRASE_MS` — on a long ghost 50 ms is sub-pixel. Unused space keeps `ew-resize`.
- **Waveform gap double-click (2026-09):** double-click unused space fills the gap (`gapContainingMs`). A double-click on a marked region does not create.
- **Phrase mark-along (2026-09):** Play ghost (ghost-only, once, from 0) auto-opens at 0 when 0 is free; first tap commits `[0, tap]`. Later taps are phrase starts. Adjacent marks are `[start,end]`; `addPhrase` still writes 2000/2000 rolls. Stop without taps commits `[0, now]` if ≥ 50 ms. No tap compensation. No Continue-from-last-phrase. Drag-to-mark stays for gaps/repair. Selecting a phrase during a pass does not persist. Listen cannot steal the engine mid-pass.

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
