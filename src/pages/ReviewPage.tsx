import { useEffect, useRef, useState } from 'react'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { decodeAudioFile } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import {
  BLEND_CHECK_PRESET_ID,
  createAudioBlobLoader,
  loadPlaybackMixForPhrase,
  loadTakeReviewMix,
} from '../audio/mix.ts'
import { deriveCompletion } from '../domain/completion.ts'
import type { Project, TakeRating } from '../domain/schemas.ts'
import {
  downloadBlob,
  exportProjectZip,
  projectZipFilename,
  resolveExportBlob,
} from '../storage/projectIO.ts'
import {
  applyTakeRating,
  TakeReview,
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

  async function handlePlayAllKeepers(phraseId: string) {
    const current = projectRef.current ?? loaded
    const phrase = current.phrases.find((item) => item.id === phraseId)
    if (!phrase) return
    const generation = ++playGenerationRef.current
    setPlayError(null)
    if (!bufferRef.current) {
      setPlayError('No ghost track to play against')
      return
    }
    try {
      // Blend Check: ghost muted, keepers only — same recipe the booth uses
      // to check whether a stack holds on its own. The real ghost buffer is
      // still what the engine times the window against; it just plays silent.
      const mix = await loadPlaybackMixForPhrase(
        current,
        phraseId,
        BLEND_CHECK_PRESET_ID,
        createAudioBlobLoader((id) => repo.getAudioBlob(id)),
      )
      if (generation !== playGenerationRef.current) return
      if (!mix.extra || mix.extra.length === 0) {
        setPlayError('No keepers on this phrase yet')
        return
      }
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
      setPlaying(started ? { kind: 'phrase', phraseId } : null)
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

  return (
    <PreparerShell title={loaded.title} current="review" projectId={loaded.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-semibold tracking-tight">Keepers</h2>
        <button
          type="button"
          className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5 disabled:opacity-50"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          Export
        </button>
      </div>
      <p className="mt-3 max-w-xl text-ink/70">
        Hear a take with the ghost or solo, or all keepers together to check the blend.
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
        onPlayAllKeepers={(phraseId) => void handlePlayAllKeepers(phraseId)}
        onStop={handleStop}
        playing={playing}
      />
    </PreparerShell>
  )
}
