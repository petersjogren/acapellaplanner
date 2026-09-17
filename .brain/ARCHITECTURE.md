# Architecture

Layered client app. **Ghost audio time (ms) is the only clock.** Bar/beat exists only as an optional click overlay on a fixed-tempo section.

## Layers (dependency direction)

```
pages / ui  →  audio, storage, pdf, domain
audio       →  domain   (types + section window helpers)
storage     →  domain, audio/latency, audio/decode
pdf         →  (isolated; pdfjs behind renderPage seam)
domain      →  nothing else
```

`domain/` must stay pure: no React, Web Audio, IndexedDB, or DOM.
`markAlong.ts` is pure tap/stop math; still writes through `addPhrase`.
Pages compose domain mutations + repository I/O. Do not put Zod/schema rules in UI.

| Layer | Owns |
|---|---|
| `src/domain/` | `Project` document, Zod schemas, migrations, pure mutations |
| `src/audio/` | singleton AudioContext, decode, schedule, playback engine, record, mix, click, latency |
| `src/storage/` | Dexie, `.acapella.zip`, WAV/DAW stem zip |
| `src/pdf/` | PDF.js page → PNG; `setRenderPageToCanvas` for tests |
| `src/pages/` | routes, load/save queues, ghost buffer lifetime |
| `src/ui/{preparer,singer,shell,shared}` | presentational + a few local mutations (`applyTakeRating`) |
| `src/app/` | `AppRoutes`, `ProjectRepositoryContext` |

## Project document

One JSON `Project` (`CURRENT_SCHEMA_VERSION = 2`) plus blobs in IndexedDB `audioBlobs`.

- **Phrases**: non-overlapping `[startMs, endMs]` on the ghost. `preRollMs` / `postRollMs` extend the *play/record window* and **may overlap** neighbouring phrases. New phrases persist 2000/2000; missing `preRollMs` on disk still means 0.
- **Sections**: inclusive span of phrases (`fromPhraseId`/`toPhraseId`), not their own time range. v1→v2 migration maps old `[startMs,endMs]` onto overlapping phrases. Sections must not share a phrase.
- **Takes**: phrase + part + `takeIndex`, blob id, optional `rating` (`keeper` \| `scratch` \| 1–5), `latencyCompMs`, headphone mix snapshot.
- **Completion**: persisted but **re-derived on every save** (`deriveCompletion`). `partPlan.status` of `enough`/`final` is the singer/preparer override.
- **Guides / mixPresets / sheetDocs**: schema is wider than the UI. Runtime mix uses **builtin** presets in `audio/mix.ts`, not `project.mixPresets` (always `[]` today).

Untrusted input (IndexedDB row, zip `project.json`) goes through `migrateAndParseProject`, never `ProjectSchema.parse` alone. Newer-than-supported versions throw `UnsupportedProjectVersionError`.

## Persistence

Dexie DB name `acapellaplanner`: `projects` (`id, updatedAt`), `audioBlobs` (`id, projectId, kind, createdAt`). Blobs are `Blob`s in IDB. `opfsKey` is unused.

`createProjectRepository(db)` is the seam; tests inject a fake or a named Dexie instance via `ProjectRepositoryContext`.

Writes on Prepare / Sing / Review are serialized with `writeQueueRef` and always mutate `projectRef.current` (latest), not a stale React state snapshot. RecordControl has its own `saveChainRef`; SingPage `flushSaves()` before Good enough / Next.

`deleteProject` removes the row **and** that project’s blobs. Other mutations that drop take/guide references do **not** always delete blobs (see TODO).

Zip import **keeps original ids** and `put`s over any existing project with the same id.

## Audio engine

`getAudioContext()` is a **process-wide singleton**. Decode on it; never decode on a throwaway context then close (Safari rejects those buffers).

`createPlaybackEngine({ getBuffer })`:

- `play()` calls `stop()` first (generation bump cancels timers/sources).
- Ghost layer clips to audio that exists (`window.durationMs`).
- Takes / pass timing follow `requestedDurationMs` (the phrase span asked for). A short ghost must not cut recording or listen-back.
- Loop (preparer preview) schedules the next `BufferSource` `LOOP_LOOKAHEAD_MS` (100) before the audio-clock deadline.
- Booth recording is **one-shot** (`loop: false`). Record starts on `onPassStart`, persist on `onPassComplete` / `onEnded`.
- Click is a 1 kHz 20 ms oscillator, times from `clicksForPhrase` (fixed-tempo + clickEnabled only; grid origin = section window including first pre-roll and last post-roll).
- Mix `pan` is carried in types/snapshots and **not applied** in the engine (gain only).

Latency: device profile in `localStorage` (`acapellaplanner.latency`). Applied as a **buffer read offset** (`takePlaybackOffsetMs`), never by shifting phrase start. DAW export must trim the same leading ms.

Mic: `RAW_CAPTURE_CONSTRAINTS` (no AEC/NS/AGC). Fallback to `{ audio: true }` on `OverconstrainedError`. Warn if the track still has processing.

## Export

Two formats, do not conflate:

1. **`.acapella.zip`**: `project.json` + `audio/<blobId>.<ext>`. Round-trip. Includes every take. Zip-slip: only `audio/<id>` (no nested path).
2. **`.stems.zip`**: 16-bit mono PCM WAV + `README.txt`. Default keepers-only. Lanes (default) or per-take. Files padded from ghost 0:00. **Assign lanes after decode** (`bindDecodedDuration` then `assignLanes`). Edge fades 5 ms; min gap 10 ms. Unzipped size is mostly silence.

## Routing / PWA

`BrowserRouter` basename = `import.meta.env.BASE_URL` without trailing slash.
GitHub Pages has no rewrite: build emits `404.html` = `index.html` (`vite/githubPagesSpaFallback.ts`).
Workbox caches the **app shell**, not audio blobs (already in IDB).
`autoUpdate` activates immediately; `installStaleAssetReload` in `main.tsx` reloads once on `vite:preloadError` or a replacing `controllerchange` so hashed lazy chunks (pdfjs) cannot 404 after a deploy.
