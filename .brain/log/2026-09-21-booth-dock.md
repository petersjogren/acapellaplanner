# 2026-09-21 — Sing/Play dock booth

Film is leftover viewport, full width of main (shell margins). Record / Play / Good enough sit in a sticky dock (`BoothLayout`), shared by Sing and Play.

`SheetCue` dropped `max-w-xl` and the 220px box. Slide height is the measured figure; `SHEET_CUE_SLIDE_HEIGHT_PX` is unmeasured fallback. Single crop contains in the viewport. Camera math and iPad crop layout unchanged.

Fix: first dock pass used `min-h-dvh` + `h-full` on the figure, so the film slot computed to 0 and `overflow-hidden` clipped the strip. Shell is now `h-dvh`; the cue is `absolute inset-0` in a `relative flex-1` slot.
