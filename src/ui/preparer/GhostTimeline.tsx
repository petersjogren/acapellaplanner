import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { formatDuration } from '../../audio/decode.ts'
import {
  MIN_PHRASE_MS,
  gapContainingMs,
  phrasesFromDrag,
  sortPhrases,
  type PhrasePatch,
} from '../../domain/phrases.ts'
import type { Phrase } from '../../domain/schemas.ts'

export type GhostTimelineProps = {
  durationMs: number
  phrases: Phrase[]
  buffer?: AudioBuffer | null
  onMarkPhrase: (startMs: number, endMs: number) => void | Promise<void>
  onUpdatePhrase: (id: string, patch: PhrasePatch) => void | Promise<void>
  onRemovePhrase: (id: string) => void | Promise<void>
  onSelectPhrase?: (id: string | null) => void
  onPlayPhrase?: (id: string) => void
  playheadMs?: number | null
  openPreview?: { startMs: number; endMs: number } | null
}

export type TimelineCursor = 'mark' | 'select' | 'play'

/** Pointer travel below this is a click (select / Option-play), not a mark-drag. */
export const TIMELINE_CLICK_PX = 8

export function msAtTimelineX(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
  durationMs: number,
): number {
  if (rect.width <= 0) return 0
  const ratio = (clientX - rect.left) / rect.width
  return Math.min(Math.max(ratio, 0), 1) * durationMs
}

export function downsamplePeaks(channelData: Float32Array, bucketCount: number): Float32Array {
  const peaks = new Float32Array(Math.max(0, bucketCount))
  if (channelData.length === 0 || peaks.length === 0) return peaks
  const bucketSize = channelData.length / peaks.length
  for (let i = 0; i < peaks.length; i++) {
    const start = Math.floor(i * bucketSize)
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize))
    let peak = 0
    for (let j = start; j < end && j < channelData.length; j++) {
      const value = Math.abs(channelData[j] ?? 0)
      if (value > peak) peak = value
    }
    peaks[i] = peak
  }
  return peaks
}

/**
 * Hit-test a ghost time against phrase regions. Intervals are half-open
 * `[startMs, endMs)` so a shared boundary belongs to the later phrase; the
 * last phrase also claims its exact `endMs`.
 */
export function phraseAtMs(ms: number, phrases: Phrase[]): Phrase | null {
  const ordered = sortPhrases(phrases)
  for (const phrase of ordered) {
    if (ms >= phrase.startMs && ms < phrase.endMs) return phrase
  }
  const last = ordered.at(-1)
  if (last && ms === last.endMs) return last
  return null
}

export function isTimelineClick(
  start: { clientX: number; clientY: number },
  end: { clientX: number; clientY: number },
  thresholdPx = TIMELINE_CLICK_PX,
): boolean {
  return Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) < thresholdPx
}

export function timelineCursor({
  hoveringPhrase,
  optionDown,
  dragging,
}: {
  hoveringPhrase: boolean
  optionDown: boolean
  dragging: boolean
}): TimelineCursor {
  if (dragging || !hoveringPhrase) return 'mark'
  return optionDown ? 'play' : 'select'
}

const CURSOR_CLASS: Record<TimelineCursor, string> = {
  mark: 'cursor-ew-resize',
  select: 'cursor-phrase-select',
  play: 'cursor-phrase-play',
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function percent(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0
  return Math.min(Math.max((ms / durationMs) * 100, 0), 100)
}

const PHRASE_OVERLAY_CLASS = ['bg-phrase-overlay', 'bg-phrase-overlay-alt'] as const

/** Even/odd by timeline order (after `sortPhrases`), not by gap size. */
export function phraseOverlayClass(index: number): string {
  return PHRASE_OVERLAY_CLASS[index & 1] ?? PHRASE_OVERLAY_CLASS[0]
}

function isTooShortDrag(startMs: number, endMs: number): boolean {
  return Math.abs(endMs - startMs) < MIN_PHRASE_MS
}

function previewFromRawDrag(
  startMs: number,
  endMs: number,
  durationMs: number,
): { startMs: number; endMs: number } | null {
  if (isTooShortDrag(startMs, endMs)) return null
  const start = Math.min(startMs, endMs)
  const end = Math.max(startMs, endMs)
  return {
    startMs: Math.min(Math.max(start, 0), durationMs),
    endMs: Math.min(Math.max(end, 0), durationMs),
  }
}

function PhraseNameInput({
  value,
  onCommit,
}: {
  value: string
  onCommit: (name: string) => void | Promise<void>
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed) {
      setDraft(value)
      return
    }
    if (trimmed === value) return
    void onCommit(trimmed)
  }

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      className="rounded-md border border-ink/15 bg-paper px-2 py-1"
    />
  )
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

type DragState = {
  startMs: number
  endMs: number
  startX: number
  startY: number
  hitPhraseId: string | null
}

