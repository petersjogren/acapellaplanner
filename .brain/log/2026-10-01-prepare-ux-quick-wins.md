# Prepare UX quick wins: nav dot, ghost grouping, file-input styling

Four small, reversible UI fixes to the Prepare page, surfaced during a UX review (grilled against the actual code rather than a screenshot guess) and confirmed with the user before implementing.

- **Review nav dot removed.** `PreparerShell`'s nav rendered a static `bg-gold` dot next to "Review" unconditionally — no data (take ratings, completion, anything) ever fed it, and no test asserted it. It looked like a notification but meant nothing. Deleted outright rather than wiring it to a real signal (that's a bigger feature — a genuine "N unrated takes" indicator — tracked as a future idea, not done here).
- **Ghost track grouping.** The has-ghost state of `PreparePage` already wrapped `GhostImporter` + `GhostRecorder` in one `<section aria-label="Ghost track"><h3>Ghost track</h3>` card. The no-ghost (first-time) state rendered them as bare `<>` siblings with no shared heading, making Import and Record look like two unrelated features instead of two paths to the same goal. Now both states use the same wrapper.
- **Ghost caption on Record.** `PreparePage` already shows "The ghost is the lead everyone locks to." once, above the ghost section. `GhostRecorder` had no equivalent explanation for what "Record ghost" does differently from importing. Added a one-line caption ("Capture it live over your mic instead of uploading a file.") — deliberately *not* the same sentence, to avoid literal duplication on the same page.
- **Styled file inputs.** `GhostImporter` and `SheetUploader` already styled the button part of `<input type=file>` via Tailwind's `file:` pseudo-element, but the trailing "No file chosen" text is browser-drawn shadow content — CSS cannot target or hide it reliably (tried `color: transparent` first; it still reserves layout width and isn't a real DOM node). Fixed properly: the native input is now `sr-only` (visually hidden, still functional and accessible) and a second `<label htmlFor={inputId}>` styled as the existing dark-pill button is the visible trigger. `getByLabelText` in RTL tests still resolves the input via the first (text) label, so the test API is unchanged.

## Picked-filename chip: added, then partly reverted

Both components briefly also got a filename chip shown after a file was picked. Two bugs surfaced during verification, both in `GhostImporter`:

1. **Race against the real save.** The chip was set synchronously on file selection, before `decodeAudioFile` + `onImported` (which persists via `saveProject`) had resolved. `tests/pages/PreparePage.test.tsx`'s accept/cancel tests wait for the filename to appear on screen as proof the save landed — showing it early broke that invariant and could mislead a real user the same way. Fixed: `setPickedName` now runs only after `onImported` resolves, in both `GhostImporter` and `SheetUploader`.
2. **Duplicate display.** `PreparePage` already renders `ghostMeta.filename` once an import lands (`<p>{ghostMeta.filename}</p>` in the has-ghost card). Adding a second filename chip inside `GhostImporter` itself meant two DOM nodes with the same text once a ghost existed — `screen.getByText(...)` in `PreparePage.test.tsx` started throwing "found multiple elements". Removed the chip from `GhostImporter` entirely; kept it in `SheetUploader`, which has no other filename display on the page.

## Verification

- `npm test`: 809/809 passing.
- `npm run lint` (oxlint): clean.
- `npm run build`: clean, no new warnings.
- Manually loaded the dev server and inspected the rendered Prepare page (new/empty song) via the browser tool + vision check: Review dot gone, Ghost track card groups both ghost-acquisition methods, Record ghost shows its caption, both file pickers show "Choose file" buttons with no native browser chrome.

No schema change. No `.brain/GLOSSARY.md` change (no new/renamed/retired term — "Ghost track" as a section label was already in use in the has-ghost state). No ADR: all four changes are small and freely reversible, not architectural trade-offs.
