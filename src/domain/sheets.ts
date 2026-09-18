import type { Phrase, Project, RegionNorm, SheetRef } from './schemas.ts'

export const MIN_REGION_NORM = 0.02

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function regionFromDrag(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  height: number,
): RegionNorm {
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 }
  }

  const left = clamp(Math.min(x1, x2), 0, width)
  const right = clamp(Math.max(x1, x2), 0, width)
  const top = clamp(Math.min(y1, y2), 0, height)
  const bottom = clamp(Math.max(y1, y2), 0, height)

  let x = left / width
  let y = top / height
  let w = (right - left) / width
  let h = (bottom - top) / height

  const minW = Math.min(MIN_REGION_NORM, 1)
  const minH = Math.min(MIN_REGION_NORM, 1)
  if (w < minW) {
    w = minW
    x = clamp(x, 0, 1 - w)
  }
  if (h < minH) {
    h = minH
    y = clamp(y, 0, 1 - h)
  }

  // Compare sums instead of `1 - x`: 1 - 0.9 is 0.0999… in IEEE float.
  if (x + w > 1) w = Math.max(0, 1 - x)
  if (y + h > 1) h = Math.max(0, 1 - y)
  return { x, y, w, h }
}

export function bindSheetRefToPhrase(project: Project, phraseId: string, ref: SheetRef): Project {
  if (!project.phrases.some((item) => item.id === phraseId)) {
    throw new Error(`Phrase ${phraseId} not found`)
  }
  // Sets the phrase's *only* crop, discarding any others. This is the quick
  // "just replace what's there" path — for phrases that want to walk through
  // several crops in sequence, see `addSheetRefToPhrase`.
  const phrases = project.phrases.map((item) =>
    item.id === phraseId ? { ...item, sheetRefs: [ref] } : item,
  )
  return { ...project, phrases }
}

/**
 * Appends another crop to the phrase's sequence instead of replacing it —
 * for a phrase whose notes span more than one crop, so the booth can
 * soft-scroll through them in order (see `sheetScrollFrame`). Order is
 * append order; there is no separate "reorder" affordance yet.
 */
export function addSheetRefToPhrase(project: Project, phraseId: string, ref: SheetRef): Project {
  if (!project.phrases.some((item) => item.id === phraseId)) {
    throw new Error(`Phrase ${phraseId} not found`)
  }
  const phrases = project.phrases.map((item) =>
    item.id === phraseId ? { ...item, sheetRefs: [...item.sheetRefs, ref] } : item,
  )
  return { ...project, phrases }
}

/** Drops one crop from a phrase's sequence, leaving the others in order. */
export function removeSheetRefFromPhrase(project: Project, phraseId: string, refId: string): Project {
  const phrases = project.phrases.map((item) =>
    item.id === phraseId
      ? { ...item, sheetRefs: item.sheetRefs.filter((ref) => ref.id !== refId) }
      : item,
  )
  return { ...project, phrases }
}

function sheetPageBlobIdForRef(project: Project, ref: SheetRef): string | undefined {
  const doc = project.sheetDocs.find((item) => item.id === ref.sheetDocId)
  return doc?.pages.find((page) => page.pageIndex === ref.pageIndex)?.imageBlobId
}

export function sheetPageBlobId(project: Project, phrase: Phrase): string | undefined {
  const ref = phrase.sheetRefs[0]
  if (!ref) return undefined
  return sheetPageBlobIdForRef(project, ref)
}

/** Same lookup as `sheetPageBlobId`, but for every crop bound to the phrase, in order. */
export function sheetPageBlobIdsForPhrase(project: Project, phrase: Phrase): Array<string | undefined> {
  return phrase.sheetRefs.map((ref) => sheetPageBlobIdForRef(project, ref))
}

export type SheetSlide = {
  /** `SheetRef.id` — stable identity for React keys and per-slide lookups. */
  id: string
  region: RegionNorm
  /** Caller-supplied key (image URL or blob id) for the image this slide's crop is on. */
  imageKey?: string
}

const FULL_REGION: RegionNorm = { x: 0, y: 0, w: 1, h: 1 }

export type SheetScrollFrame = {
  /** Every crop bound to the phrase, in bind order — the filmstrip's slides, left to right. */
  slides: SheetSlide[]
  /**
   * Linear 0–1 ratio of how far through the phrase `elapsedMs` is: 0 at
   * elapsed 0, 1 at elapsed = `durationMs`, clamped to that range. The UI
   * (`SheetCue`) maps this straight onto scroll position — 0 scrolls the
   * filmstrip hard left (the first slide's own left edge flush with the
   * viewport), 1 scrolls it hard right (the last slide's own right edge
   * flush with the viewport, with zero empty space beyond it) — so the
   * whole strip is used exactly once, start to finish, over the phrase's
   * duration. There is no separate "same image" special case: scrolling
   * past crops on one shared page and scrolling across a page/doc boundary
   * are the same one-dimensional motion.
   */
  progress: number
}

/**
 * Where the sheet filmstrip should be scrolled to, `elapsedMs` into a
 * phrase that may be bound to several crops. One crop just shows it,
 * unscrolled. Several crops are laid out as a horizontal filmstrip and
 * `progress` is elapsed time's linear 0–1 position in the phrase — see
 * `SheetScrollFrame.progress` for the exact mapping. The caller
 * (`SheetCue`) is responsible for turning `progress` into an actual
 * `translateX` on the rendered track, using the strip's and viewport's
 * real measured widths so it never scrolls past either end.
 */
export function sheetScrollFrame(
  sheetRefs: SheetRef[],
  imageKeys: Array<string | undefined | null>,
  elapsedMs: number,
  durationMs: number,
): SheetScrollFrame | null {
  if (sheetRefs.length === 0) return null
  const slides: SheetSlide[] = sheetRefs.map((ref, index) => ({
    id: ref.id,
    region: ref.regionNorm ?? FULL_REGION,
    imageKey: imageKeys[index] ?? undefined,
  }))
  if (slides.length === 1) {
    return { slides, progress: 0 }
  }
  const progress = durationMs > 0 ? clamp(elapsedMs / durationMs, 0, 1) : 0
  return { slides, progress }
}
