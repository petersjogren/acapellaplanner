# Learnings

Pitfalls that already bit this codebase. Re-read before changing audio, export, or persistence.

## Alignment (one formula, many call sites)

Play window start is `max(0, phrase.startMs - preRollMs)`, end is `endMs + postRollMs` (`computePlayWindow`). Recording captures that window. Playback of a take skips `latencyCompMs` **into the buffer**. Export pad is `timelineStartMs = play window start`, trim is the same latency skip.

Using `phrase.startMs` as stem origin places every file late by its pre-roll. Skipping the latency trim places every file late by the device profile.

The same "play window start" formula is `phraseTimelineStartMs` in `domain/phrases.ts`, used by three call sites: the record-time snapshot (`Take.timelineStartMs`, written in `RecordControl.persistTake`), `dawExport.segmentStartMs`, and the all-keepers mix's per-take `startDelayMs`. Editing a phrase's `startMs`/`preRollMs`, or deleting it outright, after a take has been recorded against it must not silently move or drop that take from whole-song playback or export — see the snapshot note above and the take-vs-phrase-edit entry below.

## Ghost duration is a snapshot

`settings.ghostMeta.durationMs` is taken at import. Prepare reconciles it to the decoded buffer when they disagree by >100 ms. Trust the buffer for timeline, clamp, and play window. A truncated ghost must **not** shorten `requestedDurationMs` (recording/listen-back).

## Phrases don’t overlap; audio does

`validatePhrases` is not a reason to use one stem per part. Pre/post-roll tails and doubles on the same cell overlap. Lane colouring after **decoded** duration is the fix; `take.durationMs` is only a planning estimate.

## Safari / capture

- Don't `decodeAudioData` on a context you then close.
- Don't revoke an object URL in the same turn as `a.click()` (1 s delay in `downloadBlob`).
- `{ audio: true }` turns on Chrome voice-call DSP and ducks sung takes against the ghost. Ask for raw capture; warn if settings still show AEC/NS/AGC.
- Latency calibration is headphone **bleed-through**, not a clap. Detect **880 Hz vs neighbouring bins** (`smoothingTimeConstant = 0`); peak floors (0.2, then 0.03) never heard quiet leak. One tap; silent warmup. Without a meter, a dead mic and no bleed both looked like "tone not detected." Clap-with-click is round-trip **plus** human offset. A short 12-click median+MAD run was enough to save three different "stable" answers: click leak (~20 ms, first peak + refractory ate the real clap), a one-beat alias (~650 ms, pairing search out to 800 ms > 600 ms period), or the real clap (~90 ms). Do not stop on 6 pairs. Replace a quieter onset with a louder one in ~160 ms; cap pairing at 400 ms; sequential Normal–Normal on MAD inliers; min 16 closed clicks; keep going while the 95% half-width is wide or MAD is high. Still applied as a buffer skip, never by shifting phrase start. iOS may keep AEC and/or route Web Audio to the earpiece while the mic is open — unfixable from the page; headphones, or type ms after a miss.
- Safe-area insets (`env(safe-area-inset-*)`) must go through Tailwind arbitrary values (`pl-[max(1rem,env(safe-area-inset-left))]`), not an inline `style={{ paddingInline: ... }}` alongside a `px-*` class — the inline style wins the cascade and silently zeroes the padding on every viewport, not just notched ones. Caught by screenshotting an emulated iPhone, not by tests (jsdom has no `env()`).
- `min-h-screen` (`100vh`) undercounts Safari's dynamic toolbar; use `min-h-dvh` for phone-viewport shells.
- iOS Safari routes plain `AudioContext` output through the "ambient" session category, which the hardware Ring/Silent switch mutes; only `<audio>`/`<video>` elements play in "media" category, unaffected by the switch. Sing's Record button happened to work because `getUserMedia()` also flips the session, but any page that only calls `AudioContext.play()` (Prepare's mark-along `Play ghost`) stayed silent whenever the switch was set to silent, even though scheduling/playhead worked fine. Fix: loop a silent `<audio>` element from the very first user gesture, app-wide (`unlockIOSAudioSession` in `src/audio/context.ts`, wired from `App.tsx`) — not tied to a specific page or button. A silent WAV's `data` chunk must contain real sample bytes; a zero-length `data` chunk plays instantly and never actually holds the session open.

## Persistence races

React state is stale under rapid phrase/part edits and booth advances. `projectRef` + serialized write queue. RecordControl persist is async after pass complete — `flushSaves` before marking enough.

Reset singer `voicePartId` / `phraseId` on the **route** project id, not when `project.id` first hydrates. `undefined → id` after the first PartPicker paint will clear a pick in the same tick (jsdom/CI `Need more takes` wrap-up flake).

Engine `generation` must bump on `stop()` so late `onended` / timers don’t start the next loop or fire UI.

## Pages / PWA

Project site is `/acapellaplanner/`. Router basename, PWA `start_url`/`scope`, and Workbox `navigateFallback` must all use `base`. Deep links need `404.html`. `BASE_PATH` is how a rename or a root host stays correct.

`registerType: 'autoUpdate'` skipWaiting + clientsClaim + `cleanupOutdatedCaches` deletes the previous hashed assets as soon as a new SW activates. A tab that was already open still runs the old JS; `import('./pdfjsRender.ts')` then requests e.g. `pdfjsRender-BB-FQkRp.js` which GitHub Pages no longer has. Pages serves `404.html` (the SPA shell) for that URL, and the browser reports `Failed to fetch dynamically imported module`. `npm run dev` has no SW and no hashed chunks, so PDF import looks fine locally. Reload once on `vite:preloadError`, and on `controllerchange` only when a controller already existed (a first-visit SW claim also fires it). SessionStorage gates the reload so a still-missing chunk cannot loop.

