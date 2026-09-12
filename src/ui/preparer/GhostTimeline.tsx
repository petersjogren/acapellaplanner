import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { formatDuration } from '../../audio/decode.ts'
import {
  MIN_PHRASE_MS,
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
}

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

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function percent(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0
  return Math.min(Math.max((ms / durationMs) * 100, 0), 100)
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

export function GhostTimeline({
  durationMs,
  phrases,
  buffer = null,
  onMarkPhrase,
  onUpdatePhrase,
  onRemovePhrase,
}: GhostTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ startMs: number; endMs: number } | null>(null)
  const [preview, setPreview] = useState<{ startMs: number; endMs: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  function msFromEvent(event: ReactPointerEvent<HTMLElement>): number {
    return msAtTimelineX(event.clientX, event.currentTarget.getBoundingClientRect(), durationMs)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const ms = msFromEvent(event)
    dragRef.current = { startMs: ms, endMs: ms }
    setPreview({ startMs: ms, endMs: ms })
    capturePointer(event.currentTarget, event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag) return
    const ms = msFromEvent(event)
    dragRef.current = { startMs: drag.startMs, endMs: ms }
    setPreview(phrasesFromDrag(drag.startMs, ms, durationMs))
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>, commit: boolean) {
    const drag = dragRef.current
    dragRef.current = null
    setPreview(null)
    releasePointer(event.currentTarget, event.pointerId)
    if (!commit || !drag) return
    if (Math.abs(drag.endMs - drag.startMs) < MIN_PHRASE_MS) return
    const marked = phrasesFromDrag(drag.startMs, drag.endMs, durationMs)
    void run(() => onMarkPhrase(marked.startMs, marked.endMs), 'Could not mark phrase')
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

  return (
    <section className="mt-8" aria-label="Phrase marking">
      <h3 className="font-medium">Mark a phrase</h3>
      <p className="mt-1 text-sm text-ink-muted">Drag on the ghost to mark a phrase.</p>
      <div
        ref={trackRef}
        aria-label="Ghost timeline"
        className="relative mt-4 cursor-ew-resize touch-none select-none overflow-hidden rounded-md border border-ink/10"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, false)}
      >
        <canvas ref={canvasRef} aria-hidden className="block h-24 w-full" />
        <div className="pointer-events-none absolute inset-0">
          {ordered.map((item) => (
            <div
              key={item.id}
              className="absolute inset-y-0 bg-gold/35"
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
                  onClick={() => setSelectedId(item.id)}
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
                      <input
                        value={item.name}
                        onChange={(event) => {
                          void run(
                            () => onUpdatePhrase(item.id, { name: event.target.value }),
                            'Could not update phrase',
                          )
                        }}
                        className="rounded-md border border-ink/15 bg-paper px-2 py-1"
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
                    <button
                      type="button"
                      className="mt-1 justify-self-start text-sm text-record-red"
                      onClick={() => {
                        void run(() => onRemovePhrase(item.id), 'Could not delete phrase')
                        setSelectedId(null)
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
