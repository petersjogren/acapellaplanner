import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { decodeAudioFile } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import { GHOST_FOCUS_PRESET_ID } from '../audio/mix.ts'
import { deriveCompletion } from '../domain/completion.ts'
import { markEnough, reopenEnough, suggestNext } from '../domain/sessionPlan.ts'
import { sheetPageBlobIdsForPhrase } from '../domain/sheets.ts'
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
  const { id: routeProjectId } = useParams()
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [voicePartId, setVoicePartId] = useState<string | null>(null)
  const [phraseId, setPhraseId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [mixPresetId, setMixPresetId] = useState(GHOST_FOCUS_PRESET_ID)
  const [sheetPageUrls, setSheetPageUrls] = useState<Array<string | null>>([])
  const [sheetElapsedMs, setSheetElapsedMs] = useState<number | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const projectRef = useRef<Project | null>(null)
  const writeQueueRef = useRef(Promise.resolve())
  const recordControlRef = useRef<RecordControlHandle>(null)
  const sheetElapsedRafRef = useRef<number | null>(null)

  bufferRef.current = buffer

  const liveProject = project && typeof project === 'object' ? project : null
  const boothPhrase = liveProject && phraseId
    ? liveProject.phrases.find((item) => item.id === phraseId)
    : undefined
  const sheetImageBlobIds =
    liveProject && boothPhrase ? sheetPageBlobIdsForPhrase(liveProject, boothPhrase) : []
  const sheetBlobIdsKey = sheetImageBlobIds.join('|')

  useEffect(() => {
    if (project && typeof project === 'object') {
      projectRef.current = project
    }
  }, [project])

  // Bind to the route song, not loaded project.id — hydrating undefined → id
  // used to run after the first PartPicker paint and wipe a same-tick pick.
  useEffect(() => {
    setVoicePartId(null)
    setPhraseId(null)
    setSaveError(null)
  }, [routeProjectId])

  useEffect(() => {
    let cancelled = false
    const createdUrls: string[] = []
    setSheetPageUrls([])
    if (sheetImageBlobIds.length === 0) return
    // Dedupe: two crops on the same page share one imageBlobId. Calling
    // createObjectURL once per *index* would mint a distinct URL string per
    // call even for the same Blob, so sheetScrollFrame's same-image check
    // (imageKeys compared by ===) would wrongly see "different images" and
    // hard-cut between crops that are actually the same page — killing the
    // smooth pan for the common side-by-side-crops-on-one-page case.
    const uniqueIds = Array.from(new Set(sheetImageBlobIds.filter((id): id is string => Boolean(id))))
    void Promise.all(uniqueIds.map((id) => repo.getAudioBlob(id)))
      .then((records) => {
        const urlById = new Map<string, string>()
        records.forEach((record, index) => {
          if (!record) return
          const next = URL.createObjectURL(record.blob)
          createdUrls.push(next)
          urlById.set(uniqueIds[index]!, next)
        })
        const urls = sheetImageBlobIds.map((id) => (id ? (urlById.get(id) ?? null) : null))
        if (!cancelled) setSheetPageUrls(urls)
      })
      .catch(() => {
        if (!cancelled) setSheetPageUrls([])
      })
    return () => {
      cancelled = true
      for (const url of createdUrls) URL.revokeObjectURL(url)
    }
    // sheetBlobIdsKey is the stable identity for sheetImageBlobIds' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetBlobIdsKey, repo])

  // Only a phrase bound to several crops needs to know elapsed time, to pan
  // between them — one crop (or none) is a static image regardless of where
  // playback is. Skip the rAF churn for the common single-crop case.
  useEffect(() => {
    if (!boothPhrase || boothPhrase.sheetRefs.length < 2) {
      setSheetElapsedMs(null)
      return
    }
    let cancelled = false
    function tick() {
      if (cancelled) return
      const posMs = engineRef.current?.getPositionMs() ?? null
      setSheetElapsedMs(posMs == null ? null : Math.max(0, posMs - boothPhrase!.startMs))
      sheetElapsedRafRef.current = requestAnimationFrame(tick)
    }
    sheetElapsedRafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (sheetElapsedRafRef.current != null) cancelAnimationFrame(sheetElapsedRafRef.current)
      sheetElapsedRafRef.current = null
    }
  }, [boothPhrase])

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

  async function advancePastPhrase() {
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

  function handleGoodEnough() {
    void advancePastPhrase()
  }

  function handleNext() {
    void advancePastPhrase()
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
    <SingerShell songTitle={loaded.title} partLabel={part?.name} projectId={loaded.id}>
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
            sheetPageUrls={sheetPageUrls}
            sheetElapsedMs={sheetElapsedMs}
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
              onClick={handleGoodEnough}
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
