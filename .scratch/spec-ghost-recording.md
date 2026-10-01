# Spec: Record the ghost track live in the booth

Status: ready-for-agent
Branch convention: `learn/matt-skills` (per `.hermes/plans/2026-09-23_164402-learn-matt-pocock-skills.md`) — do not land on `main` without the preparer's explicit say-so.

## Problem Statement

Today the only way to get a ghost track into a song is to upload an existing MP3/WAV file (`GhostImporter`). A preparer who wants to lay down a ghost on the spot — singing or playing a reference line themselves, right there at the bench — has no way to do that inside the booth. They have to record elsewhere, export a file, then come back and upload it, which breaks their flow and adds a round trip to a tool outside the app.

Separately, replacing an existing ghost (by upload or, soon, by live recording) silently overwrites `ghostTrackId` today with no warning. If the song already has phrases marked against the old ghost, those phrases keep their `[startMs, endMs]` numbers on a now-different audio file. The preparer currently finds out only after the fact, via the passive "stranded phrases" banner that appears once the new buffer decodes — a weak, late signal for a change that can quietly misalign an entire song's phrase map and existing takes.

## Solution

Add a **Record ghost** option on Prepare, alongside the existing **Import ghost track** uploader, so a preparer can capture a ghost track live from the mic without leaving the app. It reuses the booth's own mic-capture primitive (same raw, unprocessed capture as take recording) and gives the preparer a check-mic step with a live peak meter, a record/stop control, and a lightweight confirm-or-redo step before the recording becomes the song's ghost.

Whether the new ghost comes from an upload or a live recording, replacing a ghost that the song already has phrases (and possibly takes) marked against now asks for confirmation first, naming what's at stake, instead of swapping silently.

## User Stories

1. As a preparer with no ghost track yet, I want a "Record ghost" option next to "Import ghost track", so that I can lay down a reference line on the spot instead of needing a separate recording tool first.
2. As a preparer about to record a ghost, I want to check my mic and see a live peak meter before I commit to recording, so that I know the mic is actually picking up signal before I perform.
3. As a preparer checking my mic, I want that check to not silently request microphone permission the instant I open Prepare, so that I'm not surprised by a permission prompt I didn't ask for.
4. As a preparer, I want a mic recording for the ghost to use the same raw, unprocessed capture as take recording (no echo cancellation, noise suppression, or auto-gain), so that the result isn't quietly mangled by the browser's voice-call DSP.
5. As a preparer recording a ghost on a device that still forces processed capture, I want to be told so (the same warning take recording already shows), so that I understand why the result might sound off instead of assuming the app is broken.
6. As a preparer, I want a Record / Stop control for the ghost, so that I control exactly when the live capture starts and ends.
7. As a preparer who just stopped a ghost recording, I want to see its duration and choose "Use this" or "Discard & record again", so that I can retry without re-granting mic permission or re-doing the check-mic step.
8. As a preparer who discards a ghost recording and immediately records again, I want the mic to still be live (no new permission prompt, no new check-mic step), so that retrying is fast.
9. As a preparer, I want an accidental near-instant Stop to be rejected rather than silently becoming the song's ghost track, so that I don't end up with an unusable near-empty ghost.
10. As a preparer, I want each live-recorded ghost to get a distinguishable name (e.g. a timestamp) instead of a generic filename, so that I can tell recordings apart later in the Ghost track summary.
11. As a preparer with a song that already has phrases marked (and possibly takes recorded), I want to be warned before replacing the ghost — by upload or by live recording — that doing so may misalign those phrases/takes, so that I don't silently break work already done on this song.
12. As a preparer being warned about a ghost replacement, I want the warning to tell me how many phrases (and, if any, how many takes) are at stake, so that I can judge how risky the replacement actually is before confirming.
13. As a preparer with a brand-new song (no phrases yet), I want to record or upload a ghost without any confirmation interruption, so that the common first-time flow stays frictionless.
14. As a preparer who cancels the replacement confirmation, I want the existing ghost left completely untouched, so that a change of mind costs nothing.
15. As a preparer, I want "Record ghost" to appear in both the no-ghost-yet state and the has-ghost (replace) state, exactly like "Import ghost track" / "Replace ghost track" already do, so that recording a replacement is just as available as uploading one.
16. As a preparer, I want the Record-ghost flow to produce the same result shape (`blob` + `meta` with filename/duration/sampleRate) that the uploader produces, so that the rest of Prepare's ghost-handling code (blob storage, `ghostMeta`, guides) doesn't need to know which path was used.

