import { useEffect, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { sheetScrollFrame, type SheetSlide } from '../../domain/sheets.ts'
import type { Phrase } from '../../domain/schemas.ts'

export type SheetCueProps = {
  phrase: Phrase
  /** Page image URL for each of `phrase.sheetRefs`, index-matched. */
  pageImageUrls?: Array<string | null | undefined>
  /**
   * Ghost ms elapsed since the phrase started. Drives the horizontal
   * filmstrip scroll across a multi-crop phrase: elapsed 0 is scrolled
   * hard left (the first crop's own left edge flush with the viewport's
   * left edge), elapsed = phrase duration is scrolled hard right (the last
   * crop's own right edge flush with the viewport's right edge), linear
   * in between and never past either end. A single-crop phrase ignores it
   * entirely. Missing/null pins to the start (hard left).
   */
  elapsedMs?: number | null
}

/**
 * Every filmstrip slide renders at this exact pixel height — not a rem/CSS
 * value — so the width math below (`SHEET_CUE_SLIDE_HEIGHT_PX * ownAspect`)
 * is guaranteed to match what the browser actually paints, regardless of
 * root font-size or zoom. If those two ever drifted apart, a slide's box
 * would stop being exactly its crop's own aspect ratio and the image
 * inside it would distort to fill the mismatch — the one thing this
 * component must never do. Each crop keeps its own true proportions; only
 * the fixed *height* is shared, exactly like a real contact-sheet filmstrip.
 */
export const SHEET_CUE_SLIDE_HEIGHT_PX = 220

/**
 * Absolutely fills its slide box and translates/scales so exactly the
 * slide's own crop rectangle is visible. This never distorts *provided*
 * the box itself is already sized to the crop's own aspect ratio (see the
 * per-slide width math in `SheetCue`) — scaling a correctly-cropped image
 * to fill a box of the *wrong* aspect is exactly what stretches a crop.
 */
function regionStyle(region: SheetSlide['region']): CSSProperties {
  const w = region.w <= 0 ? 1 : region.w
  const h = region.h <= 0 ? 1 : region.h
  const tx = (-region.x / w) * 100
  const ty = (-region.y / h) * 100
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    transformOrigin: '0 0',
    transform: `translate(${tx}%, ${ty}%) scale(${1 / w}, ${1 / h})`,
  }
}

