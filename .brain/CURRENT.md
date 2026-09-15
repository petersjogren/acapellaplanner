# Current state

As of 2026-09-15 (HEAD `33b936f`, branch `main`).

Working **desktop Chrome MVP**, live on GitHub Pages. iPad Safari booth is documented with mic/PWA caveats, not proven in CI.

## What works

- Home: create / rename / delete songs; import/export `.acapella.zip`.
- Prepare: ghost import, phrase mark/edit (incl. head start / crossfade tail), roster (unique short labels), sections as phrase spans (ghost-follow vs fixed-tempo + optional click), one sheet crop per phrase, completion matrix, phrase preview with mix presets.
- Sing: part picker / surprise-me, session suggestions, one-shot record, Hear (ghost/stack/solo), Keep / Scrap, Good enough / Next (both mark `enough`), Need more takes, mix presets, sheet cue.
- Review: rate (keeper/scratch/1–5), play take with/without ghost, all keepers on a phrase or whole song, project zip, **DAW stem zip** (lanes default, keepers-only default, size estimate).
- Calibrate: mic meter + **Check mic**; default **Line up** (880 Hz SNR); alternate **Clap with the click** (median+MAD); both auto-save the same `localStorage` profile; type-ms after a miss.
- PWA app-shell offline; IDB projects survive refresh.
- Schema v2 + migration from v1 section time ranges.

## Just landed

Calibrate: live mic meter + **Check mic**. Default lineup remains 880 Hz SNR; **Clap with the click** (median+MAD) is the alternate. Both auto-save the same localStorage profile.

## Not in the product yet (schema/UI leftovers)

See `TODO.md`. Mix presets, tonal guides, MusicXML, OPFS, phrase-loop in the booth, and multi-device sync are **not** implemented even where the schema has a hook.
