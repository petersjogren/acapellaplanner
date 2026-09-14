import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createBrowserClapIo,
  loadDeviceProfile,
  measureClapLatency,
  saveDeviceProfile,
  type ClapListenIo,
} from '../audio/latency.ts'

export type CalibrationPageProps = {
  io?: ClapListenIo
}

export function CalibrationPage({ io }: CalibrationPageProps = {}) {
  const [status, setStatus] = useState<'idle' | 'listening' | 'measured' | 'saved' | 'failed'>(
    'idle',
  )
  const [measuredMs, setMeasuredMs] = useState<number | null>(null)
  const [keptMs, setKeptMs] = useState<number | null>(
    () => loadDeviceProfile()?.latencyCompMs ?? null,
  )

  async function handleMeasure() {
    setStatus('listening')
    setMeasuredMs(null)
    let browserIo: Awaited<ReturnType<typeof createBrowserClapIo>> | undefined
    try {
      const used = io ?? (browserIo = await createBrowserClapIo())
      const ms = Math.round(await measureClapLatency(used))
      setMeasuredMs(ms)
      setStatus('measured')
    } catch {
      setStatus('failed')
    } finally {
      browserIo?.dispose()
    }
  }

  function handleKeep() {
    if (measuredMs == null) return
    saveDeviceProfile({
      latencyCompMs: measuredMs,
      updatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
    })
    setKeptMs(measuredMs)
    setStatus('saved')
  }

  return (
    <div className="min-h-screen bg-paper px-10 py-8 font-ui text-ink fade-in">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Line up headphones</h1>
      <p className="mt-3 max-w-md text-ink/70">
        Play the tone, then hold your microphone up to your headphone speaker (or
        slip off one earcup) so the tone bleeds straight into the mic — no clapping,
        just let it leak through.
      </p>
      {keptMs != null ? (
        <p className="mt-3 text-sm text-ink-muted">Lined up by {keptMs} ms on this device.</p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {status === 'measured' ? (
          <>
            <button
              type="button"
              onClick={handleKeep}
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => void handleMeasure()}
              className="rounded-md px-4 py-2 text-sm text-ink/80 studio-transition hover:bg-ink/5"
            >
              Try again
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={status === 'listening'}
            aria-live="polite"
            onClick={() => void handleMeasure()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
          >
            {status === 'listening' ? 'Listening…' : 'Play the tone'}
          </button>
        )}
      </div>
      {status === 'listening' ? (
        <p role="status" aria-live="polite" className="sr-only">
          Listening…
        </p>
      ) : null}
      {measuredMs != null ? (
        <div className="mt-6">
          <h2 className="text-sm text-ink-muted">Measured latency</h2>
          <p className="font-display text-xl" aria-live="polite">
            {measuredMs} ms
          </p>
        </div>
      ) : null}
      {status === 'failed' ? (
        <p role="alert" className="mt-6 text-record-red">
          We didn’t hear the tone come back through the mic — check the bleed and try again.
        </p>
      ) : null}
      {status === 'saved' ? (
        <p className="mt-6 text-ink/70">Headphones lined up. Takes will sit with the ghost.</p>
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
