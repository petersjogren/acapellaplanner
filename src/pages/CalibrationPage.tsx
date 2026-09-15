import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createBrowserClapIo,
  loadDeviceProfile,
  MAX_LATENCY_MS,
  measureClapLatency,
  saveDeviceProfile,
  WARMUP_MS,
  type BrowserClapIo,
  type ClapListenIo,
} from '../audio/latency.ts'

export type CalibrationPageProps = {
  io?: ClapListenIo
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
  const [status, setStatus] = useState<'idle' | 'listening' | 'saved' | 'failed'>('idle')
  const [keptMs, setKeptMs] = useState<number | null>(
    () => loadDeviceProfile()?.latencyCompMs ?? null,
  )
  const [captureBlocked, setCaptureBlocked] = useState(false)
  const [typedMs, setTypedMs] = useState('')

  async function handleMeasure() {
    setStatus('listening')
    setCaptureBlocked(false)
    let browserIo: BrowserClapIo | undefined
    try {
      const used = io ?? (browserIo = await createBrowserClapIo())
      if (!io) await sleep(WARMUP_MS)
      const ms = Math.round(await measureClapLatency(used))
      persistMs(ms)
      setKeptMs(ms)
      setStatus('saved')
    } catch {
      setCaptureBlocked(browserIo?.captureIsProcessed === true)
      setStatus('failed')
    } finally {
      browserIo?.dispose()
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

  const buttonLabel =
    status === 'listening' ? 'Listening…' : keptMs != null ? 'Line up again' : 'Line up'

  return (
    <div className="min-h-screen bg-paper px-10 py-8 font-ui text-ink fade-in">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Line up headphones</h1>
      <p className="mt-3 max-w-md text-ink/70">
        Headphones: slip one cup so the mic hears the driver. Phone: volume up, don’t cover the
        mic. Then tap Line up.
      </p>
      {keptMs != null ? (
        <p className="mt-3 text-sm text-ink-muted">Lined up by {keptMs} ms on this device.</p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={status === 'listening'}
          aria-live="polite"
          onClick={() => void handleMeasure()}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      </div>
      {status === 'listening' ? (
        <p role="status" aria-live="polite" className="mt-6 text-ink/70">
          Listening…
        </p>
      ) : null}
      {status === 'failed' ? (
        <>
          <p role="alert" className="mt-6 text-record-red">
            {captureBlocked
              ? 'This phone is blocking the tone. Use headphones.'
              : 'We didn’t hear the tone. Closer to the speaker, a bit louder, then Line up again.'}
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
