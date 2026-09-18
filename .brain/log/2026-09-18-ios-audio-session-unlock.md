# iOS Safari audio-session unlock

Symptom: on iPhone Safari, Sing's Record played the ghost fine, but Prepare's
`Play ghost` mark-along showed the playhead moving (scheduling worked) and yet
was completely silent.

Root cause: iOS Safari plays plain `AudioContext` output ("ambient" audio
session category) muted by the hardware Ring/Silent switch. `<audio>` /
`<video>` elements play in the "media" category, which ignores the switch.
`RecordControl.arm()` calls `getUserMedia()` before it plays anything, and
requesting the mic happens to flip the page's session to "media" as a side
effect — so Sing worked by accident. Prepare's mark-along never touches the
mic, so it stayed in "ambient" and got muted.

Fix: `unlockIOSAudioSession()` (`src/audio/context.ts`) loops a silent
`<audio>` element on the very first user gesture anywhere in the app,
independent of any specific page or the mic. Wired once from `App.tsx` via a
`pointerdown` / `touchend` / `keydown` listener (capture, passive), removed
after the first successful `play()`. Retries on the next gesture if `play()`
rejects (e.g. called before a real user gesture).

Silent WAV must have a real (non-zero-length) `data` chunk — a zero-length
data chunk plays instantly and never actually holds the "media" session open.
Used 100 samples (~12.5 ms) of 8-bit mono silence at 8 kHz, looped.

Tests: `tests/audio/context.test.ts` covers first-call construction, no-op on
second call, retry-after-rejection, and no-`Audio`-global safety. Cannot prove
the actual session-category behaviour in jsdom/CI — that needs a manual iPhone
Safari check with the Ring/Silent switch on.

Files: `src/audio/context.ts` (new `unlockIOSAudioSession` /
`resetIOSAudioUnlockForTests`), `src/App.tsx` (wiring), `tests/audio/context.test.ts`.
