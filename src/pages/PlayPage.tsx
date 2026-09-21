import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { decodeAudioFile } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import {
  createAudioBlobLoader,
  GHOST_FOCUS_PRESET_ID,
  loadAllKeepersMixForSong,
  loadPlaybackMixForPhrase,
  rebaseMixToPlayStart,
  shiftMixLayerOffsetMs,
} from '../audio/mix.ts'
import {
  phraseForPlayhead,
  playAlongWindow,
  type PlayAlongLoopMode,
} from '../domain/playAlong.ts'
import { sortPhrases } from '../domain/phrases.ts'
import { addFilmPin, clearFilmPins, filmScrollProgress, sheetPageBlobIdsForCrops } from '../domain/sheets.ts'
import type { Phrase, Project } from '../domain/schemas.ts'
import { deriveCompletion } from '../domain/completion.ts'
import { MixPresetSelect } from '../ui/shared/MixPresetSelect.tsx'
import { SingerShell } from '../ui/shell/SingerShell.tsx'
import { BoothLayout } from '../ui/singer/BoothLayout.tsx'
import { PhraseStage } from '../ui/singer/PhraseStage.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function phraseLabel(phrase: Phrase): string {
  return phrase.lyricText?.trim() || phrase.name
}

export function PlayPage() {
  const { id: routeProjectId } = useParams()
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [mixPresetId, setMixPresetId] = useState(GHOST_FOCUS_PRESET_ID)
  const [loopMode, setLoopMode] = useState<PlayAlongLoopMode>('off')
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null)
  const [playheadMs, setPlayheadMs] = useState<number | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [sheetPageUrls, setSheetPageUrls] = useState<Array<string | null>>([])
  const bufferRef = useRef<AudioBuffer | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const playGenerationRef = useRef(0)
  const selectedPhraseIdRef = useRef<string | null>(null)
  const phrasesRef = useRef<Phrase[]>([])
  const sheetElapsedRafRef = useRef<number | null>(null)
  const writeQueueRef = useRef(Promise.resolve())
  const projectRef = useRef<Project | null>(null)

  bufferRef.current = buffer
  selectedPhraseIdRef.current = selectedPhraseId

  const liveProject = project && typeof project === 'object' ? project : null
  if (liveProject) projectRef.current = liveProject
  const phrases = liveProject ? sortPhrases(liveProject.phrases) : []
  phrasesRef.current = phrases
  const filmPins = liveProject?.filmPins ?? []

  useEffect(() => {
    setSelectedPhraseId(null)
    setLoopMode('off')
    setPausedAtMs(null)
    setPlaying(false)
    setPlayheadMs(null)
    setPlayError(null)
    playGenerationRef.current += 1
    engineRef.current?.stop()
  }, [routeProjectId])

  useEffect(() => {
    if (phrases.length === 0) {
      setSelectedPhraseId(null)
      return
    }
    setSelectedPhraseId((current) =>
      current && phrases.some((item) => item.id === current) ? current : phrases[0]!.id,
    )
  }, [phrases])

  const selectedPhrase = selectedPhraseId
    ? phrases.find((item) => item.id === selectedPhraseId)
    : undefined
  const playheadPhrase =
    playheadMs != null ? phraseForPlayhead(phrases, playheadMs) : undefined
  const displayPhrase = (playing ? playheadPhrase : undefined) ?? selectedPhrase ?? playheadPhrase
  const sheetCrops = liveProject?.sheetCrops ?? []
  const sheetImageBlobIds = liveProject ? sheetPageBlobIdsForCrops(liveProject, sheetCrops) : []
  const sheetBlobIdsKey = sheetImageBlobIds.join('|')

  useEffect(() => {
    let cancelled = false
    const createdUrls: string[] = []
    setSheetPageUrls([])
    if (sheetImageBlobIds.length === 0) return
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

  useEffect(() => {
    if (!playing) return
    let cancelled = false
    function tick() {
      if (cancelled) return
      const posMs = engineRef.current?.getPositionMs() ?? null
      setPlayheadMs(posMs)
      if (posMs != null) {
        const hopped = phraseForPlayhead(phrasesRef.current, posMs)
        if (hopped && hopped.id !== selectedPhraseIdRef.current) {
          selectedPhraseIdRef.current = hopped.id
          setSelectedPhraseId(hopped.id)
        }
      }
      sheetElapsedRafRef.current = requestAnimationFrame(tick)
    }
    sheetElapsedRafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (sheetElapsedRafRef.current != null) cancelAnimationFrame(sheetElapsedRafRef.current)
      sheetElapsedRafRef.current = null
    }
  }, [playing])

  useEffect(() => {
    return () => {
      playGenerationRef.current += 1
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

  function persistProject(mutate: (current: Project) => Project): void {
    const run = writeQueueRef.current.then(async () => {
      const current = projectRef.current
      if (!current) return
      const next = mutate(current)
      const saved = await repo.saveProject({ ...next, completion: deriveCompletion(next) })
      projectRef.current = saved
      setProject(saved)
    })
    writeQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    )
  }

  function getEngine(): PlaybackEngine {
    if (!engineRef.current) {
      engineRef.current = createPlaybackEngine({
        getBuffer: () => bufferRef.current,
      })
    }
    return engineRef.current
  }

  function ghostDurationMs(): number {
    if (bufferRef.current) return bufferRef.current.duration * 1000
    return loaded.settings.ghostMeta?.durationMs ?? 0
  }

  async function startPlayback(options?: {
    fromMs?: number
    loopMode?: PlayAlongLoopMode
    mixPresetId?: string
  }) {
    const mode = options?.loopMode ?? loopMode
    const presetId = options?.mixPresetId ?? mixPresetId
    const current = loaded
    const generation = ++playGenerationRef.current
    setPlayError(null)
    if (!bufferRef.current) {
      setPlayError('No ghost track to play')
      setPlaying(false)
      return
    }
    const window = playAlongWindow({
      loopMode: mode,
      phrases: sortPhrases(current.phrases),
      sections: current.sections,
      selectedPhraseId: selectedPhraseIdRef.current,
      ghostDurationMs: ghostDurationMs(),
      fromMs: mode === 'off' ? options?.fromMs : undefined,
    })
    if (!window) {
      setPlaying(false)
      setPausedAtMs(null)
      setPlayheadMs(null)
      return
    }
    try {
      const loadBuffer = createAudioBlobLoader((id) => repo.getAudioBlob(id))
      const selected = sortPhrases(current.phrases).find(
        (item) => item.id === selectedPhraseIdRef.current,
      )
      const loopingOnePhrase =
        window.loop &&
        selected != null &&
        window.startMs === selected.startMs &&
        window.endMs === selected.endMs

      let mix
      if (loopingOnePhrase && selected) {
        mix = shiftMixLayerOffsetMs(
          await loadPlaybackMixForPhrase(current, selected.id, presetId, loadBuffer),
          selected.preRollMs ?? 0,
        )
      } else {
        mix = rebaseMixToPlayStart(
          await loadAllKeepersMixForSong(current, presetId, loadBuffer),
          window.startMs,
          window.endMs - window.startMs,
        )
      }
      if (generation !== playGenerationRef.current) return
      const started = await getEngine().play(
        {
          startMs: window.startMs,
          endMs: window.endMs,
          preRollMs: 0,
          postRollMs: 0,
          gapMs: window.gapMs,
          loop: window.loop,
        },
        {
          onEnded: () => {
            if (generation !== playGenerationRef.current) return
            setPlaying(false)
            setPausedAtMs(null)
            setPlayheadMs(window.endMs)
          },
        },
        mix,
      )
      if (generation !== playGenerationRef.current) return
      if (started) {
        setPlaying(true)
        setPlayheadMs(window.startMs)
      } else {
        setPlaying(false)
      }
    } catch (err: unknown) {
      if (generation !== playGenerationRef.current) return
      setPlaying(false)
      setPlayError(messageFrom(err, 'Could not play'))
    }
  }

  function handleStop() {
    playGenerationRef.current += 1
    engineRef.current?.stop()
    setPlaying(false)
    setPausedAtMs(null)
    const window = playAlongWindow({
      loopMode,
      phrases,
      sections: loaded.sections,
      selectedPhraseId,
      ghostDurationMs: ghostDurationMs(),
    })
    setPlayheadMs(window?.startMs ?? 0)
  }

  function handlePause() {
    const pos = engineRef.current?.getPositionMs() ?? playheadMs
    playGenerationRef.current += 1
    engineRef.current?.stop()
    setPlaying(false)
    setPausedAtMs(pos)
    setPlayheadMs(pos)
  }

  function handlePlay() {
    void startPlayback({ fromMs: loopMode === 'off' ? (pausedAtMs ?? playheadMs ?? 0) : undefined })
  }

  function handleJump(phrase: Phrase) {
    setSelectedPhraseId(phrase.id)
    selectedPhraseIdRef.current = phrase.id
    setPausedAtMs(loopMode === 'off' ? phrase.startMs : null)
    setPlayheadMs(phrase.startMs)
    if (playing) {
      void startPlayback({ fromMs: loopMode === 'off' ? phrase.startMs : undefined })
    }
  }

  function handleLoopModeChange(next: PlayAlongLoopMode) {
    setLoopMode(next)
    setPausedAtMs(null)
    const window = playAlongWindow({
      loopMode: next,
      phrases,
      sections: loaded.sections,
      selectedPhraseId,
      ghostDurationMs: ghostDurationMs(),
    })
    setPlayheadMs(window?.startMs ?? 0)
    if (playing) {
      void startPlayback({ loopMode: next })
    }
  }

  const restMs = playheadMs ?? selectedPhrase?.startMs ?? 0
  const sheetProgress = filmScrollProgress(phrases, restMs, filmPins)
  const hasPins = filmPins.length > 0

  function handlePickSheet(u: number) {
    persistProject((current) => addFilmPin(current, restMs, u))
  }

  function handleClearPins() {
    persistProject((current) => clearFilmPins(current))
  }
  const phraseIndex = displayPhrase
    ? phrases.findIndex((item) => item.id === displayPhrase.id) + 1
    : 0
  const canPlay = Boolean(buffer) && ghostDurationMs() > 0
  const showPause = playing && loopMode === 'off'

  return (
    <SingerShell songTitle={loaded.title} projectId={loaded.id} current="play">
      {displayPhrase ? (
        <BoothLayout
          dock={
            <>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                {playing && showPause ? (
                  <button
                    type="button"
                    onClick={handlePause}
                    className="min-h-11 rounded-pill border border-ink/20 px-8 py-3 text-base font-medium studio-transition hover:border-ink/50"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePlay}
                    disabled={!canPlay || playing}
                    className="min-h-11 rounded-pill border border-ink/20 px-8 py-3 text-base font-medium studio-transition hover:border-ink/50 disabled:opacity-50"
                  >
                    Play
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!playing && pausedAtMs == null && (playheadMs == null || playheadMs === 0)}
                  className="min-h-11 rounded-pill border border-ink/20 px-8 py-3 text-base font-medium studio-transition hover:border-ink/50 disabled:opacity-50"
                >
                  Stop
                </button>
                <fieldset>
                  <legend className="text-sm text-ink-muted">Practice</legend>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {(
                      [
                        ['off', 'Once through'],
                        ['phrase', 'Loop this phrase'],
                        ['section', 'Loop this section'],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="play-loop"
                          value={value}
                          checked={loopMode === value}
                          onChange={() => {
                            handleLoopModeChange(value)
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <MixPresetSelect
                  compact
                  value={mixPresetId}
                  onChange={(id) => {
                    setMixPresetId(id)
                    if (playing) {
                      const from = loopMode === 'off' ? (engineRef.current?.getPositionMs() ?? 0) : undefined
                      void startPlayback({ fromMs: from, mixPresetId: id })
                    }
                  }}
                />
              </div>
              {sheetCrops.length > 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  Click the notes that should be in the middle now.
                  {hasPins ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={handleClearPins}
                        className="underline-offset-2 hover:text-ink hover:underline"
                      >
                        Clear all
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
              {phrases.length > 0 ? (
                <ol className="mt-2 flex max-w-full gap-1 overflow-x-auto" aria-label="Phrases">
                  {phrases.map((item) => {
                    const current = item.id === displayPhrase.id
                    return (
                      <li key={item.id} className="shrink-0">
                        <button
                          type="button"
                          aria-current={current ? 'true' : undefined}
                          onClick={() => handleJump(item)}
                          className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm studio-transition ${
                            current ? 'bg-ink text-paper' : 'text-ink/80 hover:bg-ink/5'
                          }`}
                        >
                          {phraseLabel(item)}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : null}
              {playError ? (
                <p role="alert" className="mt-3 text-record-red">
                  {playError}
                </p>
              ) : null}
            </>
          }
        >
          <PhraseStage
            phrase={displayPhrase}
            phraseIndex={phraseIndex}
            phraseCount={phrases.length}
            sheetCrops={sheetCrops}
            pageImageUrls={sheetPageUrls}
            sheetProgress={sheetProgress}
            sheetCenter={hasPins}
            onPickSheet={handlePickSheet}
          />
        </BoothLayout>
      ) : (
        <div className="pb-8 md:pb-12">
          {!ghostTrackId ? (
            <p className="max-w-md text-ink/70">
              Import a ghost on Prepare before you can follow the song.
            </p>
          ) : (
            <p className="max-w-md text-ink/70">
              Mark phrases on Prepare so the sheet can follow along.
            </p>
          )}
        </div>
      )}
    </SingerShell>
  )
}
