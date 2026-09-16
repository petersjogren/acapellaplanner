# 2026-09-16 — Default 2 s head start and crossfade tail

New phrases from `addPhrase` persist `preRollMs: 2000` and `postRollMs: 2000` (`DEFAULT_PRE_ROLL_MS` / `DEFAULT_POST_ROLL_MS` in `src/domain/phrases.ts`).

Did not bump schema. Did not add a Zod default. Did not migrate existing phrases. Missing `preRollMs` on disk still means 0 at every play-window consumer. `updatePhrase` and the preparer editor are unchanged — the preparer can still set either field to 0.

Play-window formula, mix offsets, click grid, and DAW `segmentStartMs` were not touched.
