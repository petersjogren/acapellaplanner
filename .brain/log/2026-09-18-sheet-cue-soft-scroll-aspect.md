# Multi-crop sheet cue: soft-scroll + aspect ratio

Closed two related TODO items about the sheet cue on Sing:

1. A phrase spanning several sheet crops had no way to walk through them —
   the schema already allowed `sheetRefs: SheetRef[]`, but every write path
   only ever wrote a single-element array and the booth only ever read
   `sheetRefs[0]`.
2. Crops were stretched to fill the cue's box regardless of the source
   region's own aspect ratio, distorting the notation.

## Domain (`src/domain/sheets.ts`)

- `addSheetRefToPhrase` appends a crop to a phrase's sequence (vs.
  `bindSheetRefToPhrase`, kept as-is, which still *replaces* the whole
  sequence with one crop — the original drag-and-bind UX).
- `removeSheetRefFromPhrase` drops one crop by id.
- `sheetPageBlobIdsForPhrase` resolves an image blob id per crop, in order
  (parallel to the existing single-crop `sheetPageBlobId`).
- `sheetScrollFrame(sheetRefs, imageKeys, elapsedMs, durationMs)` is the pure
  math: crops are waypoints spread evenly across `durationMs` — first crop
  at elapsed 0, last at elapsed = duration, interior crops interpolated
  linearly between neighbours. Interpolation only happens when both crops
  share the same `imageKeys` entry (same page image); crossing a page/doc
  boundary has nothing sensible to pan across, so it hard-cuts at the
  segment's 50% mark instead of stretching a rectangle between two
  unrelated images.

## Preparer UI (`SheetCropper.tsx`, `PreparePage.tsx`)

- New "Add as next crop" button next to "Bind crop", wired to
  `onAddCrop` → `addSheetRefToPhrase`.
- A "Bound crops" list under the phrase picker shows each crop bound to the
  selected phrase (in order) with a per-crop remove button
  (`onRemoveCrop` → `removeSheetRefFromPhrase`).
- Both derive from `phrases.find(...).sheetRefs` inside `SheetCropper`
  itself rather than a separate prop, so the list always matches whichever
  phrase is currently selected in the dropdown.

## Singer UI (`SheetCue.tsx`, `PhraseStage.tsx`, `SingPage.tsx`)

- `SheetCue` takes `pageImageUrls` (array, index-matched to `sheetRefs`) and
  `elapsedMs` instead of a single `pageImageUrl`. It calls `sheetScrollFrame`
  every render and draws whichever region/image that returns — a one-crop
  phrase always gets the same frame regardless of `elapsedMs`, so nothing
  changes for the common case.
- Aspect ratio: the crop region's `w/h` is a same-tick fallback for the
  `<figure>`'s CSS `aspect-ratio`; once the *currently shown* crop's image
  fires `onLoad`, the ratio is corrected to `(region.w * naturalWidth) /
  (region.h * naturalHeight)` — the true aspect of the cropped page pixels,
  not just the drag rectangle's raw fraction (matters once a project's
  pages aren't square-ish). Keyed by image URL so switching crops mid-pan
  invalidates the cached natural size instead of reusing the wrong image's
  dimensions.
- `SingPage` resolves one object URL per crop (`Promise.all` over
  `sheetPageBlobIdsForPhrase`) instead of one. It only runs a
  `requestAnimationFrame` loop sampling `engine.getPositionMs()` when the
  booth phrase has 2+ crops — a static single-crop or crop-less phrase does
  not pay for the rAF churn.

## Tests

