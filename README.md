# Acapella Planner

Local-first ghost-track studio for acapella rehearsal. Desktop Chrome MVP.

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — typecheck and production build
- `npm run preview` — serve the production build
- `npm test` — run Vitest once
- `npm run test:watch` — Vitest watch mode

## Stack

Vite + React + TypeScript, Tailwind CSS v4, Dexie, Zod, React Router.

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
- [ ] Export zip
- [ ] Rubato section: no click
- [ ] Fixed-tempo section: click in the section window
- [ ] iPad mic works, or desktop Chrome fallback as documented above
