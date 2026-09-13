import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useProjectRepository } from '../../app/projectRepositoryContext.tsx'
import type { PlaybackEngine } from '../../audio/engine.ts'
import { clicksForPhrase } from '../../audio/click.ts'
import { decodeAudioFile } from '../../audio/decode.ts'
import { storedLatencyCompMs, takePlaybackOffsetMs } from '../../audio/latency.ts'
import {
  createAudioBlobLoader,
  ghostGuideId,
  headphoneMixSnapshotFor,
  keeperTakesForPhrase,
  loadPlaybackMixForPhrase,
  mixPresetById,
  type PlaybackMix,
} from '../../audio/mix.ts'
import {
  isEmptyTake,
  isProcessedCapture,
  micProcessingFlags,
  nextTakeIndex,
  requestMicStream,
  startRecording,
  takeLabel,
  type RecordingResult,
  type StartedRecording,
} from '../../audio/record.ts'
import { deriveCompletion } from '../../domain/completion.ts'
import { markInProgress } from '../../domain/sessionPlan.ts'
import { rateTake, removeTake } from '../../domain/takes.ts'
import type { Phrase, Project, Take, VoicePart } from '../../domain/schemas.ts'

export type RecordControlHandle = {
  flushSaves: () => Promise<void>
}

export type RecordControlProps = {
  phrase: Phrase
  voicePart: VoicePart
  project: Project
  onProjectChange: (project: Project) => void
  engine: PlaybackEngine
  mixPresetId?: string
  ref?: Ref<RecordControlHandle>
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function boothPlaySpec(phrase: Phrase) {
  return {
    startMs: phrase.startMs,
    endMs: phrase.endMs,
    preRollMs: phrase.preRollMs ?? 0,
    postRollMs: phrase.postRollMs,
    gapMs: phrase.loopDefault.gapMs,
    loop: false,
  }
}

function takeAgainstGhostMix(takeBuffer: AudioBuffer, latencyCompMs?: number): PlaybackMix {
  return {
    ghostGainDb: 0,
    ghostMute: false,
    extra: [
      {
        buffer: takeBuffer,
        gainDb: 0,
        mute: false,
        pan: 0,
        offsetMs: takePlaybackOffsetMs(latencyCompMs),
      },
    ],
    click: false,
  }
}

export function RecordControl({
  phrase,
  voicePart,
  project,
  onProjectChange,
  engine,
  mixPresetId,
  ref,
}: RecordControlProps) {
  const repo = useProjectRepository()
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastTakeId, setLastTakeId] = useState<string | null>(null)
  const [hearing, setHearing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [processed, setProcessed] = useState(false)
  const armedRef = useRef(false)
  const armingRef = useRef(false)
  const projectRef = useRef(project)
  const onProjectChangeRef = useRef(onProjectChange)
  const streamRef = useRef<MediaStream | null>(null)
  const pendingRef = useRef<StartedRecording[]>([])
  const saveChainRef = useRef(Promise.resolve())
  const toggleArmRef = useRef<() => void>(() => undefined)
  const mixPresetIdRef = useRef(mixPresetId)
  const hearGenerationRef = useRef(0)
  const lastTakeIdRef = useRef<string | null>(null)

  projectRef.current = project
  onProjectChangeRef.current = onProjectChange
  mixPresetIdRef.current = mixPresetId
  lastTakeIdRef.current = lastTakeId

  useImperativeHandle(ref, () => ({
    flushSaves: () => saveChainRef.current,
  }))

  const targetTakes =
    phrase.partPlan.find((item) => item.voicePartId === voicePart.id)?.targetTakes ??
    voicePart.targetTakes
  const cellTakes = project.takes.filter(
    (item) => item.phraseId === phrase.id && item.voicePartId === voicePart.id,
  )
  const takeCount = cellTakes.length
  const lastTake = lastTakeId ? cellTakes.find((item) => item.id === lastTakeId) : undefined
  const reviewing = lastTake != null

  async function persistTake(result: RecordingResult): Promise<string | null> {
    if (isEmptyTake(result)) {
      setError('nothing caught — try again')
      return null
    }
    setError(null)
    const audioBlobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: audioBlobId,
      projectId: projectRef.current.id,
      kind: 'take',
      mimeType: result.mimeType,
      byteSize: result.byteSize,
      createdAt: new Date().toISOString(),
      blob: result.blob,
    })
    const current = projectRef.current
    const takeIndex = nextTakeIndex(current.takes, phrase.id, voicePart.id)
    const found = current.phrases.findIndex((item) => item.id === phrase.id)
    const phraseIndex = found >= 0 ? found + 1 : 1
    const take: Take = {
      id: crypto.randomUUID(),
      phraseId: phrase.id,
      voicePartId: voicePart.id,
      takeIndex,
      audioBlobId,
      recordedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      notes: takeLabel(voicePart.shortLabel, phraseIndex, takeIndex),
      headphoneMixSnapshot: headphoneMixSnapshotFor(mixPresetById(mixPresetIdRef.current), {
        ghostGuideId: ghostGuideId(current),
        keeperTakeIds: keeperTakesForPhrase(current.takes, phrase.id).map((item) => item.id),
      }),
      latencyCompMs: storedLatencyCompMs(),
      peakDb: 0,
      clipFlag: false,
    }
    const next: Project = {
      ...current,
      takes: [...current.takes, take],
    }
    const progressing = markInProgress(next, phrase.id, voicePart.id)
    const saved = await repo.saveProject({
      ...progressing,
      completion: deriveCompletion(progressing),
    })
    projectRef.current = saved
    onProjectChangeRef.current(saved)
    return take.id
  }

  function queuePersist(rec: StartedRecording) {
    const stopped = rec.stop()
    saveChainRef.current = saveChainRef.current
      .then(async () => {
        const result = await stopped
        const takeId = await persistTake(result)
        if (takeId) {
          setLastTakeId(takeId)
          lastTakeIdRef.current = takeId
        }
      })
      .catch((err: unknown) => {
        setError(messageFrom(err, 'Could not save take'))
      })
  }

  // Abandon in-progress passes still in pendingRef. Takes whose stop() was
  // already initiated (pass complete / natural end) stay on the save chain.
  function discardPending() {
    const pending = pendingRef.current.splice(0)
    for (const rec of pending) void rec.stop()
  }

  function persistPending() {
    const pending = pendingRef.current.splice(0)
    for (const rec of pending) queuePersist(rec)
  }

  function stopMic() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  function stopHearing() {
    hearGenerationRef.current += 1
    setHearing(false)
  }

  function disarm() {
    armedRef.current = false
    setArmed(false)
    engine.stop()
    discardPending()
    stopMic()
  }

  async function arm() {
    // Use lastTakeIdRef — React state `reviewing` can still be true in the same tick as scrap.
    if (armingRef.current || armedRef.current || lastTakeIdRef.current) return
    armingRef.current = true
    setError(null)
    stopHearing()
    try {
      if (!streamRef.current) {
        streamRef.current = await requestMicStream()
        // Raw capture is requested, but the device can refuse it. Processed
        // capture ducks a sung take against the ghost, so say so rather than
        // letting the singer wonder where their voice went.
        setProcessed(isProcessedCapture(micProcessingFlags(streamRef.current)))
      }

      armedRef.current = true
      const mix = await loadPlaybackMixForPhrase(
        projectRef.current,
        phrase.id,
        mixPresetById(mixPresetIdRef.current).id,
        createAudioBlobLoader((id) => repo.getAudioBlob(id)),
      )
      if (!armedRef.current) {
        discardPending()
        stopMic()
        return
      }
      const clickTimesMs = clicksForPhrase(phrase, projectRef.current.sections)
      // One pass per Record press so the singer can hear the take before another.
      const started = await engine.play(
        boothPlaySpec(phrase),
        {
          onPassStart: () => {
            if (!armedRef.current || !streamRef.current) return
            pendingRef.current.push(startRecording(streamRef.current))
          },
          onPassComplete: () => {
            const rec = pendingRef.current.shift()
            if (!rec) return
            queuePersist(rec)
          },
          onEnded: () => {
            armedRef.current = false
            setArmed(false)
            persistPending()
            stopMic()
          },
        },
        { ...mix, click: true, clickTimesMs },
      )
      if (!started) {
        armedRef.current = false
        setArmed(false)
        discardPending()
        stopMic()
        return
      }
      setArmed(true)
    } catch (err: unknown) {
      const hadMic = streamRef.current != null
      armedRef.current = false
      setArmed(false)
      discardPending()
      stopMic()
      setError(
        messageFrom(
          err,
          hadMic ? 'Could not start recording' : 'Microphone permission is needed to record',
        ),
      )
    } finally {
      armingRef.current = false
    }
  }

  function toggleArm() {
    if (armingRef.current || busy) return
    if (lastTakeIdRef.current) return
    if (armedRef.current) disarm()
    else void arm()
  }

  toggleArmRef.current = toggleArm

  async function handleHear() {
    if (!lastTakeIdRef.current || busy) return
    const takeId = lastTakeIdRef.current
    const generation = ++hearGenerationRef.current
    setError(null)
    setHearing(true)
    try {
      const take = projectRef.current.takes.find((item) => item.id === takeId)
      if (!take) {
        setHearing(false)
        return
      }
      const record = await repo.getAudioBlob(take.audioBlobId)
      if (generation !== hearGenerationRef.current) return
      if (!record) {
        setError('Could not load take')
        setHearing(false)
        return
      }
      const decoded = await decodeAudioFile(record.blob)
      if (generation !== hearGenerationRef.current) return
      const started = await engine.play(
        boothPlaySpec(phrase),
        {
          onEnded: () => {
            if (generation === hearGenerationRef.current) setHearing(false)
          },
        },
        takeAgainstGhostMix(decoded.buffer, take.latencyCompMs),
      )
      if (generation !== hearGenerationRef.current) return
      if (!started) setHearing(false)
    } catch (err: unknown) {
      if (generation !== hearGenerationRef.current) return
      setHearing(false)
      setError(messageFrom(err, 'Could not play take'))
    }
  }

  function handleStopHear() {
    stopHearing()
    engine.stop()
  }

  async function handleKeep() {
    if (!lastTakeIdRef.current || busy) return
    const takeId = lastTakeIdRef.current
    setBusy(true)
    setError(null)
    stopHearing()
    engine.stop()
    try {
      await saveChainRef.current
      const current = projectRef.current
      const next = rateTake(current, takeId, 'keeper')
      const saved = await repo.saveProject({
        ...next,
        completion: deriveCompletion(next),
      })
      projectRef.current = saved
      onProjectChangeRef.current(saved)
      setLastTakeId(null)
      lastTakeIdRef.current = null
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not keep take'))
    } finally {
      setBusy(false)
    }
  }

  async function handleScrap(andArm: boolean) {
    if (!lastTakeIdRef.current || busy) return
    const takeId = lastTakeIdRef.current
    setBusy(true)
    setError(null)
    stopHearing()
    engine.stop()
    try {
      await saveChainRef.current
      const current = projectRef.current
      const { project: without, audioBlobId } = removeTake(current, takeId)
      const saved = await repo.saveProject({
        ...without,
        completion: deriveCompletion(without),
      })
      projectRef.current = saved
      onProjectChangeRef.current(saved)
      if (audioBlobId) {
        try {
          await repo.deleteAudioBlob(audioBlobId)
        } catch {
          // Blob cleanup is best-effort; take metadata is already gone.
        }
      }
      setLastTakeId(null)
      lastTakeIdRef.current = null
      if (andArm) {
        setBusy(false)
        void arm()
        return
      }
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not scrap take'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== ' ' && event.code !== 'Space') return
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
      if (event.repeat) return
      if (lastTakeIdRef.current) return
      toggleArmRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    return () => {
      armedRef.current = false
      hearGenerationRef.current += 1
      engine.stop()
      discardPending()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [engine])

  return (
    <section className="mt-10 flex flex-col items-start gap-4" aria-label="Record">
      <p className="text-sm text-ink-muted" aria-label="Takes">
        {takeCount} / {targetTakes}
      </p>

      {reviewing && lastTake ? (
        <div
          className="w-full max-w-md rounded-lg border border-ink/15 bg-paper px-5 py-4 shadow-sm"
          aria-label="Last take"
        >
          <p className="font-display text-lg font-semibold tracking-tight">
            Take {lastTake.takeIndex} saved
          </p>
          <p className="mt-1 text-sm text-ink/70">Hear it back. Keep it, or scrap and sing again.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {hearing ? (
              <button
                type="button"
                onClick={handleStopHear}
                className="min-h-11 rounded-pill border border-ink/20 px-5 py-2.5 text-sm font-medium studio-transition hover:border-ink/50"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleHear()}
                disabled={busy}
                className="min-h-11 rounded-pill border border-ink/20 px-5 py-2.5 text-sm font-medium studio-transition hover:border-ink/50 disabled:opacity-50"
              >
                Hear it
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleKeep()}
              disabled={busy}
              className="min-h-11 rounded-pill bg-gold/90 px-5 py-2.5 text-sm font-medium text-ink studio-transition hover:bg-gold disabled:opacity-50"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={() => void handleScrap(true)}
              disabled={busy}
              className="min-h-11 rounded-pill bg-record-red px-5 py-2.5 text-sm font-medium text-paper studio-transition hover:bg-ink disabled:opacity-50"
            >
              Scrap &amp; again
            </button>
            <button
              type="button"
              onClick={() => void handleScrap(false)}
              disabled={busy}
              className="min-h-11 text-sm text-ink-muted underline-offset-4 hover:underline disabled:opacity-50"
            >
              Scrap
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Record"
          aria-pressed={armed}
          onClick={() => toggleArm()}
          disabled={busy}
          className={`flex h-24 w-24 items-center justify-center rounded-full text-sm font-medium text-paper studio-transition disabled:opacity-50 ${
            armed ? 'record-lamp' : 'bg-record-red hover:bg-ink'
          }`}
        >
          Record
        </button>
      )}

      {error ? (
        <p role="alert" className="text-record-red">
          {error}
        </p>
      ) : null}

      {processed ? (
        <p role="status" className="max-w-md text-sm text-ink-muted">
          This device insists on echo cancellation or noise suppression. It can duck your voice
          against the ghost — use headphones, or record on desktop Chrome.
        </p>
      ) : null}
    </section>
  )
}
