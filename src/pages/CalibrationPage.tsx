import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createBrowserCalibrationIo,
  loadDeviceProfile,
  MAX_LATENCY_MS,
  measureClapLatency,
  saveDeviceProfile,
  WARMUP_MS,
  type CalibrationIo,
  type ClapListenIo,
} from '../audio/latency.ts'
import { classifyMicLevel } from '../audio/micLevel.ts'
import { MicLevelMeter } from '../ui/shared/MicLevelMeter.tsx'

const SILENT_LEVEL = 0.02

export type CalibrationPageIo = ClapListenIo &
  Partial<Pick<CalibrationIo, 'getLevel' | 'captureIsProcessed' | 'dispose' | 'runClickClapMeasure'>>

type CalibrationMode = 'tone' | 'clap'

export type CalibrationPageProps = {
  io?: CalibrationPageIo
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function persistMs(ms: number): void {
  saveDeviceProfile({
    latencyCompMs: ms,
    updatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
  })
}

export function CalibrationPage({ io }: CalibrationPageProps = {}) {
  const [mode, setMode] = useState<CalibrationMode>('tone')
  const [status, setStatus] = useState<'idle' | 'listening' | 'saved' | 'failed'>('idle')
  const [keptMs, setKeptMs] = useState<number | null>(
    () => loadDeviceProfile()?.latencyCompMs ?? null,
  )
  const [captureBlocked, setCaptureBlocked] = useState(false)
  const [silentMic, setSilentMic] = useState(false)
  const [typedMs, setTypedMs] = useState('')
  const [armed, setArmed] = useState(false)
  const [level, setLevel] = useState(0)
  const [living, setLiving] = useState(false)

  const aliveRef = useRef(true)
  const ioRef = useRef<CalibrationPageIo | null>(null)
  const createdByPageRef = useRef(false)
  const needsWarmupRef = useRef(false)
  const ensureIoInflightRef = useRef<Promise<CalibrationPageIo> | null>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (createdByPageRef.current) {
        ioRef.current?.dispose?.()
      }
    }
  }, [])

  useEffect(() => {
    if (!armed) return
    const getLevel = ioRef.current?.getLevel
    if (typeof getLevel !== 'function') return
    let raf = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const reading = classifyMicLevel(getLevel())
      setLevel(reading.level)
      setLiving(reading.living)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [armed])

  function ensureIo(): Promise<CalibrationPageIo> {
    if (ioRef.current) return Promise.resolve(ioRef.current)
    if (io) {
      ioRef.current = io
      return Promise.resolve(io)
    }
    if (!ensureIoInflightRef.current) {
      ensureIoInflightRef.current = createBrowserCalibrationIo()
        .then((created) => {
          if (!aliveRef.current) {
            created.dispose?.()
            throw new Error('Calibration page unmounted')
          }
          ioRef.current = created
          createdByPageRef.current = true
          needsWarmupRef.current = true
          return created
        })
        .finally(() => {
          ensureIoInflightRef.current = null
        })
    }
    return ensureIoInflightRef.current
  }

  function armFrom(used: CalibrationPageIo): void {
    if (typeof used.getLevel === 'function') {
      const reading = classifyMicLevel(used.getLevel())
      setLevel(reading.level)
      setLiving(reading.living)
    }
    setArmed(true)
  }

  async function handleCheckMic() {
    try {
      const used = await ensureIo()
      if (!aliveRef.current) return
      armFrom(used)
    } catch {
      // Permission failure or unmount: leave Check mic visible.
    }
  }

  function selectMode(next: CalibrationMode) {
    if (status === 'listening') return
    setMode(next)
    if (status === 'failed') {
      setStatus('idle')
      setSilentMic(false)
      setCaptureBlocked(false)
    }
  }

  async function handleMeasure() {
    const clapMode = mode === 'clap'
    setStatus('listening')
    setCaptureBlocked(false)
    setSilentMic(false)
    let maxLevel = 0
    let raf = 0
    try {
      const used = await ensureIo()
      if (!aliveRef.current) return
      armFrom(used)
      if (needsWarmupRef.current) {
        await sleep(WARMUP_MS)
        needsWarmupRef.current = false
      }
      const sampleLevel = () => {
        if (typeof used.getLevel !== 'function') return
        const next = used.getLevel()
        if (next > maxLevel) maxLevel = next
      }
      sampleLevel()
      if (typeof used.getLevel === 'function') {
        const tick = () => {
          sampleLevel()
          raf = requestAnimationFrame(tick)
        }
        tick()
      }
      let ms: number
      if (clapMode) {
        if (typeof used.runClickClapMeasure !== 'function') {
          throw new Error('failed measurement')
        }
        const estimate = await used.runClickClapMeasure()
        if (!estimate?.stable) throw new Error('failed measurement')
        ms = Math.round(estimate.latencyMs)
      } else {
        ms = Math.round(await measureClapLatency(used))
      }
      persistMs(ms)
      setKeptMs(ms)
      setStatus('saved')
    } catch {
      if (!aliveRef.current) return
      const used = ioRef.current
      if (typeof used?.getLevel === 'function') {
        const next = used.getLevel()
        if (next > maxLevel) maxLevel = next
        if (maxLevel < SILENT_LEVEL) {
          setSilentMic(true)
          setStatus('failed')
          return
        }
      }
      if (!clapMode) {
        setCaptureBlocked(used?.captureIsProcessed === true)
      }
      setStatus('failed')
    } finally {
      if (raf) cancelAnimationFrame(raf)
    }
  }

  function handleUseTyped() {
    if (typedMs.trim() === '') return
    const n = Number(typedMs)
    if (!Number.isFinite(n) || n < 0 || n > MAX_LATENCY_MS) return
    const ms = Math.round(n)
    persistMs(ms)
    setKeptMs(ms)
    setStatus('saved')
  }

  const listening = status === 'listening'
  const buttonLabel = listening
    ? 'Listening…'
    : mode === 'clap'
      ? keptMs != null
        ? 'Start again'
        : 'Start'
      : keptMs != null
        ? 'Line up again'
        : 'Line up'
  const showCheckMic = !armed && status !== 'listening'
  const showMeter = armed && typeof ioRef.current?.getLevel === 'function'
  const failCopy = silentMic
    ? 'Mic is silent. Check permission and the mic hole.'
    : mode === 'clap'
      ? 'We couldn’t lock the timing. Try again a bit closer to the beat, or switch to Tone.'
      : captureBlocked
        ? 'This phone is blocking the tone. Use headphones.'
        : 'We didn’t hear the tone. Closer to the speaker, a bit louder, then Line up again.'
  const modeSwitchClass =
    'rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium studio-transition hover:bg-ink/5 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper disabled:opacity-50'

  return (
    <div className="min-h-screen bg-paper px-10 py-8 font-ui text-ink fade-in">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Line up headphones</h1>
      <p className="mt-3 max-w-md text-ink/70">
        {mode === 'clap'
          ? 'Headphones on. We’ll play a steady click for a few seconds — clap once on each click, same hand, same place. Stop when it says lined up.'
          : 'Headphones: slip one cup so the mic hears the driver. Phone: volume up, don’t cover the mic. Then tap Line up.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={mode === 'tone'}
          disabled={listening}
          onClick={() => selectMode('tone')}
          className={modeSwitchClass}
        >
          Tone
        </button>
        <button
          type="button"
          aria-pressed={mode === 'clap'}
          disabled={listening}
          onClick={() => selectMode('clap')}
          className={modeSwitchClass}
        >
          Clap with the click
        </button>
      </div>
      {keptMs != null ? (
        <p className="mt-3 text-sm text-ink-muted">Lined up by {keptMs} ms on this device.</p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {showCheckMic ? (
          <button
            type="button"
            onClick={() => void handleCheckMic()}
            className="rounded-md px-4 py-2 text-sm font-medium text-ink/80 studio-transition hover:bg-ink/5"
          >
            Check mic
          </button>
        ) : null}
        <button
          type="button"
          disabled={listening}
          aria-live="polite"
          onClick={() => void handleMeasure()}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      </div>
      {showMeter ? (
        <div className="mt-4">
          <MicLevelMeter level={level} living={living} />
        </div>
      ) : null}
      {status === 'listening' ? (
        <p role="status" aria-live="polite" className="mt-6 text-ink/70">
          {mode === 'clap' ? 'Clap with the clicks…' : 'Listening…'}
        </p>
      ) : null}
      {status === 'failed' ? (
        <>
          <p role="alert" className="mt-6 text-record-red">
            {failCopy}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-sm text-ink/70">
              Or type it:{' '}
              <input
                type="number"
                min={0}
                max={MAX_LATENCY_MS}
                step={1}
                value={typedMs}
                onChange={(event) => setTypedMs(event.target.value)}
                className="w-20 rounded-md border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
              />{' '}
              ms
            </label>
            <button
              type="button"
              onClick={handleUseTyped}
              className="rounded-md px-3 py-1.5 text-sm text-ink/80 studio-transition hover:bg-ink/5"
            >
              Use this
            </button>
          </div>
        </>
      ) : null}
      <Link
        to="/"
        className="mt-10 inline-block text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        Home
      </Link>
    </div>
  )
}
