# Decisions

Record only choices that future work must not silently reverse.

## Product

- **Booth + planner, not a DAW.** Finish in a real DAW via stems. No auto-tune, no clip nudging.
- **Local-first, single device.** Zip is backup and the inter-device bus. No server copy of songs.
- **Ghost timeline is truth.** Sections are feels on a run of phrases (`ghost-follow` vs `fixed-tempo`), never a second clock.
- **Singer UX:** one Record press = one pass, then Hear / Keep / Scrap. Good enough and Next both mark the cell `enough` (session planner skips it).
- **Default stack density:** `targetTakes` default 4. Keepers (not star ratings) are what later doubles hear and what stem export prefers.
- **Deploy is manual.** Publishing on every `main` push is explicitly unwanted.

## Schema

- **v2 (2026-09):** Section is `fromPhraseId`/`toPhraseId`. v1 `[startMs,endMs]` migrated by claiming phrases that overlap the old region in timeline order; empty regions dropped. `ProjectSchema` describes **only** current shape; history lives in `migrations.ts`.
- Unversioned historical JSON is implicit v1 (`withVersionStamped`).
- Optional field additions do not bump `schemaVersion`.

## Audio / export

- Decode and play share one AudioContext.
- Mix recipes are three builtins (Ghost Focus / Stack Build / Blend Check), not a user mixer. Take review: ghost / stack / solo. Review page all-keepers: with-ghost / no-ghost, one phrase or whole song.
- Stem format: 16-bit PCM WAV, mono, decode-context sample rate (no extra resampler). Absolute pad from 0:00. Default **lanes**, keepers-only. Naming: `Bass/Bass_A.wav` vs `Bass/B_p1_t1.wav`.
- Lane assignment is greedy interval colouring **after** `bindDecodedDuration`. Do not assign on metadata duration.
- WAV PCM scaling is symmetric `* 32767` (not −32768) to avoid DC tick on looped material.

## Hosting

- GitHub Pages project site. `404.html` clone of `index.html` for SPA reloads. PWA scope follows `BASE_PATH`.
