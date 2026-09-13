# Acapella Planner

A ghost-track overdub booth for stacked a cappella — not a DAW. The ghost’s phrasing is the clock; the singer only listens and sings back.

Local-first. Desktop Chrome MVP; iPad Safari as a booth once the song is prepared.

## Preparer quickstart

1. **New song** on the home desk. **Rename** it from the list or from the top of Prepare; **Delete** on the list removes a song and its audio (one confirm step).
2. **Import ghost track** — a lead vocal (Bonnie Herman–style: text, feel, rubato, intention). Any mono or stereo guide audio works.
3. **Mark a phrase** on the ghost — musical sentences and breaths, not arbitrary bars. Name them; add lyrics if you have them.
4. **Voice parts** — add the roster (S1, A2, …) and how many doubles you want on each.
5. **Sections** — mark stretches as *Follow the ghost* (rubato, no click) or *In time* (optional click only inside that window).
6. Open **Sing** for the booth, or **Review** later to promote keepers and export a zip.

Optional: crop sheet music onto a phrase so the booth shows only that cue.

## Singer quickstart

1. Open **Sing**. Pick a part, or *Surprise me with what’s left*.
2. Headphones on. Choose a mix: **Ghost Focus**, **Stack Build**, or **Blend Check**.
3. Tap **Record** or **Space**. One pass records, then **Hear it** / **Keep it** / **Scrap & again**.
4. **Good enough** when the line can rest. **Next** for the following phrase on the same part.

You never name files, set loops, or arm anything. Phrases, breaths, doubles — that’s the whole job.

Full method: [Singers Unlimited workflow](docs/workflow-singers-unlimited.md).

## Moving a song between devices

**Songs live in the browser on one device.** They are stored in IndexedDB, which
is per-origin *and* per-device — a song prepared on a laptop does not appear on
the iPad, and clearing site data deletes it. Nothing syncs, and there is no
server holding a copy.

The zip is how a song travels, and how it is backed up:

- **Export** — on the home desk (next to each song) or from **Review**. Produces
  `<song-title>.acapella.zip` containing `project.json` (phrases, sections,
  voice parts, sheet crops, take ratings) plus every audio file under `audio/`:
  the ghost, the takes, and any sheet PDF or page images.
- **Import zip** — on the home desk. Restores the whole song, audio included.

Export before clearing browser data, before switching device, and after a
session worth keeping. The zip round-trips: import what you exported and the
song is intact.

The zip is a round-trip/backup format, not a DAW session: takes are
phrase-length Opus files named by blob id, positioned via `project.json`.

## Develop

```bash
npm install
npm run dev
npm test
npm run build
```

- `npm run preview` — serve the production build
- `npm run test:watch` — Vitest watch mode

Stack: Vite + React + TypeScript, Tailwind CSS v4, Dexie, Zod, React Router.

## Deploy to GitHub Pages

**One-time setup, required before the first deploy:** in the repository,
**Settings → Pages → Source → GitHub Actions**. Until that is set, the workflow
fails at *Configure Pages* with `Get Pages site failed … Not Found` — the token
a workflow gets cannot enable Pages by itself.

After that, pushing to `main` builds and publishes via
`.github/workflows/deploy.yml` (lint and tests must pass first).

The site is served from `https://<user>.github.io/acapellaplanner/`, so the build
needs that prefix. It comes from `BASE_PATH`, which the workflow derives from the
Pages configuration — renaming the repo does not break asset paths. Building
locally defaults to `/acapellaplanner/`; use `BASE_PATH=/ npm run build` for a
root-served host (custom domain or a `<user>.github.io` repo).

Two details make a client-routed PWA work there:

- **`404.html`** — GitHub Pages has no rewrite rule, so a reload of
  `/project/<id>/sing` would 404. `vite/githubPagesSpaFallback.ts` emits a copy
  of `index.html` as `404.html`; Pages serves it and the router takes over.
- **`basename`** — `BrowserRouter` is given `import.meta.env.BASE_URL` so routes
  resolve under the subpath.

HTTPS is required for microphone access, and Pages provides it.

**Hosting does not make songs shared or portable** — each browser keeps its own
IndexedDB. See [Moving a song between devices](#moving-a-song-between-devices).

## Offline PWA / iPad booth

Production builds (`npm run build`) generate a web app manifest and a Workbox service worker (`sw.js`) that caches the **app shell** (`index.html`, JS, CSS, icons). Existing projects stay in IndexedDB on the device, so they still work offline. The service worker does **not** cache audio blobs — those are already local.

Install: Chrome/Edge → install icon, or Safari on iPad → Share → Add to Home Screen. The app opens `standalone`, scoped to the path it was built for (`/acapellaplanner/` on GitHub Pages, `/` when built with `BASE_PATH=/`).

### Safari microphone (iPad)

`getUserMedia` requires a **secure context**: HTTPS or `localhost`.

1. Settings → Safari → Microphone → Allow (or Ask). If this is Deny, a Home Screen app cannot record either.
2. Open the booth over HTTPS (or `npm run dev` / `npm run preview` on localhost).
3. Share → Add to Home Screen for the standalone booth.
4. Tap Record and Allow the microphone prompt.

**Known limitations**

- Mic permission is granted only after a user gesture (tap Record).
- Google Fonts may be missing offline; UI falls back to Georgia / Helvetica Neue.
- iPadOS may still prompt again after adding to Home Screen — allow it there too.
- If Safari blocks the mic, record on desktop Chrome instead.

### Manual smoke checklist

- [ ] Import a ghost track
- [ ] Mark 3 phrases
- [ ] Define 3 voice parts
- [ ] Record a take
- [ ] Refresh: project and take still present
- [ ] Export
- [ ] Follow the ghost: no click
- [ ] In time: click in the section window
- [ ] iPad mic works, or desktop Chrome fallback as documented above
