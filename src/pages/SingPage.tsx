import { useEffect, useRef, useState } from 'react'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { decodeAudioFile } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import { GHOST_FOCUS_PRESET_ID } from '../audio/mix.ts'
import { deriveCompletion } from '../domain/completion.ts'
import { markEnough, reopenEnough, suggestNext } from '../domain/sessionPlan.ts'
import { sheetPageBlobId } from '../domain/sheets.ts'
import type { Phrase, Project, VoicePart } from '../domain/schemas.ts'
import { SingerShell } from '../ui/shell/SingerShell.tsx'
import { PartPicker } from '../ui/singer/PartPicker.tsx'
import { PhraseStage } from '../ui/singer/PhraseStage.tsx'
import { ProgressRibbon } from '../ui/singer/ProgressRibbon.tsx'
import { RecordControl, type RecordControlHandle } from '../ui/singer/RecordControl.tsx'
import { MixPresetSelect } from '../ui/shared/MixPresetSelect.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

const EMPTY_BOOTH =
  'Nothing to sing yet — the preparer still needs phrases and voice parts.'

function liveParts(project: Project): VoicePart[] {
  return project.voiceRoster.filter((item) => !item.isGhost)
}

function sortPhrases(phrases: Phrase[]): Phrase[] {
  return [...phrases].sort((a, b) => a.startMs - b.startMs)
}

function cellTakeCount(project: Project, phraseId: string, voicePartId: string): number {
  return project.takes.filter(
    (item) => item.phraseId === phraseId && item.voicePartId === voicePartId,
  ).length
}

function isPhraseDone(phrase: Phrase, part: VoicePart): boolean {
  const plan = phrase.partPlan.find((item) => item.voicePartId === part.id)
  return plan?.status === 'enough' || plan?.status === 'final'
}

