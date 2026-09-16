# GitHub Pages PDF import: stale pdfjs chunk

Live PDF import failed with `Failed to fetch dynamically imported module:
…/assets/pdfjsRender-BB-FQkRp.js` while `npm run dev` worked.

The hosted index actually imports `pdfjsRender-DSAqBT8v.js`, which is on
Pages and in the current SW precache. `BB-FQkRp` is a previous hashed
lazy chunk. `autoUpdate` SW skipWaiting + clientsClaim +
`cleanupOutdatedCaches` had already dropped it; the still-running tab
kept the old JS. GitHub Pages then served `404.html` (SPA fallback) for
the missing `.js`, which the browser reports as a failed dynamic import.

Fix: `installStaleAssetReload` in `main.tsx` — one-shot reload on
`vite:preloadError`, and on `controllerchange` only when a controller
already existed. Missing-chunk errors from `renderPage.ts` ask for a
refresh if the reload already happened this session.

Hard-refreshing the live site today already works (current chunk is
present). Redeploy for the reload guard to land.
