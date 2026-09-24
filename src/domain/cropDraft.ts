import type { RegionNorm, SheetRef } from './schemas.ts'

/**
 * Per-page rectangles staged for the score film: detector output plus
 * hand-drawn rects, in commit order. Ephemeral UI state — never persisted,
 * only flattened into `SheetRef[]` when the preparer commits the film.
 */
export type CropDraft = {
  docId: string
  byPage: RegionNorm[][]
}

/** Copy of `byPage` long enough to address `upTo`, with empty pages filled in. */
function pagesUpTo(byPage: RegionNorm[][], upTo: number): RegionNorm[][] {
  const next = byPage.map((page) => page)
  while (next.length <= upTo) next.push([])
  return next
}

/** Empties one page's rects. Other pages keep theirs. */
export function clearDraftPage(draft: CropDraft, pageIndex: number): CropDraft {
  if (pageIndex < 0) return draft
  const byPage = pagesUpTo(draft.byPage, pageIndex)
  byPage[pageIndex] = []
  return { ...draft, byPage }
}

/** Appends a hand-drawn rect to the end of that page's list. */
export function addDraftRect(draft: CropDraft, pageIndex: number, region: RegionNorm): CropDraft {
  if (pageIndex < 0) return draft
  const byPage = pagesUpTo(draft.byPage, pageIndex)
  byPage[pageIndex] = [...byPage[pageIndex]!, region]
  return { ...draft, byPage }
}

/** Drops one rect, leaving the rest of that page in order. */
export function removeDraftRect(draft: CropDraft, pageIndex: number, index: number): CropDraft {
  const page = draft.byPage[pageIndex]
  if (!page || index < 0 || index >= page.length) return draft
  const byPage = draft.byPage.map((item) => item)
  byPage[pageIndex] = page.filter((_, i) => i !== index)
  return { ...draft, byPage }
}

/** Replaces one rect in place — the resize handles' write path. */
export function resizeDraftRect(
  draft: CropDraft,
  pageIndex: number,
  index: number,
  region: RegionNorm,
): CropDraft {
  const page = draft.byPage[pageIndex]
  if (!page || index < 0 || index >= page.length) return draft
  const byPage = draft.byPage.map((item) => item)
  byPage[pageIndex] = page.map((box, i) => (i === index ? region : box))
  return { ...draft, byPage }
}

export function draftRectCount(draft: CropDraft | null): number {
  if (!draft) return 0
  return draft.byPage.reduce((sum, page) => sum + page.length, 0)
}

/**
 * Rects committed before this page — the film position of that page's first
 * rect, minus one. Lets the cropper badge a rect with its place in the whole
 * film instead of its per-page index.
 */
export function draftRectsBeforePage(draft: CropDraft | null, pageIndex: number): number {
  if (!draft) return 0
  let count = 0
  for (let i = 0; i < pageIndex && i < draft.byPage.length; i++) {
    count += draft.byPage[i]?.length ?? 0
  }
  return count
}

/** Commit order: page-major, then the page's own array order. */
export function draftRefs(draft: CropDraft): SheetRef[] {
  const refs: SheetRef[] = []
  for (let pageIndex = 0; pageIndex < draft.byPage.length; pageIndex++) {
    for (const regionNorm of draft.byPage[pageIndex] ?? []) {
      refs.push({ id: crypto.randomUUID(), sheetDocId: draft.docId, pageIndex, regionNorm })
    }
  }
  return refs
}
