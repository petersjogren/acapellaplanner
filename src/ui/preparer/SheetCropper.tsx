import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { regionFromDrag, resizeRegionNorm, type RegionEdge } from '../../domain/sheets.ts'
import type { RegionNorm, SheetRef } from '../../domain/schemas.ts'

export type SheetCropperProps = {
  pageImageUrl: string
  pageIndex: number
  pageCount: number
  crops: SheetRef[]
  hasPhrases?: boolean
  onPageChange: (pageIndex: number) => void | Promise<void>
  onRemoveCrop?: (refId: string) => void | Promise<void>
  /** Rects staged on the page currently shown — detector output plus hand-drawn ones. */
  pageRects?: RegionNorm[]
  /** Rects staged across every page; drives the Add all / Replace labels. */
  rectTotal?: number
  /**
   * Rects staged on earlier pages. Badges show film position (`offset + index + 1`),
   * not the per-page index, so the numbers read as the order Play will scroll.
   */
  rectNumberOffset?: number
  finding?: boolean
  findError?: string | null
  onFindSystems?: () => void | Promise<void>
  onAddRect?: (region: RegionNorm) => void | Promise<void>
  onRemoveRect?: (index: number) => void
  onClearPageRects?: (pageIndex: number) => void
  onAddAll?: () => void | Promise<void>
  onReplaceFilm?: () => void | Promise<void>
  onDismissRects?: () => void
  onResizeRect?: (index: number, region: RegionNorm) => void
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function capturePointer(target: HTMLElement, pointerId: number) {
  if (typeof target.setPointerCapture !== 'function') return
  try {
    target.setPointerCapture(pointerId)
  } catch {
    // jsdom and already-captured pointers
  }
}

function releasePointer(target: HTMLElement, pointerId: number) {
  if (typeof target.releasePointerCapture !== 'function') return
  try {
    if (typeof target.hasPointerCapture === 'function' && !target.hasPointerCapture(pointerId)) {
      return
    }
    target.releasePointerCapture(pointerId)
  } catch {
    // jsdom
  }
}

function localPoint(event: ReactPointerEvent<HTMLElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

export function SheetCropper({
  pageImageUrl,
  pageIndex,
  pageCount,
  crops,
  hasPhrases = true,
  onPageChange,
  onRemoveCrop,
  pageRects = [],
  rectTotal = 0,
  rectNumberOffset = 0,
  finding = false,
  findError = null,
  onFindSystems,
  onAddRect,
  onRemoveRect,
  onClearPageRects,
  onAddAll,
  onReplaceFilm,
  onDismissRects,
  onResizeRect,
}: SheetCropperProps) {
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{
    index: number
    edge: RegionEdge
    region: RegionNorm
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [preview, setPreview] = useState<RegionNorm | null>(null)
  const [region, setRegion] = useState<RegionNorm | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRegion(null)
    setPreview(null)
  }, [pageImageUrl, pageIndex])

  function regionFromEvent(event: ReactPointerEvent<HTMLElement>, start: { x: number; y: number }) {
    const point = localPoint(event)
    const rect = event.currentTarget.getBoundingClientRect()
    return regionFromDrag(start.x, start.y, point.x, point.y, rect.width, rect.height)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    if (resizeRef.current) return
    event.preventDefault()
    const point = localPoint(event)
    dragRef.current = point
    setPreview(null)
    capturePointer(event.currentTarget, event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = dragRef.current
    if (!start) return
    setPreview(regionFromEvent(event, start))
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>, commit: boolean) {
    const start = dragRef.current
    dragRef.current = null
    setPreview(null)
    releasePointer(event.currentTarget, event.pointerId)
    if (!commit || !start) return
    setRegion(regionFromEvent(event, start))
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>, index: number, edge: RegionEdge) {
    event.stopPropagation()
    event.preventDefault()
    const box = pageRects[index]
    const page = pageRef.current
    if (!box || !page || !onResizeRect) return
    const rect = page.getBoundingClientRect()
    resizeRef.current = {
      index,
      edge,
      region: box,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    }
    capturePointer(event.currentTarget, event.pointerId)
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = resizeRef.current
    if (!drag || !onResizeRect) return
    const dx = drag.width > 0 ? (event.clientX - drag.x) / drag.width : 0
    const dy = drag.height > 0 ? (event.clientY - drag.y) / drag.height : 0
    onResizeRect(drag.index, resizeRegionNorm(drag.region, drag.edge, dx, dy))
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    resizeRef.current = null
    releasePointer(event.currentTarget, event.pointerId)
  }

  async function handleAddRect() {
    if (!region || !onAddRect) return
    try {
      await onAddRect(region)
      setRegion(null)
      setError(null)
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not add rect'))
    }
  }

  async function handleRemoveCrop(refId: string) {
    if (!onRemoveCrop) return
    try {
      await onRemoveCrop(refId)
      setError(null)
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not remove sheet crop'))
    }
  }

  const overlay = preview ?? region
  const canPrev = pageIndex > 0
  const canNext = pageIndex + 1 < pageCount

  return (
    <section className="mt-6 max-w-3xl" aria-label="Sheet crop">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => void onPageChange(pageIndex - 1)}
          className="rounded-md border border-ink/15 px-3 py-1 font-medium disabled:opacity-50"
        >
          Previous page
        </button>
        <p className="text-ink-muted">
          Page {pageIndex + 1} of {pageCount}
        </p>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => void onPageChange(pageIndex + 1)}
          className="rounded-md border border-ink/15 px-3 py-1 font-medium disabled:opacity-50"
        >
          Next page
        </button>
      </div>
      <div
        ref={pageRef}
        aria-label="Sheet page"
        className="relative mt-3 cursor-crosshair touch-none overflow-hidden rounded-md border border-ink/15 bg-paper-shadow"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, false)}
      >
        <img src={pageImageUrl} alt="" draggable={false} className="block w-full select-none" />
        {pageRects.map((box, index) => (
          <div
            key={index}
            data-page-rect=""
            className="pointer-events-none absolute border border-dashed border-ink"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          >
            <span
              data-rect-number=""
              className="pointer-events-none absolute left-0 top-0 min-w-6 rounded-br-md rounded-tl-sm bg-ink px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-paper"
            >
              {rectNumberOffset + index + 1}
            </span>
            {onRemoveRect ? (
              <button
                type="button"
                aria-label={`Remove rect ${rectNumberOffset + index + 1}`}
                className="pointer-events-auto absolute right-0 top-0 rounded-bl-md rounded-tr-sm bg-ink px-1.5 py-0.5 text-xs font-semibold text-paper studio-transition hover:bg-record-red"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onRemoveRect(index)}
              >
                ✕
              </button>
            ) : null}
            {onResizeRect
              ? (
                  [
                    ['n', 'top', '50%', '0%'],
                    ['e', 'right', '100%', '50%'],
                    ['s', 'bottom', '50%', '100%'],
                    ['w', 'left', '0%', '50%'],
                  ] as const
                ).map(([edge, name, left, top]) => (
                  <button
                    key={edge}
                    type="button"
                    aria-label={`Resize rect ${index + 1} ${name}`}
                    className="pointer-events-auto absolute h-3 w-3 rounded-sm border border-ink bg-paper"
                    style={{ left, top, marginLeft: -6, marginTop: -6 }}
                    onPointerDown={(event) => startResize(event, index, edge)}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                  />
                ))
              : null}
          </div>
        ))}
        {overlay ? (
          <div
            data-crop-rect=""
            className="pointer-events-none absolute border-2 border-record-red bg-record-red/10"
            style={{
              left: `${overlay.x * 100}%`,
              top: `${overlay.y * 100}%`,
              width: `${overlay.w * 100}%`,
              height: `${overlay.h * 100}%`,
            }}
          />
        ) : null}
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Drag a rectangle on the page, then Add rect. The number on each rect is its place in the
        score film — that is the order Play scrolls them, so check it reads top to bottom before you
        add them.
      </p>
      {onFindSystems ? (
        <p className="mt-1 text-sm text-ink-muted">
          Finds each system from the space between them. Drag an edge to resize a rect, ✕ drops one.
          A rect you draw goes last on its page, so if the numbers come out wrong, Clear page rects
          and draw them in reading order.
        </p>
      ) : null}
      {!hasPhrases ? (
        <p className="mt-3 text-sm text-ink-muted">
          Mark phrases on the ghost so Play can scroll this film with the song.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {onFindSystems ? (
          <button
            type="button"
            disabled={finding}
            onClick={() => void onFindSystems()}
            className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {finding ? 'Finding systems…' : 'Find systems'}
          </button>
        ) : null}
        {onClearPageRects ? (
          <button
            type="button"
            disabled={pageRects.length === 0}
            onClick={() => onClearPageRects(pageIndex)}
            className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Clear page rects
          </button>
        ) : null}
        {onAddRect ? (
          <button
            type="button"
            disabled={!region}
            onClick={() => void handleAddRect()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
          >
            Add rect
          </button>
        ) : null}
        {rectTotal > 0 ? (
          <button
            type="button"
            onClick={() => void onAddAll?.()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
          >
            Add all {rectTotal}
          </button>
        ) : null}
        {rectTotal > 0 && crops.length > 0 ? (
          <button
            type="button"
            onClick={() => void onReplaceFilm?.()}
            className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Replace film and clear pins
          </button>
        ) : null}
        {rectTotal > 0 ? (
          <button
            type="button"
            onClick={() => onDismissRects?.()}
            className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Dismiss
          </button>
        ) : null}
      </div>
      {crops.length > 0 ? (
        <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Score film">
          {crops.map((ref, index) => (
            <li
              key={ref.id}
              className="flex items-center gap-2 rounded-md border border-ink/15 bg-paper px-3 py-1.5"
            >
              <span>
                Crop {index + 1}
                {ref.pageIndex !== pageIndex ? ` (page ${ref.pageIndex + 1})` : ''}
              </span>
              {onRemoveCrop ? (
                <button
                  type="button"
                  onClick={() => void handleRemoveCrop(ref.id)}
                  aria-label={`Remove crop ${index + 1}`}
                  className="text-ink-muted hover:text-record-red"
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
      {findError ? (
        <p role="alert" className="mt-3 text-record-red">
          {findError}
        </p>
      ) : null}
    </section>
  )
}