`tests/domain/sheets.test.ts` (new `sheetScrollFrame`/add/remove suites),
`src/ui/singer/SheetCue.test.tsx` (rewritten for the array prop + aspect +
pan/hard-cut behaviour), `src/ui/preparer/SheetCropper.test.tsx` (add-crop,
bound-crops list + remove), `tests/pages/SingPage.test.tsx` (new end-to-end
soft-scroll test driving the mocked engine's `getPositionMs`).

Full suite (647 tests), lint, and build all green after the change.

## Follow-up: make the pan actually smooth

First cut positioned the crop with percentage `top/left/width/height` on the
`<img>`, which forces a layout reflow every animation frame — visibly choppy
rather than a smooth glide. Switched to `transform: translate() scale()`
(compositor-only, no reflow) and added `.sheet-cue-pan` in `tokens.css` as a
short linear transition on `transform`/`aspect-ratio`, so the browser
interpolates between elapsed-time samples instead of snapping. The class
(not an inline `transition` style) so it plugs into the app's existing
`prefers-reduced-motion` block alongside `.studio-transition`/`.fade-in`.
The `<img key={frame.imageKey}>` remount (already in place) is what keeps a
cross-page hard cut instant instead of also transitioning — a key change
skips the transition and paints the new element outright.

Updated the two `style.left` assertions (`SheetCue.test.tsx`,
`tests/pages/SingPage.test.tsx`) to check `style.transform` instead. Full
suite (647 tests), lint, and build all green after the change.

## Follow-up 2: still a hard cut — real root cause + filmstrip redesign

User reported the two-crop test case still snapped instead of gliding. Two
separate bugs, found by re-reading `SingPage`'s URL-building effect:

1. **The actual smoking gun**: `SingPage` called
   `URL.createObjectURL(record.blob)` once per crop *index*. Two crops
   bound to the *same* page (the ordinary case — a phrase's next few notes
   are usually still on the current line) share one `imageBlobId`, but
   `createObjectURL` mints a **new, distinct URL string** on every call even
   for the same `Blob`. `sheetScrollFrame`'s "same image" check compared
   `imageKeys[i] === imageKeys[i+1]` by string equality, so two crops on one
   page looked like two different pages and always took the hard-cut
   branch — the exact case the user was testing with never had a chance to
   pan. Fixed by deduping: build one `Set` of unique blob ids, resolve one
   URL per unique id, then map back to per-crop URLs by id.
2. **Design flaw, not just a bug**: even with (1) fixed, "pan only between
   same-image crops, hard-cut otherwise" is the wrong shape for "smooth
   scroll between crops" — the user explicitly wants horizontal filmstrip
   motion, and a design with a hard-cut branch can never deliver that for
   crops that legitimately live on different pages (the *other* common
   case: a phrase's later notes are on the next page).

Redesigned as an actual filmstrip instead of interpolating one crop
rectangle in place:

- `sheetScrollFrame` now returns `{ slides, progress }`. `slides` is every
  `sheetRef` mapped 1:1 to `{ id, region, imageKey }` — no waypoint/segment
  math, no same-image branch. `progress` is a single continuous number: 0
  at elapsed 0 (first crop centered), `slides.length - 1` at elapsed =
  phrase duration (last crop centered), linear in between. There is nothing
  left to special-case — crossing a page boundary is just more of the same
  one-dimensional scroll.
- `SheetCue` renders every slide as a `shrink-0` box side by side inside a
  track `slides.length * 100%` wide, and translates the track by
  `-(progress / slides.length) * 100%` — i.e. exactly `progress` slide-widths
  of horizontal travel, continuous and monotonic regardless of what image
  is behind which slide. Each slide still positions its own crop
  independently (`regionStyle`, unchanged transform-based math) so cropping
  never distorts across slide boundaries.
- Aspect ratio: since the *visible* content is only ever whichever slide
  the viewport currently centers, the outer `<figure>`'s aspect is
  `lerp(aspectOf(floor(progress)), aspectOf(ceil(progress)), frac)` — smooth
  even though the two slides may be on totally different pages with
  different real dimensions.
- Per-slide natural-size cache is now keyed by `imageKey` and shared across
  every slide using that key (a `Record`, not a single `{url, w, h}`), so
  two same-page slides both benefit from one `onLoad`.

Rewrote `src/ui/singer/SheetCue.test.tsx` and the `sheetScrollFrame` suite
in `tests/domain/sheets.test.ts` around the new `{slides, progress}` shape;
added a same-page-crops-share-one-URL regression test and a
different-doc-crops-still-scroll-smoothly test to
`tests/pages/SingPage.test.tsx`. Full suite (649 tests), lint, and build all
green after the change.

## Follow-up 3: still stretched — equal-width slides were the last bug

User reported the follow-up 2 filmstrip still looked wrong for two crops of
very different shape (their example: 4cm×4cm square next to 16cm×4cm wide).
Root cause: every slide's *box* was sized to an equal share of the track
(`100 / slides.length` percent width, fixed height) regardless of the
crop's own aspect ratio, then `regionStyle`'s `scale()` filled that box
exactly — so a wide crop got squeezed into the same box shape as a square
one, distorting it. The filmstrip redesign in follow-up 2 fixed the
scroll continuity but never addressed per-slide sizing.

Fixed by giving every slide a fixed **height** (`SHEET_CUE_SLIDE_HEIGHT_PX`,
220px, exported for tests) and a **width equal to that height times the
slide's own aspect ratio** — a real contact-sheet filmstrip, not equal-width
boxes. A 1:1 crop and a 4:1 crop next to it are now 220px and 880px wide
respectively; `regionStyle`'s existing transform math still exactly fills
whatever box it's given, so as long as the box is the crop's true aspect,
nothing distorts. Also switched track/scroll math from CSS percentages to
real measured pixels (`ResizeObserver` on the figure element, `ref`-based,
mirroring the existing pattern in `GhostTimeline.tsx`) — percentages of "the
track's own width" were fragile once slide widths stopped being uniform;
plain pixel arithmetic (`widths`, `centersPx`, `translateXPx = viewportWidth
/ 2 - targetCenterPx`) can't drift from what the browser painted. The
single-crop case got its own simpler branch (no track, just the crop's own
`aspectRatio` on the figure) since a one-slide filmstrip has nothing to
scroll.

Rewrote `src/ui/singer/SheetCue.test.tsx` to assert on pixel widths (a
square and a 4x-wide crop must NOT get equal slide widths; a slide's width
must equal `SHEET_CUE_SLIDE_HEIGHT_PX * aspect`; the track's width is the
exact sum of its slides', proving no gaps and no equal-share fallback) and
adjusted `tests/pages/SingPage.test.tsx`'s scroll assertions for the
pixel-based `translateX`. Full suite (650 tests), lint, and build all green
after the change.

## Follow-up 4: center-on-waypoint scroll wasn't what was asked for

User clarified the exact scroll shape they want: at the phrase's very
start, the *leftmost* crop's whole content must be visible (nothing
scrolled off to the left); at the phrase's end, the *rightmost* crop's
right edge must sit exactly at the viewport's right edge, with **no**
trailing empty space to the right ever. Follow-up 3's model instead
*centered* each crop as a waypoint (`targetCenterPx = lerp(centersPx[floor],
centersPx[ceil], frac)`), which both scrolls a bit past the true left edge
at elapsed 0 (centering the first crop, not flushing it left) and can stop
short of the true right edge at elapsed = duration (centering the last
crop, not flushing its right edge right) — not what was asked.

Replaced the centering math with a real `scrollLeft` model, matching how a
browser scrolls a viewport:

- `sheetScrollFrame`'s `progress` is now a plain elapsed/duration ratio
  (0–1), not scaled by slide count — it no longer encodes "which waypoint",
  just "how far through the phrase, linearly".
- `SheetCue` computes `maxScrollPx = max(0, totalWidthPx - viewportWidthPx)`
  from the strip's total width and the ResizeObserver-measured viewport
  width, then `scrollLeftPx = progress * maxScrollPx`,
  `translateXPx = -scrollLeftPx`. At `progress = 0` this is exactly 0 (strip
  flush left, nothing cropped off the first slide). At `progress = 1` it is
  exactly `-(totalWidthPx - viewportWidthPx)`, which puts the strip's right
  edge exactly at the viewport's right edge — never short, never past.
  `maxScrollPx` is clamped to `>= 0` so a strip that already fits the
  viewport (few/small crops) simply never scrolls, rather than trying to
  create negative travel.

Updated `tests/domain/sheets.test.ts`'s `sheetScrollFrame` suite for the
plain 0–1 `progress` (dropped the "spreads N crops" segment-scaling test,
since there is no more segment scaling). Rewrote the scroll-behavior tests
in `src/ui/singer/SheetCue.test.tsx`: hard-left-at-elapsed-0, hard-right
(right edge exactly at 0 translateX minus total width) at elapsed=duration,
and a `clientWidth` spy proving a strip narrower than the viewport never
scrolls at all (stays pinned at translateX 0, no phantom trailing space).
Full suite (653 tests), lint, and build all green after the change.

## Follow-up 5: real bug was the viewport-width measurement, not the math

User reported: with two crops, elapsed 0 correctly shows the first crop,
but at the phrase's end the strip has scrolled so far that *only empty
space* is visible — both crops gone off to the left. The hard-left/hard-
right math from follow-up 4 is correct on paper; the actual bug was that
`viewportWidthPx` never left its initial value of 0.

Root cause: `SheetCue` measured the figure with `useRef` + a `useEffect`
with an **empty dependency array**. That effect runs exactly once, at the
component instance's very first commit. But `SheetCue`'s crop images
resolve asynchronously in `SingPage` (`Promise.all` over
`getAudioBlob`/`createObjectURL`) — so on a fresh phrase, `SheetCue` first
renders `pageImageUrls` full of `null`/`undefined`, hits the "renders
nothing without a page image" early return, and paints nothing. By the time
the URLs resolve and the real `<figure>` finally mounts, the empty-deps
effect has already fired (once, against `ref.current === null`) and will
never fire again. `viewportWidthPx` stays 0 forever. With viewport width 0,
`maxScrollPx = totalWidthPx - 0 = totalWidthPx` — the *entire* filmstrip,
so `progress = 1` scrolls the whole strip (both crops) off past the left
edge instead of stopping with the last crop's right edge at the true
(non-zero) viewport edge. See `.brain/LEARNINGS.md` "Measuring a DOM node
that mounts after content resolves asynchronously" for the general lesson.

Fix: swapped the `useRef` for a **callback ref** kept in `useState`
(`const [figureEl, setFigureEl] = useState<HTMLElement | null>(null)`,
`ref={setFigureEl}` on both the single-crop and multi-crop `<figure>`s) and
changed the measuring effect's deps from `[]` to `[figureEl]`. A callback
ref fires every time React attaches it to a newly-mounted node, so the
effect (and its `ResizeObserver`) now correctly attaches on whichever
render the `<figure>` actually first appears — not just the component's
very first commit.

Added a regression test in `src/ui/singer/SheetCue.test.tsx`
("keeps the last crop on screen at elapsed = duration even when the figure
only mounts on a later render") that renders with unresolved image URLs
first (producing no `<figure>`), then rerenders with resolved URLs — the
exact `SingPage` sequence — and asserts the hard-right `translateX` still
accounts for a non-zero, spied `clientWidth`. Verified this test fails
against the pre-fix `useRef` version (reverted `SheetCue.tsx` via `git
stash`, ran the single test, confirmed the failure, restored the fix) before
finalizing. Full suite (654 tests), lint, and build all green after the
change.