export function SheetCue({ phrase, pageImageUrls = [], elapsedMs = null }: SheetCueProps) {
  // True aspect ratio per image (page pixels), corrected once that slide's
  // own <img> has loaded — region fractions alone don't account for the
  // source page's real pixel dimensions. Keyed by imageKey so several
  // slides sharing one page image share one cached size.
  const [naturalSizes, setNaturalSizes] = useState<Record<string, { w: number; h: number }>>({})
  // Measured so scroll position can be computed against the strip's real
  // width vs the viewport's real width. Only matters for the multi-slide
  // filmstrip; harmless (and cheap) to keep measuring in the single-crop
  // case too rather than call this hook conditionally.
  const [viewportWidthPx, setViewportWidthPx] = useState(0)
  // A *callback* ref (state, not useRef) on purpose: the caller (SingPage)
  // resolves crop image URLs asynchronously, so this component often
  // renders `null` first and only mounts a real <figure> once those
  // resolve. A plain `useRef` + `useEffect(fn, [])` only runs once, at the
  // instance's very first commit — while there was still no <figure> to
  // measure — and never re-fires once the real element shows up later, so
  // `viewportWidthPx` would stay stuck at 0 forever. That made `maxScrollPx`
  // equal the strip's *entire* width, scrolling everything (including the
  // last crop) off-screen to the left at elapsed = duration instead of
  // stopping with the last crop's right edge at the viewport's right edge.
  // A ref callback re-fires on every mount of the node it's attached to,
  // however many renders that takes to happen.
  const [figureEl, setFigureEl] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!figureEl) return
    const update = () => setViewportWidthPx(figureEl.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(figureEl)
    return () => observer.disconnect()
  }, [figureEl])

  const durationMs = Math.max(0, phrase.endMs - phrase.startMs)
  const frame = sheetScrollFrame(phrase.sheetRefs, pageImageUrls, elapsedMs ?? 0, durationMs)
  if (!frame || frame.slides.length === 0) return null

  const { slides, progress } = frame
  if (!slides.some((slide) => slide.imageKey)) return null

  function aspectOf(slide: SheetSlide): number {
    const region = slide.region
    const w = region.w <= 0 ? 1 : region.w
    const h = region.h <= 0 ? 1 : region.h
    const natural = slide.imageKey ? naturalSizes[slide.imageKey] : undefined
    if (natural) {
      return (w * natural.w) / Math.max(1e-6, h * natural.h)
    }
    return w / h
  }

  function handleLoad(slide: SheetSlide) {
    return (event: SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget
      const key = slide.imageKey
      if (!key || !img.naturalWidth || !img.naturalHeight) return
      setNaturalSizes((prev) =>
        prev[key]?.w === img.naturalWidth && prev[key]?.h === img.naturalHeight
          ? prev
          : { ...prev, [key]: { w: img.naturalWidth, h: img.naturalHeight } },
      )
    }
  }

  if (slides.length === 1) {
    const only = slides[0]!
    if (!only.imageKey) return null
    // Single crop: no filmstrip needed, just hug the box to the crop's own
    // aspect ratio exactly (same never-stretch guarantee, simpler layout).
    return (
      <figure
        ref={setFigureEl}
        data-sheet-cue=""
        aria-label="Sheet crop"
        className="relative mt-2 max-w-xl overflow-hidden rounded-md border border-ink/10 bg-paper-shadow"
        style={{ aspectRatio: `${aspectOf(only)}` }}
      >
        <img
          src={only.imageKey}
          alt=""
          draggable={false}
          style={regionStyle(only.region)}
          onLoad={handleLoad(only)}
        />
      </figure>
    )
  }

  // Multi-crop filmstrip: each slide keeps its own true crop aspect ratio —
  // never squeezed into an equal-width share of the track — by sizing its
  // width to SHEET_CUE_SLIDE_HEIGHT_PX * its own aspect, then laying every
  // slide out side by side. `progress` (0–1) maps directly onto scroll
  // position: 0 is scrolled hard left (first slide's left edge flush with
  // the viewport's left edge — every part of it visible from elapsed 0),
  // 1 is scrolled hard right (last slide's right edge flush with the
  // viewport's right edge). `maxScrollPx` is clamped to >= 0 so a strip
  // narrower than the viewport (few/small crops) just never scrolls,
  // rather than reserving empty space past either edge.
  const widths = slides.map((slide) => SHEET_CUE_SLIDE_HEIGHT_PX * (aspectOf(slide) || 1))
  const totalWidthPx = widths.reduce((sum, width) => sum + width, 0)
  const maxScrollPx = Math.max(0, totalWidthPx - viewportWidthPx)
  const scrollLeftPx = progress * maxScrollPx
  const translateXPx = -scrollLeftPx

  return (
    <figure
      ref={setFigureEl}
      data-sheet-cue=""
      aria-label="Sheet crop"
      className="relative mt-2 max-w-xl overflow-hidden rounded-md border border-ink/10 bg-paper-shadow"
      style={{ height: SHEET_CUE_SLIDE_HEIGHT_PX }}
    >
      <div
        data-sheet-cue-track=""
        className="sheet-cue-pan flex h-full"
        style={{ width: totalWidthPx, transform: `translateX(${translateXPx}px)` }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            data-sheet-slide={index}
            className="relative h-full shrink-0 overflow-hidden"
            style={{ width: widths[index] }}
          >
            {slide.imageKey ? (
              <img
                src={slide.imageKey}
                alt=""
                draggable={false}
                style={regionStyle(slide.region)}
                onLoad={handleLoad(slide)}
              />
            ) : null}
          </div>
        ))}
      </div>
    </figure>
  )
}
