# SheetCue consumes domain film layout

Live multi-crop film now uses `filmTrackLayout` / `cropAspect` / `containCropBox` from `domain/sheets.ts` instead of a local copy. `SheetCue` still owns `SHEET_CUE_SLIDE_HEIGHT_PX` (220 unmeasured fallback) and re-exports `containCropBox`. Crops stay layout `left`/`top`/`width`/`height`; only the track `translateX`s, no CSS transition. Pixel contract in `SheetCue.test.tsx` unchanged.
