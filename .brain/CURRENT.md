# Current state

As of 2026-09-17 (branch `main`).

Working **desktop Chrome MVP**, live on GitHub Pages. iPad Safari booth is documented with mic/PWA caveats, not proven in CI. iPhone Safari (portrait + landscape) is responsive at the shell/page level — same layout as desktop/iPad above `md:`, not proven in CI (manual browser-emulation screenshots only).

## What works

- Home: create / rename / delete songs; import/export `.acapella.zip`.
- Prepare: ghost import, phrase mark/edit (incl. head start / crossfade tail), roster (unique short labels), sections as phrase spans (ghost-follow vs fixed-tempo + optional click), one sheet crop per phrase, completion matrix, phrase preview with mix presets.
- Sing: part picker / surprise-me, session suggestions, one-shot record, Hear (ghost/stack/solo), Keep / Scrap, Good enough / Next (both mark `enough`), Need more takes, mix presets, sheet cue.
- Review: rate (keeper/scratch/1–5), play take with/without ghost, all keepers on a phrase or whole song, project zip, **DAW stem zip** (lanes default, keepers-only default, size estimate).
- Calibrate: mic meter + **Check mic**; default **Line up** (880 Hz SNR); alternate **Clap with the click** (sequential Normal–Normal, MAD outliers, min 16 clicks, pair cap 400 ms); both auto-save the same `localStorage` profile; type-ms after a miss.
- PWA app-shell offline; IDB projects survive refresh.
- Schema v2 + migration from v1 section time ranges.

## Just landed

Zip import forks a new project instead of overwriting: `importProjectZip` still parses the zip unchanged, but `HomePage.handleImport` now runs the result through `forkProjectForImport` (`domain/project.ts`) before saving — fresh project id, fresh blob ids for every ghost/guide/take/sheet asset, and a title from `uniqueImportedTitle` (`"$title (imported)"`, `(imported 2)`, ...). Fixes the SATB fan-out/fan-in workflow: Preparer sends one project zip to N singers, each records and exports their own copy, and importing all N no longer collides on project id — every import lands as its own project next to the others instead of silently clobbering whichever project shared that id. Deleting a project is still the only way to free its id/title slot; import never does so implicitly. Does not merge N singers' takes into one project (still a manual DAW-stem-export-and-mix step) — see TODO.

Take timing survives phrase edits/deletes: `Take.timelineStartMs` snapshots `phraseTimelineStartMs(phrase)` at record time. Whole-song "All phrases" playback on Review (`loadAllKeepersMixForSong`) and DAW stem export (`planSegments`) both now prefer that snapshot over recomputing from the take's `phraseId`, so moving a phrase on Prepare (or deleting it outright) after singing no longer relocates or silently drops the already-recorded take. Old takes without the field fall back to a live phrase lookup as before. See `.brain/LEARNINGS.md` "Take timing survives phrase edits".

iOS Safari audio-session unlock: on the first user gesture anywhere in the app, a silent looping `<audio>` element is started (`unlockIOSAudioSession` in `src/audio/context.ts`, invoked from `App.tsx`). This flips iOS Safari's audio session from "ambient" (muted by the hardware Ring/Silent switch) to "media" (unaffected), so `AudioContext` playback is audible everywhere, not just on pages that happen to call `getUserMedia()` first. Fixes Prepare's `Play ghost` mark-along being silent on iPhone Safari while Sing's Record (which calls `getUserMedia`) worked. Not proven in CI (jsdom has no real audio session); manual iPhone Safari verification recommended.

Mark-along: Play ghost from 0 (ghost-only, once) auto-opens a phrase at 0 when that time is free; tap **New phrase** at each later line start. Stop without a tap commits `[0, now]` if the open interval is ≥ 50 ms. Drag-to-mark remains. Double-click unused space fills that gap. Click-select and Option-click-play unchanged.

New phrases persist a 2000 ms head start (`preRollMs`) and 2000 ms crossfade tail (`postRollMs`). Old songs and imported zips stay at 0 / missing — no schema bump, no parse-time default. Play-window math is unchanged.

PDF import on GitHub Pages: a tab left open across a deploy was requesting a deleted `pdfjsRender-*.js` chunk (Pages 404.html → “Failed to fetch dynamically imported module”). Dev was fine. The app now reloads once on that stale-chunk miss / SW replace.

Phone Safari responsive pass (no web layout change): `PreparerShell`/`SingerShell`/`HomePage` collapse nav and stack content below `md:`, safe-area insets via Tailwind arbitrary values (not inline `style`, which silently zeroed padding — see LEARNINGS), display/lyric type scales down under 430px width or short landscape height. `HomePage` song-list row (title/date/Rename/Export/Delete) stacks into a bordered card on phones instead of cramming onto one line; unchanged at `sm:`+.

Ghost timeline phrase overlays alternate gold / bronze (`--phrase-overlay` / `--phrase-overlay-alt`) by sorted start time so adjacent marks stay distinct. Panel `phrase-tint` is unchanged.

Click a phrase region on the ghost waveform to select it (same editor as the list). Option-click plays it once. Unused space keeps `cursor-ew-resize`; hovering a phrase uses a select arrow, and Option+hover uses a select+play cursor. Hint sits next to the drag copy.

Clap-with-click: longer train (up to 40 clicks) with early stop when the posterior is tight. MAD outlier drop, louder-peak replacement so click leak does not steal the clap, pairing capped below one beat so ~650 ms aliases cannot save.

## Not in the product yet (schema/UI leftovers)

See `TODO.md`. Mix presets, tonal guides, MusicXML, OPFS, phrase-loop in the booth, and multi-device sync are **not** implemented even where the schema has a hook.
