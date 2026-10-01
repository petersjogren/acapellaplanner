import { useEffect, useRef, useState } from 'react'
import { getAudioContext } from '../../audio/context.ts'
import { decodeAudioFile } from '../../audio/decode.ts'
import { framePeakAbs, smoothLevel } from '../../audio/micLevel.ts'
import {
  isEmptyTake,
  isProcessedCapture,
  micProcessingFlags,
  requestMicStream,
  startRecording,
  type RecordingResult,
  type StartedRecording,
} from '../../audio/record.ts'
import { MicLevelMeter } from '../shared/MicLevelMeter.tsx'
import type { GhostImportResult } from './GhostImporter.tsx'

export type GhostRecorderProps = {
  onImported: (result: GhostImportResult) => void | Promise<void>
  disabled?: boolean
}

type RecorderState = 'idle' | 'checking' | 'armed' | 'recording' | 'confirming'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function timestampedFilename(): string {
  return `Recorded ghost (${new Date().toLocaleString()})`
}

export function GhostRecorder({ onImported, disabled = false }: GhostRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [living, setLiving] = useState(false)
  const [processed, setProcessed] = useState(false)
  const [result, setResult] = useState<RecordingResult | null>(null)
  const [decoding, setDecoding] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const recordingRef = useRef<StartedRecording | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const aliveRef = useRef(true)
  const stoppingRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      sourceRef.current?.disconnect()
      sourceRef.current = null
      analyserRef.current = null
      // Explicitly stop any in-flight recorder rather than relying on the
      // track-stop below to indirectly halt MediaRecorder.
      if (recordingRef.current) {
        void recordingRef.current.stop().catch(() => undefined)
        recordingRef.current = null
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  // Live peak meter while armed or recording — same shape as CalibrationPage:
  // an rAF loop sampling an analyser via framePeakAbs + smoothLevel.
  useEffect(() => {
    if (state !== 'armed' && state !== 'recording') return
    const analyser = analyserRef.current
    if (!analyser) return
    let raf = 0
    let cancelled = false
    let currentLevel = 0
    const timeDomain = new Float32Array(analyser.fftSize)
    const tick = () => {
      if (cancelled) return
      analyser.getFloatTimeDomainData(timeDomain)
      const peak = framePeakAbs(timeDomain)
      currentLevel = smoothLevel(currentLevel, peak)
      setLevel(currentLevel)
      setLiving(currentLevel >= 0.02)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [state])

  function wireAnalyser(stream: MediaStream): void {
    try {
      const ctx = getAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      source.connect(analyser)
      sourceRef.current = source
      analyserRef.current = analyser
    } catch {
      // No AudioContext available (e.g. unsupported environment) — the
      // meter just stays at zero; recording itself does not depend on it.
      sourceRef.current = null
      analyserRef.current = null
    }
  }

  async function handleCheckMic() {
    setState('checking')
    setError(null)
    try {
      const stream = await requestMicStream()
      if (!aliveRef.current) return
      streamRef.current = stream
      setProcessed(isProcessedCapture(micProcessingFlags(stream)))
      wireAnalyser(stream)
      setState('armed')
    } catch (err: unknown) {
      if (!aliveRef.current) return
      setError(messageFrom(err, 'Microphone permission is needed to record'))
      setState('idle')
    }
  }

  function handleRecord() {
    // Ref-based re-entry guard (same shape as RecordControl's armingRef):
    // a second rapid click before re-render must not overwrite the ref and
    // leak the first MediaRecorder.
    if (recordingRef.current) return
    const stream = streamRef.current
    if (!stream) return
    recordingRef.current = startRecording(stream)
    setState('recording')
  }

  async function handleStop() {
    // Ref-based re-entry guard: a second rapid click while stop() is still
    // in flight must be a no-op, not call stop() twice.
    if (stoppingRef.current) return
    const rec = recordingRef.current
    if (!rec) return
    stoppingRef.current = true
    try {
      const stopped = await rec.stop()
      if (!aliveRef.current) return
      recordingRef.current = null
      setResult(stopped)
      setState('confirming')
    } catch (err: unknown) {
      if (!aliveRef.current) return
      recordingRef.current = null
      setError(messageFrom(err, 'Recording failed'))
      setState('armed')
    } finally {
      stoppingRef.current = false
    }
  }

  function backToArmed() {
    recordingRef.current = null
    setResult(null)
    setError(null)
    setState('armed')
  }

  async function handleUseThis() {
    if (!result) return
    setDecoding(true)
    setError(null)
    try {
      const decoded = await decodeAudioFile(result.blob)
      await onImported({
        blob: result.blob,
        meta: {
          filename: timestampedFilename(),
          durationMs: decoded.durationMs,
          sampleRate: decoded.sampleRate,
        },
      })
      if (!aliveRef.current) return
      recordingRef.current = null
      setResult(null)
      setState('armed')
    } catch (err: unknown) {
      if (!aliveRef.current) return
      setError(messageFrom(err, 'Could not decode audio file'))
    } finally {
      if (aliveRef.current) setDecoding(false)
    }
  }

  const empty = result ? isEmptyTake({ byteSize: result.byteSize, durationMs: result.durationMs }) : false

  return (
    <section aria-label="Record ghost" className="mt-6 max-w-xl">
      <p className="font-medium">Record ghost</p>

      {state === 'idle' || state === 'checking' ? (
        <button
          type="button"
          disabled={disabled || state === 'checking'}
          onClick={() => void handleCheckMic()}
          className="mt-3 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
        >
          {state === 'checking' ? 'Checking…' : 'Check mic'}
        </button>
      ) : null}

      {state === 'armed' || state === 'recording' ? (
        <div className="mt-3 flex flex-col gap-3">
          <MicLevelMeter level={level} living={living} />
          {processed ? (
            <p role="status" className="max-w-md text-sm text-ink-muted">
              This device insists on echo cancellation or noise suppression. It can duck your voice
              against the ghost — use headphones, or record on desktop Chrome.
            </p>
          ) : null}
          <div>
            {state === 'armed' ? (
              <button
                type="button"
                disabled={disabled}
                onClick={handleRecord}
                className="rounded-md bg-record-red px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-ink disabled:opacity-50"
              >
                Record
              </button>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void handleStop()}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      ) : null}

      {state === 'confirming' && result ? (
        <div className="mt-3 flex flex-col gap-3">
          {empty ? (
            <p role="alert" className="text-record-red">
              nothing caught — try again
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              Recorded {(result.durationMs / 1000).toFixed(1)}s
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {!empty ? (
              <button
                type="button"
                disabled={disabled || decoding}
                onClick={() => void handleUseThis()}
                className="rounded-md bg-gold/90 px-4 py-2 text-sm font-medium text-ink studio-transition hover:bg-gold disabled:opacity-50"
              >
                Use this
              </button>
            ) : null}
            <button
              type="button"
              disabled={disabled || decoding}
              onClick={backToArmed}
              className="rounded-md px-4 py-2 text-sm text-ink-muted underline-offset-4 hover:underline disabled:opacity-50"
            >
              {empty ? 'Record again' : 'Discard & record again'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
    </section>
  )
}
