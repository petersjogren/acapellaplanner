# Acapella Planner

A ghost-track overdub booth for stacked a cappella — not a DAW. The ghost’s phrasing is the clock; the singer only listens and sings back.

Local-first. Desktop Chrome MVP; iPad Safari as a booth once the song is prepared.

## Preparer quickstart

1. **New song** on the home desk.
2. **Import ghost track** — a lead vocal (Bonnie Herman–style: text, feel, rubato, intention). Any mono or stereo guide audio works.
3. **Mark a phrase** on the ghost — musical sentences and breaths, not arbitrary bars. Name them; add lyrics if you have them.
4. **Voice parts** — add the roster (S1, A2, …) and how many doubles you want on each.
5. **Sections** — mark stretches as *Follow the ghost* (rubato, no click) or *In time* (optional click only inside that window).
6. Open **Sing** for the booth, or **Review** later to promote keepers and export a zip.

Optional: crop sheet music onto a phrase so the booth shows only that cue.

## Singer quickstart

1. Open **Sing**. Pick a part, or *Surprise me with what’s left*.
2. Headphones on. Choose a mix: **Ghost Focus**, **Stack Build**, or **Blend Check**.
3. Tap **Record** or **Space** (toggle). Sing the phrase. Takes save themselves.
4. **Good enough** when the line can rest. **Next** for the following phrase on the same part.

You never name files, set loops, or arm anything. Phrases, breaths, doubles — that’s the whole job.

Full method: [Singers Unlimited workflow](docs/workflow-singers-unlimited.md).

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

## Offline PWA / iPad booth

Production builds (`npm run build`) generate a web app manifest and a Workbox service worker (`sw.js`) that caches the **app shell** (`index.html`, JS, CSS, icons). Existing projects stay in IndexedDB on the device, so they still work offline. The service worker does **not** cache audio blobs — those are already local.

Install: Chrome/Edge → install icon, or Safari on iPad → Share → Add to Home Screen. The app opens `standalone` with start URL `/`.

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
