# Ticket 2 — `GhostRecorder` component (record a ghost live from the mic)

Spec: `.scratch/spec-ghost-recording.md` (Implementation Decisions + user stories 1–10, 15–16).

Blocked by: none. Blocks: Ticket 3.

## Goal

Add a new component, `src/ui/preparer/GhostRecorder.tsx`, that lets the preparer record a ghost track live from the microphone: check mic (with a live peak meter) → Record → Stop → confirm (Use this / Discard & record again) → emit the same result shape `GhostImporter` already emits.

## Context you need (read these in full before writing code)

- `src/ui/preparer/GhostImporter.tsx` and `src/ui/preparer/GhostImporter.test.tsx` — the sibling component and its test style. Your new component must emit the identical `onImported` contract: `GhostImportResult = { blob: Blob; meta: { filename: string; durationMs: number; sampleRate: number } }`. Reuse those exact exported types from `GhostImporter.tsx` (import them, don't redefine).
- `src/audio/record.ts` in full — this is where almost all your primitives come from:
  - `requestMicStream(): Promise<MediaStream>` — call this, don't reimplement mic permission handling.
  - `startRecording(stream: MediaStream): StartedRecording` — gives you `{ stop: () => Promise<RecordingResult> }` where `RecordingResult = { blob, mimeType, durationMs, byteSize }`.
  - `micProcessingFlags(stream)` / `isProcessedCapture(flags)` — for the processed-capture warning.
  - `isEmptyTake({ byteSize, durationMs })` — reuse this exact function (despite the "Take" name) as your empty-recording guard; do not duplicate the thresholds.
- `src/audio/micLevel.ts` — `framePeakAbs`, `smoothLevel`, `classifyMicLevel` — the pure level-tracking math.
- `src/ui/shared/MicLevelMeter.tsx` — the existing meter component (`{ level, living, label? }` props) — reuse it directly, don't build a new meter.
- `src/pages/CalibrationPage.tsx` — read this in full as your primary UI/lifecycle reference. It already implements almost the exact pattern you need: lazy mic acquisition behind a "Check mic" button (`ensureIo`/`handleCheckMic`), an `armed` state that starts a `requestAnimationFrame` loop polling `getLevel()` and classifying it, and disposal on unmount. You are not reusing its code directly (it's calibration-specific), but you should mirror its *shape*: don't request the mic until a button press; keep the stream in a ref; drive the meter off a rAF loop; clean up on unmount.
- `src/ui/singer/RecordControl.tsx` — read the `processed` state and its rendered warning text (search for `"This device insists on echo cancellation"`) — copy that exact copy verbatim for your own processed-capture warning, don't rephrase it.
- `src/audio/decode.ts` — `decodeAudioFile(file: File | Blob)` — call this on the recorded blob to get `durationMs`/`sampleRate`, exactly as `GhostImporter.handleChange` already does.
- `tests/audio/record.test.ts` and `tests/audio/micLevel.test.ts` — see how these primitives are already unit-tested/mocked elsewhere, for mocking idioms you can reuse in your own test file.

## What to build

### Component state machine

States (name them however reads clearest in your implementation, but the transitions must match):

1. **idle** — nothing requested yet. Shows a "Check mic" button (and a "Record ghost" affordance — see UI shape below).
2. **checking** — `requestMicStream()` in flight.
3. **armed** — stream acquired; `MicLevelMeter` visible and live (rAF loop sampling an analyser the same way `CalibrationPage` does, or simplest: reuse `framePeakAbs`+`smoothLevel` directly on an `AnalyserNode` you create from the stream — see `audio/latency.ts`'s `createBrowserCalibrationIo` for exactly how an analyser is wired to a `MediaStreamSource`, if you need a concrete reference). Processed-capture warning shown here if applicable. "Record" button available.
4. **recording** — `startRecording(stream)` is active; meter keeps running; "Stop" button available instead of "Record".
5. **confirming** — recording stopped; shows duration; if `isEmptyTake(result)` is true, show an error message and only a "Record again" action (no "Use this"); otherwise show both **Use this** and **Discard & record again**.
6. **done** (terminal, or the component can just unmount/reset) — `decodeAudioFile` ran, `onImported` was called.

Transitions:
- idle → checking → armed: "Check mic" press, via `requestMicStream()`. On failure (permission denied, no device), show an error and return to idle (do not crash).
- armed → recording: "Record" press, via `startRecording(stream)`.
- recording → confirming: "Stop" press, via `rec.stop()` (await the `RecordingResult`).
- confirming → armed (**not** idle — the stream must stay open, no `requestMicStream()` re-call): "Discard & record again" press. Per spec user story 8, do not stop the mic track or re-run Check mic here.
- confirming → done: "Use this" press (only reachable when not empty) — run `decodeAudioFile(result.blob)`, then call `onImported({ blob: result.blob, meta: { filename: <timestamped>, durationMs, sampleRate } })`.
- Any state → cleanup: on unmount, stop all mic tracks (`stream.getTracks().forEach(t => t.stop())`) and cancel any rAF loop — mirror `CalibrationPage`'s unmount cleanup effect exactly (`aliveRef` guard pattern).

### Props

```ts
export type GhostRecorderProps = {
  onImported: (result: GhostImportResult) => void | Promise<void>
  disabled?: boolean
}
```
(`GhostImportResult` imported from `./GhostImporter.tsx`.) No `label` prop is needed unless you find it useful for consistency with `GhostImporter`'s `label` prop — your call, but keep the default visible text something like "Record ghost".

### Timestamped filename

For `meta.filename`, produce something like `` `Recorded ghost (${new Date().toLocaleString()})` `` — exact format is yours to decide, but it must not be a generic constant with no distinguishing timestamp (user story 10). Keep the formatting logic simple and inline or as a small local helper — no new shared date-utility module needed for this.

### Empty-recording guard

After Stop, before offering "Use this", call `isEmptyTake({ byteSize: result.byteSize, durationMs: result.durationMs })` (imported from `audio/record.ts`). If `true`, render an error (reuse the existing convention in this codebase: `role="alert"` paragraph, e.g. `"nothing caught — try again"` or similar — check `audio/record.ts`'s own empty-take message used elsewhere in `RecordControl.tsx` for consistent wording) and only offer "Record again" (which should behave like "Discard & record again" — back to **armed**, mic stays open).

### Styling

Match the existing Tailwind utility conventions already used in `GhostImporter.tsx` and `RecordControl.tsx` (studio palette tokens — `ink`, `paper`, `record-red`, `phrase-tint`, etc. — see `.brain/CONVENTIONS.md` "UI" section and `src/styles/tokens.css`). Don't invent new colors/hex values.

## Tests to write first (TDD)

New file: `src/ui/preparer/GhostRecorder.test.tsx`, colocated, same imports/style as `GhostImporter.test.tsx` (`@testing-library/react`, `vitest`).

Mock these modules (`vi.mock`, same `importOriginal` pattern `GhostImporter.test.tsx` uses for `decodeAudioFile`):
- `../../audio/record.ts` — mock `requestMicStream`, `startRecording`, `isProcessedCapture`, `micProcessingFlags`, but keep `isEmptyTake` as the real implementation (or mock it explicitly per test) since its exact thresholds matter for the empty-guard test.
- `../../audio/decode.ts` — mock `decodeAudioFile` exactly like `GhostImporter.test.tsx` does.

You'll need a fake `MediaStream`/`MediaStreamTrack` and a fake recorder object (`{ stop: () => Promise<RecordingResult> }`) — build minimal stand-ins (plain objects satisfying the shape you call methods on), not real browser APIs (jsdom doesn't have real `MediaRecorder`/`getUserMedia`).

Required test cases:

1. Initial render shows "Check mic" (or your equivalent label) and does **not** call `requestMicStream` yet.
2. Pressing "Check mic" calls `requestMicStream` and, on resolve, shows the mic-level meter (assert `MicLevelMeter`'s `role="meter"` element appears, or whatever observable marker you choose — don't assert on internal state).
3. A `requestMicStream` rejection shows an error and does not crash; "Check mic" remains available to retry.
4. After mic check, pressing "Record" then "Stop" shows a confirm step with the recorded duration, offering "Use this" and "Discard & record again" when the fake `RecordingResult` is well above the empty-take thresholds.
5. Pressing "Use this" calls the mocked `decodeAudioFile` with the recorded blob, then calls `onImported` with `{ blob, meta: { filename: <contains a non-empty timestamp-like string, not literally "undefined">, durationMs, sampleRate } }` — assert the shape, and assert `filename` is a string that is not just a static literal like `"ghost"` (i.e. prove it's actually timestamped — e.g. assert it's different across two calls with fake timers advanced, or assert it contains recognizable date-ish characters).
6. Pressing "Discard & record again" after Stop returns to the armed/recording-ready state **without** calling `requestMicStream` a second time (assert call count stays at 1).
7. When the fake `RecordingResult` is below the empty-take thresholds (byteSize/durationMs under `EMPTY_TAKE_MAX_BYTES`/`EMPTY_TAKE_MIN_DURATION_MS` from `audio/record.ts` — import those constants in the test to construct a deliberately-too-short fixture), the confirm step shows an error and does **not** offer "Use this" — only a record-again action, and `onImported` is never called for that recording.
8. When `isProcessedCapture`/`micProcessingFlags` report processed capture, the armed/recording UI shows the reused warning copy (assert on the exact string from `RecordControl.tsx`, or a substring of it, to catch copy drift).
9. Unmounting the component while a stream is open stops all its tracks (assert your fake track's `stop` mock was called).

Run the new test file in isolation first to confirm red, then implement, then green: `npm test -- src/ui/preparer/GhostRecorder.test.tsx`.

## Acceptance criteria

- [ ] `src/ui/preparer/GhostRecorder.tsx` exists, exports `GhostRecorder` and `GhostRecorderProps`.
- [ ] Emits the exact same `GhostImportResult` shape as `GhostImporter`.
- [ ] All 9 test cases above pass.
- [ ] `npm test -- src/ui/preparer/GhostRecorder.test.tsx` passes.
- [ ] `npm run lint` is clean.
- [ ] Full `npm test` run has no regressions elsewhere.
- [ ] Not yet rendered anywhere (that's Ticket 3) — this ticket only produces the component and its tests in isolation.
- [ ] Commit message style: `feat(prepare): add GhostRecorder component` (test file in the same commit).

## Out of scope for this ticket

- Rendering `GhostRecorder` inside `PreparePage.tsx` — Ticket 3.
- The replacement-confirmation `window.confirm` gate — that's `ghostReplacementWarning` (Ticket 1) wired in `PreparePage` (Ticket 3); this component has no idea whether it's creating the song's first ghost or replacing one.
- System/tab audio capture (`getDisplayMedia`) — mic-only, per the spec.
- A full Hear/playback review step before confirming — duration + Use/Discard only.
