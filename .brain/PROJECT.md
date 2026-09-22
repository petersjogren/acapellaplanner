# Acapella Planner

Local-first **ghost-track overdub booth** for stacked a cappella. Not a DAW.
The ghost’s phrasing is the clock; the singer only listens and sings back.

Live: https://petersjogren.github.io/acapellaplanner/

User-facing docs: `README.md`, `docs/workflow-singers-unlimited.md` (also served at `/workflow`).
Agent contract: `AGENTS.md` and `.brain/MAINTENANCE.md` (keep this folder in lockstep with code).

## Roles

- **Preparer** (desktop Chrome): import ghost, mark phrases, roster, sections, sheet crops, review keepers, export.
- **Singer** (same origin, later iPad Safari Home Screen): pick a part, hear a mix, Record once per pass, Hear / Keep / Scrap, Good enough / Next.

Songs live in **this browser on this device** (IndexedDB). Nothing syncs. The `.acapella.zip` is backup and the way a song moves between devices. DAW stems and the Review film MP4 are one-way mixdowns.

## Stack

Vite 8 + React 19 + TypeScript (strict, `verbatimModuleSyntax`) + Tailwind v4 + Dexie + Zod 4 + React Router 7 + Vitest + oxlint + vite-plugin-pwa.

No backend. No accounts. HTTPS required for mic (Pages provides it).

## Commands

```bash
npm install
npm run dev          # Vite, base `/` in practice via dev server
npm test             # vitest run
npm run test:watch
npm run lint         # oxlint
npm run build        # tsc -b && vite build (default BASE_PATH=/acapellaplanner/)
npm run preview
```

Root-served host: `BASE_PATH=/ npm run build`.

## Deploy

Manual GitHub Actions only (`workflow_dispatch`). Push to `main` does **not** publish.
Actions → Deploy to GitHub Pages. Workflow: lint + test, then `BASE_PATH` from `configure-pages`, publish `dist/`.
Node 22 in CI. Pages source must already be “GitHub Actions”.

## Non-goals (do not regress)

- Not a DAW: no clip editing, mixer, punch-in, auto-tune, quantize, session format.
- No cloud, no multi-device sync, no accounts.
- Singer never names files, sets loops, or arms tracks.
- Click only inside an in-time section; rubato never gets a metronome.