## Implementation Decisions

- **New component, `GhostRecorder`**, rendered as a sibling of `GhostImporter` in `PreparePage` (in both the no-ghost and has-ghost branches) — not a mode/tab inside `GhostImporter`. `GhostImporter` stays a pure file-decode component; `GhostRecorder` owns its own capture state machine (idle → checking mic → armed/metering → recording → confirming → done) independently.
- Both components report through the same existing `onImported: (result: GhostImportResult) => void | Promise<void>` contract (`{ blob, meta: { filename, durationMs, sampleRate } }`) into the page's existing `handleImported`. Neither component needs to know about the other, and no change is needed to `handleImported`'s blob-storage / `ghostMeta` / guides logic itself — only to add the replacement-confirmation gate ahead of it (see below).
- **Capture primitive:** reuse `requestMicStream()` / `RAW_CAPTURE_CONSTRAINTS` from `audio/record.ts` as-is — same unprocessed capture as take recording. No system/tab-audio (`getDisplayMedia`) capture; out of scope.
- **Mic lifecycle:** lazy. No `getUserMedia` call happens until the preparer presses "Check mic". After a successful check, the stream stays open and is reused across repeated record/discard cycles within the same component lifetime; it is only released on unmount or once a recording is confirmed via "Use this". This mirrors `CalibrationPage`'s `ensureIo`/lazy-stream pattern.
- **Peak meter:** reuse `audio/micLevel.ts` (`framePeakAbs`, `smoothLevel`, `classifyMicLevel`) and the shared `MicLevelMeter` UI component — same approach `CalibrationPage` already uses — shown once the mic check succeeds, both before and during recording.
- **Recording primitive:** reuse `startRecording(stream)` / `pickRecorderMimeType()` from `audio/record.ts` (same `MediaRecorder` wrapper used for takes). Decode the resulting blob with `decodeAudioFile` exactly as `GhostImporter` already does, to produce `durationMs` / `sampleRate`.
- **Processed-capture warning:** reuse `isProcessedCapture(micProcessingFlags(stream))` and `RecordControl`'s existing copy ("This device insists on echo cancellation or noise suppression...") verbatim — no new copy to write or maintain.
- **Empty-recording guard:** reuse the existing `isEmptyTake({ byteSize, durationMs })` / `EMPTY_TAKE_MAX_BYTES` / `EMPTY_TAKE_MIN_DURATION_MS` constants from `audio/record.ts`. A recording that fails this check cannot be confirmed via "Use this" — the UI must show an error state and only offer "record again", the same failure semantics take recording already has.
- **Confirm-or-redo UI:** after Stop, show the recorded duration plus two actions: **Use this** (finalizes — runs `decodeAudioFile`, then calls `onImported`) and **Discard & record again** (drops the blob, returns to the armed/metering state without re-requesting the mic stream or re-running Check mic).
- **Filename for a live recording:** `ghostMeta.filename` becomes a timestamped label, e.g. `` `Recorded ghost (${formatted local date/time})` ``, distinct from an uploaded file's real filename.
- **Ghost-replacement confirmation (applies to both upload and record paths):** introduce a pure domain decision — conceptually `ghostReplacementWarning(project: Project): string | null` (exact name/location at the implementer's discretion, but it belongs in `domain/project.ts` alongside `reconcileGhostDuration` / `phrasesBeyondGhost`, is pure, and takes no DOM/React dependency) — that returns `null` when `project.phrases.length === 0` (nothing at stake, no interruption), and otherwise returns a message naming the current phrase count and, only when non-zero, the take count (e.g. "This song already has 12 phrases marked on the current ghost (and 34 recorded takes). Replacing it may shift where they land. Continue?").
- `PreparePage.handleImported` calls this function before doing anything else; if it returns a non-null message, gate the rest of `handleImported`'s existing body (blob write, `saveProject`, `setProject`) behind `window.confirm(message)` returning `true`. On cancel, `handleImported` returns immediately — no blob is written, no save happens, state is untouched. This is a single choke point shared by both the upload and record paths, since both already funnel through `handleImported`.
- Plain `window.confirm()`, not a new styled modal component — this is judged a rare, deliberate, desktop-only preparer action, consistent with the existing `window.confirm` already used for the voice-part delete cascade in this same page.
- **Glossary/decisions already recorded** in `.brain/GLOSSARY.md` ("Record ghost") and `.brain/DECISIONS.md` ("Ghost recording is mic-only, with a replace confirmation (2026-10)") as part of this spec's groundwork — an implementer should read those for the agreed terminology and rationale, not re-derive them.

## Testing Decisions

Good tests here assert observable behavior (what the component emits, what confirm dialog fires and with what copy, what ends up persisted) — not internal state transitions or which hooks were called.

- **`src/ui/preparer/GhostRecorder.test.tsx`** (new, colocated — same convention as `GhostImporter.test.tsx`): render `GhostRecorder` standalone; mock `requestMicStream`, `startRecording`/the `MediaRecorder` wrapper, and `decodeAudioFile` (same mocking shape `GhostImporter.test.tsx` already uses for `decodeAudioFile`). Cover: mic is not requested until "Check mic" is pressed; the meter appears after a successful check; Record/Stop produces a confirm step showing duration; "Use this" calls `onImported` with the `{ blob, meta }` shape (filename timestamped, not a real filename); "Discard & record again" returns to the armed state without re-invoking `requestMicStream`; a too-short/empty recording cannot be confirmed and offers only re-record; a processed-capture stream shows the reused warning copy; a mic-permission failure surfaces an error without crashing.
- **`tests/domain/project.test.ts`** (extend existing suite, same style as its `reconcileGhostDuration`/`phrasesBeyondGhost` tests): the pure warning-decision function returns `null` for a project with zero phrases; returns a message mentioning the phrase count for phrases-but-no-takes; returns a message mentioning both counts when takes also exist. No DOM, no mocks — plain input/output assertions.
- **`tests/pages/PreparePage.test.tsx`** (extend existing suite — prior art already present at the part-delete cascade test, which does `vi.spyOn(window, 'confirm').mockReturnValue(true)`): wire-level assertions only — confirm that replacing an existing ghost (with phrases present) calls `window.confirm` with the message the pure function would produce; that returning `false` from the spy leaves `ghostTrackId`/`settings.ghostMeta` unchanged and skips any blob write; that a brand-new project with zero phrases does not call `window.confirm` at all before import proceeds.
- No new test is needed inside `GhostImporter.test.tsx` itself — its existing behavior (decode, emit `onImported`, decode-failure alert) is unchanged; it simply gains a sibling in the page, not a new responsibility.

## Out of Scope

- System/tab/app audio capture (`getDisplayMedia`) as a ghost source — mic-only.
- A full Hear-style playback review (with-ghost/stack/solo) before confirming a live-recorded ghost — only duration + Use/Discard.
- A styled confirmation modal/dialog component — plain `window.confirm()`.
- Any change to how an *uploaded* ghost file is validated, decoded, or displayed — `GhostImporter` itself is unchanged.
- Any change to the "stranded phrases" banner that already exists post-replacement — it stays as the secondary, passive safety net; the new confirmation is the primary, upfront one.
- Any retroactive repair of phrases/takes after a confirmed replacement (e.g. auto-shifting phrase times to match new audio) — the confirmation only informs the decision, it does not change what happens after Continue is chosen, which remains exactly today's behavior (silent overwrite once confirmed).
- Multi-phrase/multi-take merge, pan, mixer, or any other parking-lot item named in the repo's existing TODO/learning-plan docs.

## Further Notes

- This spec's two decisions (mic-only capture; replacement confirmation) are already logged in `.brain/GLOSSARY.md` and `.brain/DECISIONS.md` on `main` as of this writing — an implementer should treat those as settled context, not re-litigate them.
- The replacement-confirmation requirement surfaced during grilling as a **pre-existing gap**, not something introduced by this feature: today, replacing a ghost via upload on a song with existing phrases already silently overwrites `ghostTrackId`. Implementing the confirmation therefore fixes present behavior for the upload path too, not only the new record path.
- Per this repo's `.hermes/plans/2026-09-23_164402-learn-matt-pocock-skills.md`, this spec and any tickets derived from it are a learning exercise on a local tracker (`.scratch/`), not an issue filed against the real GitHub tracker, and should land (if ever built) on `learn/matt-skills`, not silently onto `main`.
