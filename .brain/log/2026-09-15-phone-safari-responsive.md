# Phone Safari responsive pass

Home/Prepare/Sing shells and the home song-list row were tuned for desktop/iPad
widths and looked cramped on iPhone Safari (portrait and landscape). Fixed
without changing the web layout: everything above the existing `md:` (768px)
breakpoint is byte-identical to before.

- `PreparerShell` / `SingerShell`: nav collapses to a horizontal bar and
  content stacks under `md:`; safe-area insets on left/right padding.
- `HomePage`: page padding gets safe-area insets; the song-list row (title,
  date, Rename/Export/Delete) was the worst offender — all five pieces were
  forced onto one line and the Rename button visually collided with the
  timestamp. Now stacks into a bordered card below `sm:`, unchanged above it.
- `tokens.css`: display/lyric type scales down under 430px width or in short
  landscape (`max-height: 430px`), so headline type doesn't overwhelm a phone
  screen.
- `index.html`: `viewport-fit=cover` so `env(safe-area-inset-*)` resolves.

Verified via CDP device-metric emulation + screenshot + vision review at
iPhone 14 portrait/landscape (390×844 / 844×390) and iPhone SE (375×667 /
667×375). Not covered by the test suite (jsdom has no CSS layout or `env()`);
see LEARNINGS for the inline-style/safe-area pitfall this caught.
