# Manual crop rects per page

Prepare now stages sheet rectangles per page instead of treating detector output as read-only suggestions. Find systems fills the per-page lists; Clear page rects empties one page and leaves the others; drag + Add rect appends your own rect to the current page; a numbered ✕ badge drops one. Add all N / Replace film commit every rect on every page, page-major then per-page order.

The one-click Add crop (drag → straight into the film) is gone. There is exactly one way to add a crop now: stage it, then commit. Costs one extra press for a single crop, buys a single model with no "which list am I in" question.

Pure list math lives in src/domain/cropDraft.ts (CropDraft, clearDraftPage, addDraftRect, removeDraftRect, resizeDraftRect, draftRectCount, draftRefs); refsFromSuggestions moved out of PreparePage. SheetCropper stays presentational: pageRects/rectTotal in, onAddRect/onRemoveRect/onClearPageRects/onResizeRect by index out.

Draft is ephemeral UI state — no schema bump, nothing persisted until a commit. mutateDraft creates the draft on demand so Add rect works before Find systems ever runs. persistDraftFilm still calls ensureSheetPageImage for every page holding rects, because a hand-drawn rect can sit on a page whose PNG was never rendered.

Test trap found: the sheet-upload suite's fake-indexeddb structured-clones a Blob into a plain object, so a round-tripped record has no .arrayBuffer(). The suite now wraps the repository and hands back the original Blob, otherwise page-2 rendering rejects. Page-turn waits must also compare the sheet <img> src, not just the "Page 2 of 2" label — the label updates a frame before the new blob URL lands.

Not done: reorder. A rect drawn to patch a missed middle system lands at the end of its page; fixing reading order means clearing that page and redrawing.

## Follow-up same day: numbered rects

Reported symptom: a page that came back as one full-page crop, resized down and then patched with one or two manual rects, played back out of order. Not a bug in the commit path — `draftRefs` flattens in array order and `addDraftRect` appends, so the resized crop keeps index 0 and the manual rects land after it regardless of where they sit on the paper.

Rejected the obvious fix. Sorting a page's rects by `y` (or top-then-left) would reorder two-column music wrongly: the correct reading order there is the entire left column, then the entire right column, which is exactly what the detector already emits. A naive sort would silently break pages that work today.

Shipped instead: every staged rect carries a filled ink badge with its **film position**, `draftRectsBeforePage(draft, page) + index + 1`, so numbering continues across pages and equals the index `draftRefs` will commit. Wrong order is now visible on the page before Add all, and the copy says what to do about it (Clear page rects, redraw in reading order). `draftRectsBeforePage` is domain and tested against `draftRefs` so the badge cannot drift from the commit.

Badge is `bg-ink`/`text-paper` in the rect's top-left corner, the ✕ moved to the top-right with the same treatment — the old `bg-paper/90` chips were unreadable over staff lines. Both are corner-anchored so they do not sit under the n/e/s/w resize handles at the edge midpoints.
