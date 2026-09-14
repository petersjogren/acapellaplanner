import { useEffect, useRef, useState } from 'react'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { decodeAudioFile } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import {
  BLEND_CHECK_PRESET_ID,
  createAudioBlobLoader,
  loadAllKeepersMixForSong,
  loadPlaybackMixForPhrase,
  loadTakeReviewMix,
  STACK_BUILD_PRESET_ID,
} from '../audio/mix.ts'
import { deriveCompletion } from '../domain/completion.ts'
import type { Project, TakeRating } from '../domain/schemas.ts'
import { exportDawStemsZip } from '../storage/dawExport.ts'
import {
  downloadBlob,
  exportProjectZip,
  projectZipFilename,
  resolveExportBlob,
  stemsZipFilename,
} from '../storage/projectIO.ts'
import {
  applyTakeRating,
  TakeReview,
  type AllKeepersMode,
  type ReviewPlayback,
  type ReviewTakeMode,
} from '../ui/preparer/TakeReview.tsx'
import { PreparerShell } from '../ui/shell/PreparerShell.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function ReviewPage() {
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [playing, setPlaying] = useState<ReviewPlayback | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportingStems, setExportingStems] = useState(false)
  const [keepersOnly, setKeepersOnly] = useState(true)
  const [stemMode, setStemMode] = useState<'lanes' | 'per-take'>('lanes')
  const projectRef = useRef<Project | null>(null)
  const writeQueueRef = useRef(Promise.resolve())
  const bufferRef = useRef<AudioBuffer | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const playGenerationRef = useRef(0)

  bufferRef.current = buffer

  useEffect(() => {
    if (project && typeof project === 'object') {
      projectRef.current = project
    }
  }, [project])

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

  function persistProject(mutate: (current: Project) => Project): Promise<void> {
    const run = writeQueueRef.current.then(async () => {
      const current = projectRef.current ?? loaded
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

  function getEngine(): PlaybackEngine {
    if (!engineRef.current) {
      engineRef.current = createPlaybackEngine({
        getBuffer: () => bufferRef.current,
      })
    }
    return engineRef.current
  }

  async function handleRate(takeId: string, rating: TakeRating) {
    setSaveError(null)
    try {
      await persistProject((current) => applyTakeRating(current, takeId, rating))
    } catch (err: unknown) {
      setSaveError(messageFrom(err, 'Could not save rating'))
    }
  }

  async function handlePlayTake(takeId: string, mode: ReviewTakeMode) {
    const current = projectRef.current ?? loaded
    const take = current.takes.find((item) => item.id === takeId)
    const phrase = current.phrases.find((item) => item.id === take?.phraseId)
    if (!take || !phrase) return
    const generation = ++playGenerationRef.current
    setPlayError(null)
    if (!bufferRef.current) {
      setPlayError('No ghost track to play against')
      return
    }
    try {
      const record = await repo.getAudioBlob(take.audioBlobId)
      if (generation !== playGenerationRef.current) return
      if (!record) {
        setPlayError('Could not load take')
        return
      }
      const decoded = await decodeAudioFile(record.blob)
      if (generation !== playGenerationRef.current) return
      const mix = await loadTakeReviewMix(
        current,
        phrase.id,
        {
          takeId: take.id,
          takeBuffer: decoded.buffer,
          latencyCompMs: take.latencyCompMs,
          mode,
        },
        createAudioBlobLoader((id) => repo.getAudioBlob(id)),
      )
      if (generation !== playGenerationRef.current) return
      const started = await getEngine().play(
        {
          startMs: phrase.startMs,
          endMs: phrase.endMs,
          preRollMs: phrase.preRollMs ?? 0,
          postRollMs: phrase.postRollMs,
          gapMs: phrase.loopDefault.gapMs,
          loop: false,
        },
        {
          onEnded: () => {
            if (generation === playGenerationRef.current) setPlaying(null)
          },
        },
        mix,
      )
      if (generation !== playGenerationRef.current) return
      setPlaying(started ? { kind: 'take', takeId, mode } : null)
    } catch (err: unknown) {
      if (generation !== playGenerationRef.current) return
      setPlaying(null)
      setPlayError(messageFrom(err, 'Could not play take'))
    }
  }

  async function handlePlayAllKeepers(phraseId: string | null, mode: AllKeepersMode) {
    const current = projectRef.current ?? loaded
    const generation = ++playGenerationRef.current
    setPlayError(null)
    if (!bufferRef.current) {
      setPlayError('No ghost track to play against')
      return
    }
    try {
      // Blend Check (ghost muted) or Stack Build (ghost audible) — the same
      // two recipes the booth uses. The real ghost buffer is still what the
      // engine times the window against, even when its gain is muted for
      // the no-ghost mode.
      const presetId = mode === 'with-ghost' ? STACK_BUILD_PRESET_ID : BLEND_CHECK_PRESET_ID
      const loadBuffer = createAudioBlobLoader((id) => repo.getAudioBlob(id))

      let mix
      let playSpec: { startMs: number; endMs: number; preRollMs: number; postRollMs: number }
      if (phraseId) {
        const phrase = current.phrases.find((item) => item.id === phraseId)
        if (!phrase) return
        mix = await loadPlaybackMixForPhrase(current, phraseId, presetId, loadBuffer)
        playSpec = {
          startMs: phrase.startMs,
          endMs: phrase.endMs,
          preRollMs: phrase.preRollMs ?? 0,
          postRollMs: phrase.postRollMs,
        }
      } else {
        // All phrases: every keeper in the song, each at its own phrase's
        // position, spanning the whole ghost track rather than one phrase.
        mix = await loadAllKeepersMixForSong(current, presetId, loadBuffer)
        playSpec = {
          startMs: 0,
          endMs: bufferRef.current.duration * 1000,
          preRollMs: 0,
          postRollMs: 0,
        }
      }
      if (generation !== playGenerationRef.current) return
      if (!mix.extra || mix.extra.length === 0) {
        setPlayError(phraseId ? 'No keepers on this phrase yet' : 'No keepers in the song yet')
        return
      }
      const started = await getEngine().play(
        { ...playSpec, gapMs: 0, loop: false },
        {
          onEnded: () => {
            if (generation === playGenerationRef.current) setPlaying(null)
          },
        },
        mix,
      )
      if (generation !== playGenerationRef.current) return
      setPlaying(started ? { kind: 'phrase', phraseId, mode } : null)
    } catch (err: unknown) {
      if (generation !== playGenerationRef.current) return
      setPlaying(null)
      setPlayError(messageFrom(err, 'Could not play keepers'))
    }
  }

  function handleStop() {
    playGenerationRef.current += 1
    engineRef.current?.stop()
    setPlaying(null)
  }

  async function handleExport() {
    setExportError(null)
    setExporting(true)
    try {
      const current = projectRef.current ?? loaded
      const zip = await exportProjectZip(current, (id) =>
        resolveExportBlob((blobId) => repo.getAudioBlob(blobId), id),
      )
      downloadBlob(zip, projectZipFilename(current.title))
    } catch (err: unknown) {
      setExportError(messageFrom(err, 'Could not export project'))
    } finally {
      setExporting(false)
    }
  }

  async function handleExportStems() {
    setExportError(null)
    setExportingStems(true)
    try {
      const current = projectRef.current ?? loaded
      const loader = createAudioBlobLoader((id) => repo.getAudioBlob(id))
      const zip = await exportDawStemsZip(current, { mode: stemMode, keepersOnly }, loader)
      downloadBlob(zip, stemsZipFilename(current.title))
    } catch (err: unknown) {
      setExportError(messageFrom(err, 'Could not export stems'))
    } finally {
      setExportingStems(false)
    }
  }

  return (
    <PreparerShell title={loaded.title} current="review" projectId={loaded.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-semibold tracking-tight">Keepers</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keepersOnly}
              onChange={(event) => setKeepersOnly(event.target.checked)}
            />
            Keepers only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="daw-stem-mode"
              value="lanes"
              checked={stemMode === 'lanes'}
              onChange={() => setStemMode('lanes')}
            />
            One track per part (recommended)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="daw-stem-mode"
              value="per-take"
              checked={stemMode === 'per-take'}
              onChange={() => setStemMode('per-take')}
            />
            One file per take
          </label>
          <button
            type="button"
            className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5 disabled:opacity-50"
            onClick={() => void handleExportStems()}
            disabled={exportingStems}
          >
            Export stems for DAW
          </button>
          <button
            type="button"
            className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5 disabled:opacity-50"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            Export
          </button>
        </div>
      </div>
      <p className="mt-3 max-w-xl text-ink/70">
        Hear a take with the ghost or solo, or all keepers together with or without the ghost.
      </p>
      {playError ? (
        <p role="alert" className="mt-4 text-record-red">
          {playError}
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-4 text-record-red">
          {saveError}
        </p>
      ) : null}
      {exportError ? (
        <p role="alert" className="mt-4 text-record-red">
          {exportError}
        </p>
      ) : null}
      <TakeReview
        project={loaded}
        onRate={(takeId, rating) => void handleRate(takeId, rating)}
        onPlayTake={(takeId, mode) => void handlePlayTake(takeId, mode)}
        onPlayAllKeepers={(phraseId, mode) => void handlePlayAllKeepers(phraseId, mode)}
        onStop={handleStop}
        playing={playing}
      />
    </PreparerShell>
  )
}
