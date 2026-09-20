# 2026-09-20 — iPad Play multi-crop sheet ghosting

Two crops bound to one phrase scrolled on Play, then split into a diverging half-intensity copy of the sheet (iPad Safari). Nested `translate`+`scale` on each crop `<img>` inside the filmstrip's rAF `translateX`, plus a 100ms CSS transition on the track, made Safari double-paint the image.

Fix: crop with `left`/`top`/`width`/`height` (`max-width: none` vs Tailwind preflight); track still `translateX` with no CSS transition. Tests in `SheetCue.test.tsx`.
