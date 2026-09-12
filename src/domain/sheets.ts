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
  const current = project.phrases.find((item) => item.id === phraseId)
  if (!current) {
    throw new Error(`Phrase ${phraseId} not found`)
  }
  const sheetRefs = [
    ...current.sheetRefs.filter(
      (item) => !(item.sheetDocId === ref.sheetDocId && item.pageIndex === ref.pageIndex),
    ),
    ref,
  ]
  const phrases = project.phrases.map((item) => (item.id === phraseId ? { ...item, sheetRefs } : item))
  return { ...project, phrases }
}

export function sheetPageBlobId(project: Project, phrase: Phrase): string | undefined {
  const ref = phrase.sheetRefs[0]
  if (!ref) return undefined
  const doc = project.sheetDocs.find((item) => item.id === ref.sheetDocId)
  return doc?.pages.find((page) => page.pageIndex === ref.pageIndex)?.imageBlobId
}