## Zip

Import only accepts `audio/<filename>` (no `..`, no nested dirs). Missing blobs are skipped; missing `project.json` fails. Importing a zip whose `project.id` already exists overwrites that song.

## Lane render

Assign after decode. Fade 5 ms in/out; 10 ms minimum gap so fades don’t collide. Render **one lane at a time** (large Float32 accumulators). Additive `+=` is belt-and-braces; with correct assignment it matches overwrite.

## Timeline click vs mark

Do not reuse `MIN_PHRASE_MS` (50) to distinguish a waveform click from a mark-drag. On a 3-minute ghost that is a fraction of a pixel, so a real click would try to mark an overlapping phrase. Pointer travel (`TIMELINE_CLICK_PX`) is the click test; `MIN_PHRASE_MS` only rejects a committed drag that is too short in ghost time. Double-click unused space fills `gapContainingMs`; always `phraseAtMs` first so the last phrase's exact `endMs` still selects, not fills.

## Mark-along vs select / Listen

Do not call `finishMarkAlong` / stop-commit from `handleSelectPhrase` — selecting during a pass must not persist. `Listen` `playPhrase` must no-op while `markAlongPlaying` so it cannot steal the engine. Selecting currently stops Listen only.

## Take timing survives phrase edits

A take only stores `phraseId`; before `Take.timelineStartMs` existed, whole-song "All phrases" playback (`loadAllKeepersMixForSong`) and DAW export (`planSegments`) both recomputed a take's timeline position by looking up its *current* phrase. Editing the phrase's `startMs`/`preRollMs` after singing silently moved the already-recorded take; deleting the phrase orphaned it, and the all-keepers mix's `phrase ? ... : 0` fallback then stacked the orphan at position 0 instead of skipping or preserving it (export already skipped orphans, but would have mis-positioned an edited one the same way). Fix: snapshot `phraseTimelineStartMs(phrase)` into `Take.timelineStartMs` at record time (`RecordControl.persistTake`); every consumer prefers that snapshot over recomputing from the live phrase, and only falls back to a live lookup (or 0) for takes recorded before the field existed. Any new whole-song or export code path that positions a take on the timeline must read `take.timelineStartMs` first — recomputing from `phraseId` regresses this bug.

## Measuring a DOM node that mounts after content resolves asynchronously

`SheetCue` (multi-crop sheet filmstrip, Sing booth) needs a real measured pixel width of its own `<figure>` to compute scroll range. First attempt used `useRef` + `useEffect(() => { measure(ref.current) }, [])`: correct-looking, but wrong here, because the component often renders `null` on its first several paints while `SingPage` is still resolving crop image blobs into object URLs — the `<figure>` doesn't exist yet when that empty-deps effect fires (once, at the very first commit), and it never fires again once the element actually mounts. The measured width silently stayed 0 forever, which fed into `maxScrollPx = totalWidth - 0` and scrolled the *entire* filmstrip — including the last crop — off past the visible edge instead of stopping with it in view.

Fix: use a **callback ref** stored in `useState` (`const [el, setEl] = useState<HTMLElement|null>(null)`, `ref={setEl}`) and key the measuring `useEffect`'s deps on that state value, not `[]`. A callback ref re-fires every time React attaches it to a new/different DOM node, however many renders that takes — so the effect (and its `ResizeObserver`) attaches correctly whenever the real element finally shows up, not just on the component instance's first commit. Any component measuring a node that might not exist on first render — behind a loading state, an async fetch, or a conditional — needs a callback ref for this reason, not `useRef` + empty-deps `useEffect`.

## iPad Safari: nested transform on `<img>` inside a translating strip

`SheetCue` used to crop by filling the slide with the page image (`width/height: 100%`) then `transform: translate(%) scale(1/w, 1/h)` with origin `0 0`, while the filmstrip track did `translateX(px)` every rAF (and a 100ms CSS `transition` on that transform). On iPad Safari that nested pair double-paints the replaced element: the real cropped sheet, plus a half-intensity ghost of the same page that does not stay locked to the scrolling track — they start together and drift apart. Chrome desktop does not show it.

Do not "fix" this by promoting extra compositor layers (`translateZ(0)` on the img, `will-change`, backface-visibility) while keeping the img transform — those work around the symptom and still fight the rAF-driven parent. The crop is static, so use layout: size the page to `width: 100%/w`, `height: 100%/h`, `left: -x/w*100%`, `top: -y/h*100%` and let the slide's `overflow: hidden` clip it. Tailwind preflight sets `img { max-width: 100% }`; without `maxWidth: 'none'` a width greater than the slide collapses back to 100% and the crop is wrong. Do not put a CSS transition on a transform that rAF already updates every frame — Safari leaves ghost compositor layers of in-flight interpolations.

Transform stays on the **track only** (`translateX` in real pixels). That property is compositor-only, so the scroll is still smooth without a transition.

## Score-film camera maps occupied phrase time, not wall-clock ghost

`filmScrollProgress` only ticks inside phrases and **holds** in unmarked gaps (and before the first / after the last). Mapping `F` over `[0, ghostDuration]` lets a long intro consume the film so the actual song races. Phrase-loop wrap snaps `getPositionMs` from end → start — do not CSS-transition that jump (same iPad compositor-ghost rule as rAF `translateX`).

