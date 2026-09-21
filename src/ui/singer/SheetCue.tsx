import { useEffect, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { sheetScrollFrame, type SheetSlide } from '../../domain/sheets.ts'
import type { SheetRef } from '../../domain/schemas.ts'

export type SheetCueProps = {
  crops: SheetRef[]
  /** Page image URL for each of `crops`, index-matched. */
  pageImageUrls?: Array<string | null | undefined>
  /**
   * Camera 0–1 along the song film. Without `center`, 0 is hard left and
   * 1 is hard right (edge-flush). With `center`, 0–1 is a content
   * fraction kept in the middle of the viewport (clamped at the ends).
   */
  progress?: number | null
  center?: boolean
  /** Film content fraction (0–1) under a click — Play uses this to pin. */
  onPickPosition?: (u: number) => void
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
 * Sizes the full page image so this slide's crop rectangle exactly fills
 * the slide box. Layout properties, not a CSS transform: the crop is
 * static, and iPad Safari double-paints a transformed `<img>` that lives
 * inside a translating filmstrip — a half-intensity ghost of the page that
 * drifts apart from the scrolling crop. Tailwind preflight's
 * `img { max-width: 100% }` would clamp a width > 100% back to the slide,
 * so that must be overridden. This never distorts *provided* the box
 * itself is already sized to the crop's own aspect ratio (see the
 * per-slide width math in `SheetCue`).
 */
function regionStyle(region: SheetSlide['region']): CSSProperties {
  const w = region.w <= 0 ? 1 : region.w
  const h = region.h <= 0 ? 1 : region.h
  return {
    position: 'absolute',
    width: `${(1 / w) * 100}%`,
    height: `${(1 / h) * 100}%`,
    left: `${(-region.x / w) * 100}%`,
    top: `${(-region.y / h) * 100}%`,
    maxWidth: 'none',
    maxHeight: 'none',
  }
}

export function SheetCue({
  crops,
  pageImageUrls = [],
  progress: progressProp = null,
  center = false,
  onPickPosition,
}: SheetCueProps) {
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

  const frame = sheetScrollFrame(crops, pageImageUrls, progressProp ?? 0)
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
        className={`relative mt-2 max-w-xl overflow-hidden contain-paint rounded-md border border-ink/10 bg-paper-shadow${
          onPickPosition ? ' cursor-pointer' : ''
        }`}
        style={{ aspectRatio: `${aspectOf(only)}` }}
        onClick={
          onPickPosition
            ? (event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                if (!(rect.width > 0)) return
                onPickPosition(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)))
              }
            : undefined
        }
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
  const scrollLeftPx = center
    ? Math.min(maxScrollPx, Math.max(0, progress * totalWidthPx - viewportWidthPx / 2))
    : progress * maxScrollPx
  const translateXPx = -scrollLeftPx
  // No CSS transition on this translateX: Play/Sing sample elapsed every
  // rAF frame. A 100ms transition on top of that left Safari compositor
  // ghosts of the strip (the same "drifting half-intensity sheet" as the
  // nested img transform). The transform itself is already compositor-only.

  return (
    <figure
      ref={setFigureEl}
      data-sheet-cue=""
      aria-label="Sheet crop"
      className={`relative mt-2 max-w-xl overflow-hidden contain-paint rounded-md border border-ink/10 bg-paper-shadow${
        onPickPosition ? ' cursor-pointer' : ''
      }`}
      style={{ height: SHEET_CUE_SLIDE_HEIGHT_PX }}
      onClick={
        onPickPosition
          ? (event) => {
              if (!(totalWidthPx > 0)) return
              const rect = event.currentTarget.getBoundingClientRect()
              const contentX = scrollLeftPx + (event.clientX - rect.left)
              onPickPosition(Math.min(1, Math.max(0, contentX / totalWidthPx)))
            }
          : undefined
      }
    >
      <div
        data-sheet-cue-track=""
        className="flex h-full"
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
