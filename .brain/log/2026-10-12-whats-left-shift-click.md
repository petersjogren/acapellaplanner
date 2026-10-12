# What's left shift-click toggles Keeper and Scratch

Prepare's completion matrix ("What's left") could play a take solo, but rating
still lived only on Review. A preparer scanning the gold dots had no way to
mark a take Keeper or Scratch without leaving the page.

## What changed

- Shift-click a What's left dot toggles that take between Keeper and Scratch.
  The dot stays in recording order and changes color. Gold becomes Scratch. A
  gray dot — Scratch, a star, or unrated — becomes a Keeper. A second
  shift-click stores Scratch, and does not bring the star or the unrated state
  back.
- A sing-through take is one rating. Shift-click any covered phrase's dot and
  every phrase-dot of that take flips. Other takes in that cell stay as they
  were.
- The page writes through the existing queued `persistProject`, calling
  `rateTake` with the value computed from the live take
  (`rating === 'keeper' ? 'scratch' : 'keeper'`). Completion is re-derived on
  the way out. A failed save leaves the dot on the last saved rating and shows
  a `role="alert"` in `text-record-red`.
- A plain click, including with Alt, still plays that take solo and does not
  rate. Shift is the only toggle. Shift-click does not start, stop, or restart
  playback. The n/target count, Enough, and Final stay as they are.
- Accessible name keeps "(keeper)" only while the take is a Keeper. Title stays
  "Play this take, solo".

No schema bump. No new mix preset. No new domain module. Review's rating
buttons are unchanged. Sing does not get the gesture.

## Docs

- `.brain/CURRENT.md`: "Just landed" entry, and the completion-matrix bullet.

## Tests

- `tests/pages/PreparePage.test.tsx` (`PreparePage completion matrix`):
  Keeper → Scratch, Scratch / unrated / stars → Keeper, second shift-click
  stores Scratch, spanning take, plain and Alt clicks, Shift+Alt, shift-click
  while playback is already running, queued double toggles, failed save, and
  n/target / Enough / Final / empty cell.
