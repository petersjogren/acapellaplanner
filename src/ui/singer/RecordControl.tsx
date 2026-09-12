import { useEffect, useRef, useState } from 'react'
import { useProjectRepository } from '../../app/projectRepositoryContext.tsx'
import type { PlaybackEngine } from '../../audio/engine.ts'
import {
  ghostHeadphoneMixSnapshot,
  isEmptyTake,
  nextTakeIndex,
  requestMicStream,
  startRecording,
  takeLabel,
  type RecordingResult,
  type StartedRecording,
} from '../../audio/record.ts'
import { deriveCompletion } from '../../domain/completion.ts'
import type { Phrase, Project, Take, VoicePart } from '../../domain/schemas.ts'

export type RecordControlProps = {
  phrase: Phrase
  voicePart: VoicePart
  project: Project
  onProjectChange: (project: Project) => void
  engine: PlaybackEngine
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function RecordControl({
  phrase,
  voicePart,
  project,
  onProjectChange,
  engine,
}: RecordControlProps) {
  const repo = useProjectRepository()
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const armedRef = useRef(false)
  const armingRef = useRef(false)
  const projectRef = useRef(project)
  const onProjectChangeRef = useRef(onProjectChange)
  const streamRef = useRef<MediaStream | null>(null)
  const pendingRef = useRef<StartedRecording[]>([])
  const saveChainRef = useRef(Promise.resolve())
  const toggleArmRef = useRef<() => void>(() => undefined)

  projectRef.current = project
  onProjectChangeRef.current = onProjectChange

  const targetTakes =
    phrase.partPlan.find((item) => item.voicePartId === voicePart.id)?.targetTakes ??
    voicePart.targetTakes
  const takeCount = project.takes.filter(
    (item) => item.phraseId === phrase.id && item.voicePartId === voicePart.id,
  ).length

  async function persistTake(result: RecordingResult) {
    if (isEmptyTake(result)) {
      setError('nothing caught — try again')
      return
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
      headphoneMixSnapshot: ghostHeadphoneMixSnapshot(current),
      latencyCompMs: 0,
      peakDb: 0,
      clipFlag: false,
    }
    const next: Project = {
      ...current,
      takes: [...current.takes, take],
    }
    const saved = await repo.saveProject({
      ...next,
      completion: deriveCompletion(next),
    })
    projectRef.current = saved
    onProjectChangeRef.current(saved)
  }

  function queuePersist(rec: StartedRecording) {
    const stopped = rec.stop()
    saveChainRef.current = saveChainRef.current
      .then(async () => {
        const result = await stopped
        await persistTake(result)
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

  function disarm() {
    armedRef.current = false
    setArmed(false)
    engine.stop()
    discardPending()
    stopMic()
  }

  async function arm() {
    if (armingRef.current || armedRef.current) return
    armingRef.current = true
    setError(null)
    try {
      if (!streamRef.current) {
        streamRef.current = await requestMicStream()
      }

      armedRef.current = true
      const started = await engine.play(
        {
          startMs: phrase.startMs,
          endMs: phrase.endMs,
          preRollMs: phrase.preRollMs ?? 0,
          postRollMs: phrase.postRollMs,
          gapMs: phrase.loopDefault.gapMs,
          loop: phrase.loopDefault.mode === 'phrase-loop',
        },
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
    if (armingRef.current) return
    if (armedRef.current) disarm()
    else void arm()
  }

  toggleArmRef.current = toggleArm

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== ' ' && event.code !== 'Space') return
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
      if (event.repeat) return
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
      <button
        type="button"
        aria-label="Record"
        aria-pressed={armed}
        onClick={() => toggleArm()}
        className={`flex h-24 w-24 items-center justify-center rounded-full text-sm font-medium text-paper studio-transition ${
          armed ? 'record-lamp' : 'bg-record-red hover:bg-ink'
        }`}
      >
        Record
      </button>
      {error ? (
        <p role="alert" className="text-record-red">
          {error}
        </p>
      ) : null}
    </section>
  )
}
