# Learnings

Pitfalls that already bit this codebase. Re-read before changing audio, export, or persistence.

## Alignment (one formula, many call sites)

Play window start is `max(0, phrase.startMs - preRollMs)`, end is `endMs + postRollMs` (`computePlayWindow`). Recording captures that window. Playback of a take skips `latencyCompMs` **into the buffer**. Export pad is `timelineStartMs = play window start`, trim is the same latency skip.

Using `phrase.startMs` as stem origin places every file late by its pre-roll. Skipping the latency trim places every file late by the device profile.

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

## Persistence races

React state is stale under rapid phrase/part edits and booth advances. `projectRef` + serialized write queue. RecordControl persist is async after pass complete — `flushSaves` before marking enough.

Reset singer `voicePartId` / `phraseId` on the **route** project id, not when `project.id` first hydrates. `undefined → id` after the first PartPicker paint will clear a pick in the same tick (jsdom/CI `Need more takes` wrap-up flake).

Engine `generation` must bump on `stop()` so late `onended` / timers don’t start the next loop or fire UI.

## Pages / PWA

Project site is `/acapellaplanner/`. Router basename, PWA `start_url`/`scope`, and Workbox `navigateFallback` must all use `base`. Deep links need `404.html`. `BASE_PATH` is how a rename or a root host stays correct.

## Zip

Import only accepts `audio/<filename>` (no `..`, no nested dirs). Missing blobs are skipped; missing `project.json` fails. Importing a zip whose `project.id` already exists overwrites that song.

## Lane render

Assign after decode. Fade 5 ms in/out; 10 ms minimum gap so fades don’t collide. Render **one lane at a time** (large Float32 accumulators). Additive `+=` is belt-and-braces; with correct assignment it matches overwrite.
