import type { CSSProperties } from 'react'
import type { Phrase, RegionNorm } from '../../domain/schemas.ts'

export type SheetCueProps = {
  phrase: Phrase
  pageImageUrl?: string | null
}

function cropStyle(region: RegionNorm): CSSProperties {
  const w = region.w <= 0 ? 1 : region.w
  const h = region.h <= 0 ? 1 : region.h
  return {
    position: 'absolute',
    left: `${(-region.x / w) * 100}%`,
    top: `${(-region.y / h) * 100}%`,
    width: `${100 / w}%`,
    height: `${100 / h}%`,
    maxWidth: 'none',
  }
}

export function SheetCue({ phrase, pageImageUrl }: SheetCueProps) {
  const ref = phrase.sheetRefs[0]
  if (!ref || !pageImageUrl) return null
  const region = ref.regionNorm ?? { x: 0, y: 0, w: 1, h: 1 }
  const aspect = region.h <= 0 ? undefined : region.w / region.h

  return (
    <figure
      data-sheet-cue=""
      aria-label="Sheet crop"
      className="relative mt-2 max-w-xl overflow-hidden rounded-md border border-ink/10 bg-paper-shadow"
      style={aspect ? { aspectRatio: `${aspect}` } : undefined}
    >
      <img src={pageImageUrl} alt="" draggable={false} style={cropStyle(region)} />
    </figure>
  )
}
