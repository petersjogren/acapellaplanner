import { useEffect, useState, type CSSProperties, type SyntheticEvent } from 'react'
import {
  containCropBox,
  cropAspect,
  filmTrackLayout,
  sheetScrollFrame,
  type SheetSlide,
} from '../../domain/sheets.ts'
import type { SheetRef } from '../../domain/schemas.ts'

export { containCropBox }

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
 * Fallback film height when the figure has not been measured yet (jsdom,
 * first paint). Live booths size slides from the measured figure height so
 * the strip fills leftover viewport. Width math must use that same height
 * (`heightPx * ownAspect`) or the crop distorts.
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

const FILM_FRAME_CLASS =
  'absolute inset-0 overflow-hidden contain-paint rounded-md border border-ink/10 bg-paper-shadow'

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
  // width vs the viewport's real width, and so slide height matches the
  // painted figure (booth dock layout). Only width matters for scroll
  // range; height matters for never-stretch width math.
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
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
    let cancelled = false
    const update = () => {
      if (cancelled) return
      setViewportSize({ w: figureEl.clientWidth, h: figureEl.clientHeight })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(figureEl)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [figureEl])

  const frame = sheetScrollFrame(crops, pageImageUrls, progressProp ?? 0)
  if (!frame || frame.slides.length === 0) return null

  const { slides, progress } = frame
  if (!slides.some((slide) => slide.imageKey)) return null

  const viewportWidthPx = viewportSize.w
  const slideHeightPx = viewportSize.h > 0 ? viewportSize.h : SHEET_CUE_SLIDE_HEIGHT_PX

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
    const box = containCropBox(
      cropAspect(only.region, only.imageKey ? naturalSizes[only.imageKey] : undefined),
      viewportWidthPx,
      viewportSize.h,
      SHEET_CUE_SLIDE_HEIGHT_PX,
    )
    // Single crop: contain the box in the full-width film viewport so a
    // square crop never becomes window-tall. Same never-stretch guarantee
    // as the filmstrip — the box is the crop's own aspect.
    return (
      <figure
        ref={setFigureEl}
        data-sheet-cue=""
        aria-label="Sheet crop"
        className={`${FILM_FRAME_CLASS} flex items-center${onPickPosition ? ' cursor-pointer' : ''}`}
        onClick={
          onPickPosition
            ? (event) => {
                const boxEl = event.currentTarget.querySelector('[data-sheet-crop-box]')
                const rect = (boxEl ?? event.currentTarget).getBoundingClientRect()
                if (!(rect.width > 0)) return
                onPickPosition(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)))
              }
            : undefined
        }
      >
        <div
          data-sheet-crop-box=""
          className="relative shrink-0 overflow-hidden"
          style={{ width: box.width, height: box.height }}
        >
          <img
            src={only.imageKey}
            alt=""
            draggable={false}
            style={regionStyle(only.region)}
            onLoad={handleLoad(only)}
          />
        </div>
      </figure>
    )
  }

  // Multi-crop filmstrip: domain `filmTrackLayout` sizes each slide to
  // slideHeightPx * its own aspect (never an equal-width share) and maps
  // progress onto scroll. 0 is hard left, 1 is hard right; a strip
  // narrower than the viewport does not scroll.
  const layout = filmTrackLayout({
    aspects: slides.map((slide) =>
      cropAspect(slide.region, slide.imageKey ? naturalSizes[slide.imageKey] : undefined),
    ),
    viewportWidthPx,
    viewportHeightPx: slideHeightPx,
    progress,
    center,
  })
  // No CSS transition on this translateX: Play/Sing sample elapsed every
  // rAF frame. A 100ms transition on top of that left Safari compositor
  // ghosts of the strip (the same "drifting half-intensity sheet" as the
  // nested img transform). The transform itself is already compositor-only.

  return (
    <figure
      ref={setFigureEl}
      data-sheet-cue=""
      aria-label="Sheet crop"
      className={`${FILM_FRAME_CLASS}${onPickPosition ? ' cursor-pointer' : ''}`}
      onClick={
        onPickPosition
          ? (event) => {
              if (!(layout.totalWidthPx > 0)) return
              const rect = event.currentTarget.getBoundingClientRect()
              const contentX = layout.scrollLeftPx + (event.clientX - rect.left)
              onPickPosition(Math.min(1, Math.max(0, contentX / layout.totalWidthPx)))
            }
          : undefined
      }
    >
      <div
        data-sheet-cue-track=""
        className="flex h-full"
        style={{ width: layout.totalWidthPx, transform: `translateX(${layout.translateXPx}px)` }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            data-sheet-slide={index}
            className="relative h-full shrink-0 overflow-hidden"
            style={{ width: layout.slideBoxes[index]!.width }}
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
