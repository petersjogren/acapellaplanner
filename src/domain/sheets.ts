import { sortPhrases } from './phrases.ts'
import type { Project, RegionNorm, SheetRef } from './schemas.ts'

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

/** Appends a crop to the song film. Order is append order; no reorder in v1. */
export function appendSheetCrop(project: Project, ref: SheetRef): Project {
  return { ...project, sheetCrops: [...project.sheetCrops, ref] }
}

/** Drops one crop from the song film, leaving the others in order. */
export function removeSheetCrop(project: Project, refId: string): Project {
  return { ...project, sheetCrops: project.sheetCrops.filter((crop) => crop.id !== refId) }
}

function sheetPageBlobIdForRef(project: Project, ref: SheetRef): string | undefined {
  const doc = project.sheetDocs.find((item) => item.id === ref.sheetDocId)
  return doc?.pages.find((page) => page.pageIndex === ref.pageIndex)?.imageBlobId
}

/** Page image blob id for every crop in the film, in order. */
export function sheetPageBlobIdsForCrops(project: Project, crops: SheetRef[]): Array<string | undefined> {
  return crops.map((ref) => sheetPageBlobIdForRef(project, ref))
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
  /** Every crop in the song film, in append order — the filmstrip's slides, left to right. */
  slides: SheetSlide[]
  /**
   * Camera 0–1 along the film. The UI (`SheetCue`) maps this onto scroll
   * position — 0 is hard left (first slide's left edge flush with the
   * viewport), 1 is hard right (last slide's right edge flush with the
   * viewport). Callers pass `filmScrollProgress` (occupied phrase time).
   * One crop ignores progress and stays unscrolled.
   */
  progress: number
}

/**
 * Ghost time mapped onto “music time”: only ticks inside a phrase.
 * Before the first phrase, after the last, and in unmarked gaps: hold.
 */
export function occupiedDurationMs(phrases: Array<{ startMs: number; endMs: number }>): number {
  return phrases.reduce((sum, phrase) => sum + Math.max(0, phrase.endMs - phrase.startMs), 0)
}

export function ghostToOccupiedMs(
  phrases: Array<{ startMs: number; endMs: number }>,
  ghostMs: number,
): number {
  const ordered = sortPhrases(phrases)
  if (ordered.length === 0) return 0
  let acc = 0
  for (const phrase of ordered) {
    if (ghostMs < phrase.startMs) return acc
    if (ghostMs < phrase.endMs) return acc + (ghostMs - phrase.startMs)
    acc += Math.max(0, phrase.endMs - phrase.startMs)
  }
  return acc
}

/** 0–1 camera progress along the song film. Empty or zero-duration phrases → 0. */
export function filmScrollProgress(
  phrases: Array<{ startMs: number; endMs: number }>,
  ghostMs: number,
): number {
  const duration = occupiedDurationMs(phrases)
  if (!(duration > 0)) return 0
  return clamp(ghostToOccupiedMs(phrases, ghostMs) / duration, 0, 1)
}

/**
 * Lays the song film out as slides and returns the given camera `progress`.
 * One crop just shows it, unscrolled. The caller (`SheetCue`) turns
 * `progress` into `translateX` from measured widths.
 */
export function sheetScrollFrame(
  crops: SheetRef[],
  imageKeys: Array<string | undefined | null>,
  progress: number,
): SheetScrollFrame | null {
  if (crops.length === 0) return null
  const slides: SheetSlide[] = crops.map((ref, index) => ({
    id: ref.id,
    region: ref.regionNorm ?? FULL_REGION,
    imageKey: imageKeys[index] ?? undefined,
  }))
  if (slides.length === 1) {
    return { slides, progress: 0 }
  }
  return { slides, progress: clamp(progress, 0, 1) }
}