export function SingPage() {
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [voicePartId, setVoicePartId] = useState<string | null>(null)
  const [phraseId, setPhraseId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [mixPresetId, setMixPresetId] = useState(GHOST_FOCUS_PRESET_ID)
  const [sheetPageUrl, setSheetPageUrl] = useState<string | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const projectRef = useRef<Project | null>(null)
  const writeQueueRef = useRef(Promise.resolve())
  const recordControlRef = useRef<RecordControlHandle>(null)

  bufferRef.current = buffer

  const projectId = project && typeof project === 'object' ? project.id : undefined
  const liveProject = project && typeof project === 'object' ? project : null
  const boothPhrase = liveProject && phraseId
    ? liveProject.phrases.find((item) => item.id === phraseId)
    : undefined
  const sheetImageBlobId =
    liveProject && boothPhrase ? sheetPageBlobId(liveProject, boothPhrase) : undefined

  useEffect(() => {
    if (project && typeof project === 'object') {
      projectRef.current = project
    }
  }, [project])

  useEffect(() => {
    setVoicePartId(null)
    setPhraseId(null)
    setSaveError(null)
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    setSheetPageUrl(null)
    if (!sheetImageBlobId) return
    void repo
      .getAudioBlob(sheetImageBlobId)
      .then((record) => {
        if (!record) return
        const next = URL.createObjectURL(record.blob)
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        url = next
        setSheetPageUrl(next)
      })
      .catch(() => {
        if (!cancelled) setSheetPageUrl(null)
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [sheetImageBlobId, repo])

  useEffect(() => {
    return () => {
      engineRef.current?.stop()
    }
  }, [])

  const ghostTrackId = project && typeof project === 'object' ? project.ghostTrackId : null

  useEffect(() => {
    let cancelled = false
    setBuffer(null)
    if (!ghostTrackId) return
    void repo
      .getAudioBlob(ghostTrackId)
      .then(async (record) => {
        if (!record || cancelled) return
        try {
          const decoded = await decodeAudioFile(record.blob)
          if (!cancelled) setBuffer(decoded.buffer)
        } catch {
          if (!cancelled) setBuffer(null)
        }
      })
      .catch(() => {
        if (!cancelled) setBuffer(null)
      })
    return () => {
      cancelled = true
    }
  }, [ghostTrackId, repo])

  if (error) {
    return <StorageError message={error} />
  }
  if (project === undefined) {
    return <p className="px-10 py-8 font-ui text-ink-muted">Loading…</p>
  }
  if (project === null) {
    return <ProjectNotFound />
  }

  const loaded = project

  function getEngine(): PlaybackEngine {
    if (!engineRef.current) {
      engineRef.current = createPlaybackEngine({
        getBuffer: () => bufferRef.current,
      })
    }
    return engineRef.current
  }

  const parts = liveParts(loaded)
  const phrases = sortPhrases(loaded.phrases)
  const ready = parts.length > 0 && phrases.length > 0
  const part = voicePartId ? parts.find((item) => item.id === voicePartId) : undefined
  const phrase = phraseId ? phrases.find((item) => item.id === phraseId) : undefined

  function applySuggestion(suggestion: ReturnType<typeof suggestNext>, lockedPartId?: string) {
    if (!suggestion) {
      setPhraseId(null)
      if (lockedPartId) setVoicePartId(lockedPartId)
      return
    }
    setVoicePartId(suggestion.voicePartId)
    setPhraseId(suggestion.phraseId)
  }

  function latestProject(): Project {
    return projectRef.current ?? loaded
  }

  function handleProjectChange(next: Project) {
    projectRef.current = next
    setProject(next)
  }

  function persistProject(mutate: (current: Project) => Project): Promise<void> {
    const run = writeQueueRef.current.then(async () => {
      const current = latestProject()
      const next = mutate(current)
      const saved = await repo.saveProject({
        ...next,
        completion: deriveCompletion(next),
      })
      projectRef.current = saved
      setProject(saved)
    })
    writeQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function handlePick(id: string) {
    setSaveError(null)
    applySuggestion(suggestNext(latestProject(), { voicePartId: id }), id)
  }

  function handleSurprise() {
    setSaveError(null)
    applySuggestion(suggestNext(latestProject()))
  }

  function handleChooseAnother() {
    setSaveError(null)
    setVoicePartId(null)
    setPhraseId(null)
  }

  async function handleGoodEnough() {
    if (!part || !phrase) return
    setSaveError(null)
    try {
      await recordControlRef.current?.flushSaves()
      await persistProject((current) => markEnough(current, phrase.id, part.id))
      applySuggestion(suggestNext(latestProject(), { voicePartId: part.id }), part.id)
    } catch (err: unknown) {
      setSaveError(err instanceof Error && err.message ? err.message : 'Could not save')
    }
  }

  function handleNext() {
    if (!part || !phrase) return
    setSaveError(null)
    applySuggestion(
      suggestNext(markEnough(latestProject(), phrase.id, part.id), {
        voicePartId: part.id,
      }),
      part.id,
    )
  }

  async function handleNeedMoreTakes() {
    if (!part) return
    setSaveError(null)
    try {
      await recordControlRef.current?.flushSaves()
      await persistProject((current) => reopenEnough(current, part.id))
      applySuggestion(suggestNext(latestProject(), { voicePartId: part.id }), part.id)
    } catch (err: unknown) {
      setSaveError(err instanceof Error && err.message ? err.message : 'Could not save')
    }
  }

  const phraseIndex = phrase ? phrases.findIndex((item) => item.id === phrase.id) + 1 : 0
  const takeCount = phrase && part ? cellTakeCount(loaded, phrase.id, part.id) : 0
  const targetTakes =
    phrase && part
      ? (phrase.partPlan.find((item) => item.voicePartId === part.id)?.targetTakes ?? part.targetTakes)
      : 0
  const sungPhrases = part ? phrases.filter((item) => isPhraseDone(item, part)).length : 0

  return (
    <SingerShell songTitle={loaded.title} partLabel={part?.name}>
      {!ready ? (
        <>
          <p className="font-display text-lyric leading-snug">The booth is quiet.</p>
          <p className="mt-3 max-w-md text-ink/70">{EMPTY_BOOTH}</p>
        </>
      ) : !voicePartId ? (
        <PartPicker parts={parts} onPick={handlePick} onSurprise={handleSurprise} />
      ) : part && phrase ? (
        <>
          <PhraseStage
            phrase={phrase}
            phraseIndex={phraseIndex}
            phraseCount={phrases.length}
            partColor={part.color}
            sheetPageUrl={sheetPageUrl}
          />
          <div className="mt-8">
            <ProgressRibbon
              takeCount={takeCount}
              targetTakes={targetTakes}
              sungPhrases={sungPhrases}
              phraseCount={phrases.length}
              partName={part.name}
            />
          </div>
          <div className="mt-8">
            <MixPresetSelect value={mixPresetId} onChange={setMixPresetId} />
          </div>
          <RecordControl
            key={`${phrase.id}:${part.id}`}
            ref={recordControlRef}
            phrase={phrase}
            voicePart={part}
            project={loaded}
            onProjectChange={handleProjectChange}
            engine={getEngine()}
            mixPresetId={mixPresetId}
          />
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => void handleGoodEnough()}
              className="min-h-11 rounded-pill border border-ink/20 px-8 py-3 text-base font-medium studio-transition hover:border-ink/50"
            >
              Good enough
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="text-sm text-ink-muted underline-offset-4 hover:underline"
            >
              Next
            </button>
            <button
              type="button"
              onClick={handleChooseAnother}
              className="text-sm text-ink-muted underline-offset-4 hover:underline"
            >
              Sing another part
            </button>
          </div>
          {saveError ? (
            <p role="alert" className="mt-4 text-record-red">
              {saveError}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="font-display text-lyric leading-snug">
            {part ? `That’s a wrap for ${part.name}.` : 'Every line has a home.'}
          </p>
          <p className="mt-3 max-w-md text-ink/70">
            {part
              ? 'This part is full enough. Need more takes, sing another part, or rest the voice.'
              : 'Nothing left to sing — the stack is complete.'}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            {part ? (
              <button
                type="button"
                onClick={() => void handleNeedMoreTakes()}
                className="min-h-11 rounded-pill border border-ink/20 px-8 py-3 text-base font-medium studio-transition hover:border-ink/50"
              >
                Need more takes
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleChooseAnother}
              className="text-sm text-ink-muted underline-offset-4 hover:underline"
            >
              Sing another part
            </button>
          </div>
        </>
      )}
    </SingerShell>
  )
}
