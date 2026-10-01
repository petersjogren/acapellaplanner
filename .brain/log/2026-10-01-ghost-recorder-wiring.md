# Ghost recorder wiring + replacement confirmation

`GhostRecorder` (mic capture, Ticket 2) is now rendered next to `GhostImporter` in both Prepare ghost states, wired to the same `handleImported`.

- `handleImported` is gated by `ghostReplacementWarning(loaded)` (Ticket 1): `null` on a phrase-less song skips `window.confirm` entirely; otherwise the message names the phrase count (and take count, if any) and `window.confirm` must return true before the blob write / `saveProject` runs. Cancel leaves `ghostTrackId`, `guides`, and `settings.ghostMeta` untouched.
- One gate covers both replace paths (upload and record) since both call `handleImported`.
- No schema change, no change to `GhostRecorder.tsx` or `ghostReplacementWarning` internals — pure integration ticket.
- Tests added to `tests/pages/PreparePage.test.tsx`: no-confirm-on-fresh-project, cancel honored (blob/meta unchanged), accept honored (new blob/meta/guide), take count mentioned in the message, `GhostRecorder` renders in both ghost states. Full suite (809 tests), lint, and build all green after the change.
