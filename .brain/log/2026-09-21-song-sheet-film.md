# 2026-09-21 Song-level sheet film

Crops moved off phrases onto `project.sheetCrops` (schema v3). Prepare appends to the film; Play and Sing share `filmScrollProgress` (occupied phrase-time, hold in gaps) → edge-flush `SheetCue`. No pins. Migration concatenates old `sheetRefs` and collapses consecutive identical rectangles.

Verified: `npm test` (680), `npm run lint`, `npm run build`.
