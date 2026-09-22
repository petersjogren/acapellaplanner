# Conventions

## TypeScript / imports

- ESM with **`.ts` / `.tsx` extensions** on relative imports (`verbatimModuleSyntax`, `allowImportingTsExtensions`).
- `import type` for types. Prefer named exports.
- Strict: `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`.
- Domain mutations return a **new** `Project` (spread). Throw on invalid user input (empty name, overlap, missing BPM for in-time).

## Where code goes

- New project invariants → `src/domain/schemas.ts` + a pure function in the matching domain module + `tests/domain/…`.
- Breaking schema shape → bump `CURRENT_SCHEMA_VERSION`, add a step in `src/domain/migrations.ts`, fixture-test the old JSON. Optional fields do not need a bump.
- Web Audio scheduling / capture → `src/audio/`, not pages.
- IndexedDB / zip / WAV bytes → `src/storage/`.
- Canvas/WebCodecs film encode → `src/export/`. Pages call `exportFilmMp4`; do not mux in storage or pages. Pixel math stays in `domain/sheets.ts`.
- PDF.js stays behind `src/pdf/renderPage.ts` so tests can stub `setRenderPageToCanvas`.

## UI

- Preparer chrome: `PreparerShell` (Prepare / Sing / Play / Review). Singer: `SingerShell` — large lyric type, almost no chrome. Play uses SingerShell (follow-along, no Record). Sing/Play booth is `BoothLayout` (film fills leftover height; dock stays on screen).
- Copy is singer language (“Good enough”, “Hear it”, “Line up headphones”), not DAW jargon.
- Studio palette lives in `src/styles/tokens.css` (`paper` / `ink` / `record-red` / gold-slate-forest tints). Prefer tokens over new hex. Honour `prefers-reduced-motion`.
- Do not add a mixer. Mix changes go through the three builtin presets (and take-review modes).
- `messageFrom(error, fallback)` is duplicated per page — fine; don’t invent a shared util unless a fourth copy appears.

## Persistence pattern (pages)

```ts
function persistProject(mutate: (current: Project) => Project): Promise<void> {
  // chain on writeQueueRef; read projectRef.current, not React state
  // saveProject({ ...next, completion: deriveCompletion(next) })
}
```

Never fire overlapping `saveProject` from click handlers without the queue. After RecordControl work, `flushSaves()` first.

## Tests

- Vitest + jsdom (`tests/setup.ts` stubs `URL.createObjectURL`).
- **Colocated** `*.test.tsx` next to UI components under `src/ui/`.
- **Mirrored** tests for domain/audio/storage/pages/app/build/export under `tests/<area>/`.
- Dexie tests: `import 'fake-indexeddb/auto'` at the top of **that file** (not global setup).
- Inject `ProjectRepository` via `AppRoutes({ repo })` / context. Don’t hit the default DB from unit tests.
- Engine/schedule tests are fake-clock + stubbed AudioContext — they do not prove Safari/iPad behaviour.

## Commits / product

- One concern per commit (existing history is `feat(area):` / `fix(area):`).
- User-facing behaviour changes belong in `README.md` when they affect preparer/singer workflow or export.
- Do not bundle demo audio.
- `npm run lint` (oxlint) is **not** run in CI on push/PR — the only workflow is `deploy.yml`, manual (`workflow_dispatch`) only, which lints+tests right before a Pages deploy. Run `npm run lint` yourself after any code change; don't rely on CI to catch it.

## What “done” means for audio features

If playback, recording, or export alignment changes: update **both** the play-window math (`audio/schedule.ts`) and every consumer that hard-codes the same formula (mix song playback `startDelayMs`, DAW `segmentStartMs`). A mismatch puts stems late by `preRollMs`.
