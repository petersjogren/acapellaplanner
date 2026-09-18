# Zip import forks a new project, never overwrites

User asked for the SATB fan-out/fan-in workflow (Preparer sends a zip to
four singers, each sings their part and sends a zip back) to stop clobbering
projects. Previously `importProjectZip` kept the source project's id, and
`HomePage.handleImport` called `repo.saveProject(project)` — a Dexie `put()`
keyed by that id — so re-importing any singer's zip **overwrote** whatever
project already had that id, silently discarding every other singer's takes
imported before it. Confirmed by reading `ARCHITECTURE.md`'s own line 51
("Zip import keeps original ids and `put`s over any existing project with
the same id") plus the code path.

Fix, scoped to the option the user picked (fork-only; no cross-project
take merge):

- Added `forkProjectForImport(project, { title })` (`domain/project.ts`,
  pure): gives the imported project a brand-new `id`, fresh
  `createdAt`/`updatedAt`, the caller-supplied title, and **remaps every
  blob id it references** (ghost, guide, take, sheet doc/page) to fresh
  UUIDs via an internal `Map`, returned to the caller as `blobIdMap`. Blob
  ids are remapped (not reused) because `AudioBlobRecord.projectId`
  exclusively ties a blob row to one project — sharing an id across two
  projects would make `deleteProject` on either one silently orphan the
  other's audio.
- Added `uniqueImportedTitle(title, existingTitles)`: appends
  `" (imported)"`, then `" (imported 2)"`, `" (imported 3)"`, ... so
  repeated imports of the same song (one per singer) get distinct titles
  Preparer can tell apart at a glance without any manual renaming.
- `HomePage.handleImport` now: parses the zip via the existing
  `importProjectZip` (unchanged — it does not touch storage), computes the
  unique title against currently-listed project titles, forks via
  `forkProjectForImport`, stores each blob under its *remapped* id with
  `projectId: <the new fork's id>`, then `saveProject`s the fork. The
  original project (if the zip's source id happens to still exist on this
  device) is never read or written.
- Deleting an existing project is still the only way to reclaim its id/slot
  — importing never does it implicitly. Matches the user's explicit ask:
  "No overwrite of existing project (you have to delete it first if you
  want that)" — though in practice you now never *need* to delete anything
  to import, since imports no longer collide on id at all.

`importProjectZip`/`exportProjectZip` themselves are unchanged — the fork
happens one layer up, after parsing, so the zip format and round-trip
contract (`.acapella.zip`) stay exactly as documented.

Tests: `tests/domain/project.test.ts` (`uniqueImportedTitle`,
`forkProjectForImport` — fresh id/title, ghost blob remap, take blob remap
incl. two takes never colliding, same source blob id referenced twice maps
to one forked id, two forks of the same source never collide with each
other). `tests/pages/HomePage.test.tsx` rewritten: "imports a project zip as
a new project, not overwriting the original" (asserts both projects coexist
with independent blobs) and "numbers repeated imports of the same song
apart" (two sequential imports of the same zip land as `(imported)` and
`(imported 2)`). Existing zip-slip/extra-blob test updated to read the
forked project's remapped ghost id instead of assuming a stable id.

Full suite (630 tests), lint, `tsc -b`, and `vite build` all green.

Known gap left open (not asked for this round): this only solves fan-out
(no clobbering). It does **not** merge N singers' takes into one project —
after four imports you have five projects (original + 4 forks) and would
need to combine them manually (e.g. DAW stem export from each, mixed
externally) to hear the whole SATB stack together. That's option 1
("voice-part-scoped merge") from the earlier discussion, not built here.