export function GhostTimeline({
  durationMs,
  phrases,
  buffer = null,
  onMarkPhrase,
  onUpdatePhrase,
  onRemovePhrase,
  onSelectPhrase,
  onPlayPhrase,
  playheadMs = null,
  openPreview = null,
}: GhostTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [preview, setPreview] = useState<{ startMs: number; endMs: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverPhraseId, setHoverPhraseId] = useState<string | null>(null)
  const [optionDown, setOptionDown] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    if (!canvas || !track) return

    const draw = () => {
      const width = track.clientWidth
      if (width <= 0) return
      const height = 96
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#e8dfd0'
      ctx.fillRect(0, 0, width, height)
      ctx.strokeStyle = 'rgba(28, 25, 22, 0.2)'
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()
      if (!buffer || buffer.length === 0) return
      const data = buffer.getChannelData(0)
      const peaks = downsamplePeaks(data, Math.floor(width))
      ctx.fillStyle = '#1c1916'
      const mid = height / 2
      for (let x = 0; x < peaks.length; x++) {
        const mag = peaks[x] ?? 0
        const bar = Math.max(1, mag * height * 0.45)
        ctx.fillRect(x, mid - bar, 1, bar * 2)
      }
    }

    draw()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(track)
    return () => observer.disconnect()
  }, [buffer])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      setOptionDown((prev) => (prev === event.altKey ? prev : event.altKey))
    }
    function onBlur() {
      setOptionDown(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  function msFromEvent(event: ReactPointerEvent<HTMLElement>): number {
    return msAtTimelineX(event.clientX, event.currentTarget.getBoundingClientRect(), durationMs)
  }

  function syncHoverFromEvent(event: ReactPointerEvent<HTMLElement>) {
    setOptionDown((prev) => (prev === event.altKey ? prev : event.altKey))
    const hit = phraseAtMs(msFromEvent(event), phrases)
    setHoverPhraseId((prev) => {
      const next = hit?.id ?? null
      return prev === next ? prev : next
    })
  }

  function selectPhrase(id: string) {
    setSelectedId(id)
    onSelectPhrase?.(id)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const ms = msFromEvent(event)
    const hit = phraseAtMs(ms, phrases)
    dragRef.current = {
      startMs: ms,
      endMs: ms,
      startX: event.clientX,
      startY: event.clientY,
      hitPhraseId: hit?.id ?? null,
    }
    setDragging(true)
    setPreview(null)
    setHoverPhraseId(hit?.id ?? null)
    setOptionDown(event.altKey)
    capturePointer(event.currentTarget, event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    syncHoverFromEvent(event)
    const drag = dragRef.current
    if (!drag) return
    const ms = msFromEvent(event)
    dragRef.current = { ...drag, endMs: ms }
    setPreview(previewFromRawDrag(drag.startMs, ms, durationMs))
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>, commit: boolean) {
    const drag = dragRef.current
    dragRef.current = null
    setPreview(null)
    setDragging(false)
    releasePointer(event.currentTarget, event.pointerId)
    if (!commit || !drag) return
    if (isTimelineClick({ clientX: drag.startX, clientY: drag.startY }, event)) {
      if (drag.hitPhraseId) {
        selectPhrase(drag.hitPhraseId)
        if (event.altKey) onPlayPhrase?.(drag.hitPhraseId)
      }
      return
    }
    if (isTooShortDrag(drag.startMs, drag.endMs)) return
    const marked = phrasesFromDrag(drag.startMs, drag.endMs, durationMs)
    void run(() => onMarkPhrase(marked.startMs, marked.endMs), 'Could not mark phrase')
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    const ms = msAtTimelineX(event.clientX, event.currentTarget.getBoundingClientRect(), durationMs)
    if (phraseAtMs(ms, phrases)) return
    const gap = gapContainingMs(phrases, ms, durationMs)
    if (!gap) return
    void run(() => onMarkPhrase(gap.startMs, gap.endMs), 'Could not mark phrase')
  }

  async function run(action: () => void | Promise<void>, fallback: string) {
    try {
      await action()
      setError(null)
    } catch (err: unknown) {
      setError(messageFrom(err, fallback))
    }
  }

  const ordered = sortPhrases(phrases)
  const cursor = timelineCursor({
    hoveringPhrase: hoverPhraseId !== null,
    optionDown,
    dragging,
  })

  return (
    <section className="mt-8" aria-label="Phrase marking">
      <h3 className="font-medium">Mark a phrase</h3>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-ink-muted">
        <p>Drag on the ghost to mark a phrase.</p>
        <p>Option-click a phrase to play it.</p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Or play the ghost — a phrase opens at 0. Tap New phrase at each later start.
      </p>
      <p className="mt-1 text-sm text-ink-muted">Double-click empty space to fill that gap.</p>
      <div
        ref={trackRef}
        aria-label="Ghost timeline"
        data-cursor={cursor}
        className={`relative mt-4 touch-none select-none overflow-hidden rounded-md border border-ink/10 ${CURSOR_CLASS[cursor]}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, false)}
        onPointerLeave={() => setHoverPhraseId(null)}
        onDoubleClick={handleDoubleClick}
      >
        <canvas ref={canvasRef} aria-hidden className="block h-24 w-full" />
        <div className="pointer-events-none absolute inset-0">
          {ordered.map((item, index) => (
            <div
              key={item.id}
              data-phrase-overlay={item.id}
              className={`absolute inset-y-0 ${phraseOverlayClass(index)}`}
              style={{
                left: `${percent(item.startMs, durationMs)}%`,
                width: `${percent(item.endMs - item.startMs, durationMs)}%`,
              }}
            />
          ))}
          {preview ? (
            <div
              className="absolute inset-y-0 bg-ink/25"
              style={{
                left: `${percent(preview.startMs, durationMs)}%`,
                width: `${percent(preview.endMs - preview.startMs, durationMs)}%`,
              }}
            />
          ) : null}
          {openPreview ? (
            <div
              data-testid="mark-along-preview"
              className="absolute inset-y-0 bg-ink/25"
              style={{
                left: `${percent(openPreview.startMs, durationMs)}%`,
                width: `${percent(openPreview.endMs - openPreview.startMs, durationMs)}%`,
              }}
            />
          ) : null}
          {playheadMs != null && Number.isFinite(playheadMs) ? (
            <div
              data-testid="ghost-playhead"
              className="absolute inset-y-0 w-px bg-ink"
              style={{ left: `${percent(playheadMs, durationMs)}%` }}
            />
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-muted">
        <span>0:00.0</span>
        <span>{formatDuration(durationMs)}</span>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
      {ordered.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No phrases marked yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" aria-label="Phrases">
          {ordered.map((item) => {
            const selected = selectedId === item.id
            return (
              <li key={item.id} className="rounded-md border border-ink/10 px-3 py-2">
                <button
                  type="button"
                  aria-pressed={selected}
                  className="flex w-full flex-col items-start gap-0.5 text-left studio-transition hover:text-record-red"
                  onClick={() => {
                    setSelectedId(item.id)
                    onSelectPhrase?.(item.id)
                  }}
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="text-sm text-ink-muted">
                    {formatDuration(item.startMs)}–{formatDuration(item.endMs)}
                  </span>
                  {item.lyricText ? <span className="text-sm">{item.lyricText}</span> : null}
                </button>
                {selected ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Name
                      <PhraseNameInput
                        value={item.name}
                        onCommit={(name) =>
                          run(() => onUpdatePhrase(item.id, { name }), 'Could not update phrase')
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Lyric
                      <input
                        value={item.lyricText ?? ''}
                        onChange={(event) => {
                          void run(
                            () => onUpdatePhrase(item.id, { lyricText: event.target.value }),
                            'Could not update phrase',
                          )
                        }}
                        className="rounded-md border border-ink/15 bg-paper px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Start
                      <input
                        type="number"
                        value={item.startMs}
                        onChange={(event) => {
                          const startMs = Number(event.target.value)
                          if (!Number.isFinite(startMs)) return
                          void run(
                            () => onUpdatePhrase(item.id, { startMs }),
                            'Could not update phrase',
                          )
                        }}
                        className="rounded-md border border-ink/15 bg-paper px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      End
                      <input
                        type="number"
                        value={item.endMs}
                        onChange={(event) => {
                          const endMs = Number(event.target.value)
                          if (!Number.isFinite(endMs)) return
                          void run(
                            () => onUpdatePhrase(item.id, { endMs }),
                            'Could not update phrase',
                          )
                        }}
                        className="rounded-md border border-ink/15 bg-paper px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Head start (ms)
                      <input
                        type="number"
                        min={0}
                        value={item.preRollMs ?? 0}
                        onChange={(event) => {
                          const preRollMs = Number(event.target.value)
                          if (!Number.isFinite(preRollMs) || preRollMs < 0) return
                          void run(
                            () => onUpdatePhrase(item.id, { preRollMs }),
                            'Could not update phrase',
                          )
                        }}
                        className="rounded-md border border-ink/15 bg-paper px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Crossfade tail (ms)
                      <input
                        type="number"
                        min={0}
                        value={item.postRollMs}
                        onChange={(event) => {
                          const postRollMs = Number(event.target.value)
                          if (!Number.isFinite(postRollMs) || postRollMs < 0) return
                          void run(
                            () => onUpdatePhrase(item.id, { postRollMs }),
                            'Could not update phrase',
                          )
                        }}
                        className="rounded-md border border-ink/15 bg-paper px-2 py-1"
                      />
                    </label>
                    <p className="text-sm text-ink-muted sm:col-span-2">
                      Head start plays the ghost before the phrase begins, so the singer can
                      settle in. Crossfade tail keeps the ghost and mic running past the phrase
                      end, so the engineer has material to blend into the next one. Neither moves
                      the phrase boundary itself.
                    </p>
                    <button
                      type="button"
                      className="mt-1 justify-self-start text-sm text-record-red"
                      onClick={() => {
                        void run(() => onRemovePhrase(item.id), 'Could not delete phrase')
                        setSelectedId(null)
                        onSelectPhrase?.(null)
                      }}
                    >
                      Delete phrase
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
