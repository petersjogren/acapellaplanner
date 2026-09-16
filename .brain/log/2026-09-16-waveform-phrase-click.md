# 2026-09-16 — Click / Option-click phrases on the waveform

Prepare ghost timeline: click a phrase region to select it (same editor as the list). Option-click plays once. Unused space keeps the mark (`ew-resize`) cursor; hovering a phrase uses a select arrow, Option+hover a select+play cursor. Short hint next to the drag copy.

Click vs mark is pointer travel (`TIMELINE_CLICK_PX` 8), not `MIN_PHRASE_MS`. Overlays stay `pointer-events-none`; hit-test is `phraseAtMs`. Drag-to-mark is unchanged.
