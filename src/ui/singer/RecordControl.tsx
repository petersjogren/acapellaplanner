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
  const [micBlocked, setMicBlocked] = useState(false)
  const armedRef = useRef(false)
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
    const current = projectRef.current
    const takeIndex = nextTakeIndex(current.takes, phrase.id, voicePart.id)
    const found = current.phrases.findIndex((item) => item.id === phrase.id)
    const phraseIndex = found >= 0 ? found + 1 : 1
    const audioBlobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: audioBlobId,
      projectId: current.id,
      kind: 'take',
      mimeType: result.mimeType,
      byteSize: result.byteSize,
      createdAt: new Date().toISOString(),
      blob: result.blob,
    })
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

  function discardPending() {
    const pending = pendingRef.current.splice(0)
    for (const rec of pending) void rec.stop()
  }

  function disarm() {
    armedRef.current = false
    setArmed(false)
    engine.stop()
    discardPending()
  }

  async function arm() {
    setError(null)
    try {
      if (!streamRef.current) {
        streamRef.current = await requestMicStream()
      }
    } catch (err: unknown) {
      setMicBlocked(true)
      setError(messageFrom(err, 'Microphone permission is needed to record'))
      return
    }

    armedRef.current = true
    try {
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
            saveChainRef.current = saveChainRef.current
              .then(async () => {
                const result = await rec.stop()
                if (!armedRef.current) return
                await persistTake(result)
              })
              .catch((err: unknown) => {
                setError(messageFrom(err, 'Could not save take'))
              })
          },
          onEnded: () => {
            armedRef.current = false
            setArmed(false)
          },
        },
      )
      if (!started) {
        armedRef.current = false
        setArmed(false)
        discardPending()
        return
      }
      setArmed(true)
    } catch (err: unknown) {
      armedRef.current = false
      setArmed(false)
      discardPending()
      setError(messageFrom(err, 'Could not start recording'))
    }
  }

  function toggleArm() {
    if (micBlocked) return
    if (armedRef.current) disarm()
    else void arm()
  }

  toggleArmRef.current = toggleArm

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== ' ' && event.code !== 'Space') return
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
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
        disabled={micBlocked}
        onClick={() => toggleArm()}
        className={`flex h-24 w-24 items-center justify-center rounded-full text-sm font-medium text-paper studio-transition disabled:opacity-50 ${
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
