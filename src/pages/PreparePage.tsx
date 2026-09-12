import { useEffect, useRef, useState } from 'react'
import { PreparerShell } from '../ui/shell/PreparerShell.tsx'
import { decodeAudioFile, formatDuration } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import {
  createAudioBlobLoader,
  GHOST_FOCUS_PRESET_ID,
  loadPlaybackMixForPhrase,
} from '../audio/mix.ts'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import {
  GhostImporter,
  type GhostImportResult,
} from '../ui/preparer/GhostImporter.tsx'
import { GhostTimeline } from '../ui/preparer/GhostTimeline.tsx'
import { deriveCompletion } from '../domain/completion.ts'
import { addPhrase, removePhrase, updatePhrase, type PhrasePatch } from '../domain/phrases.ts'
import {
  addPart,
  removePart,
  updatePart,
  type NewVoicePartInput,
  type VoicePartPatch,
} from '../domain/roster.ts'
import type { Project } from '../domain/schemas.ts'
import { CompletionMatrix } from '../ui/preparer/CompletionMatrix.tsx'
import { VoiceRosterEditor } from '../ui/preparer/VoiceRosterEditor.tsx'
import { MixPresetSelect } from '../ui/shared/MixPresetSelect.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

export function PreparePage() {
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)
  const [mixPresetId, setMixPresetId] = useState(GHOST_FOCUS_PRESET_ID)
  const projectRef = useRef<Project | null>(null)
  const writeQueueRef = useRef(Promise.resolve())
  const bufferRef = useRef<AudioBuffer | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)

  bufferRef.current = buffer

  useEffect(() => {
    return () => {
      engineRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    engineRef.current?.stop()
    setPlaying(false)
  }, [selectedPhraseId])

  useEffect(() => {
    if (project && typeof project === 'object') {
      projectRef.current = project
    }
  }, [project])

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
          // Decode on the playback singleton so the buffer is usable for play().
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

  async function handleImported({ blob, meta }: GhostImportResult) {
    const blobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: blobId,
      projectId: loaded.id,
      kind: 'ghost',
      mimeType: blob.type || 'application/octet-stream',
      byteSize: blob.size,
      createdAt: new Date().toISOString(),
      blob,
    })

    const saved = await repo.saveProject({
      ...loaded,
      ghostTrackId: blobId,
      guides: [
        ...loaded.guides.filter((guide) => guide.kind !== 'ghost'),
        {
          id: crypto.randomUUID(),
          kind: 'ghost',
          audioBlobId: blobId,
          gainDbDefault: 0,
          alignToGhost: true,
        },
      ],
      settings: {
        ...loaded.settings,
        ghostMeta: {
          filename: meta.filename,
          durationMs: meta.durationMs,
        },
      },
    })
    setProject(saved)
  }

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

  async function handleMarkPhrase(startMs: number, endMs: number) {
    await persistProject((current) => addPhrase(current, { startMs, endMs }))
  }

  async function handleUpdatePhrase(id: string, patch: PhrasePatch) {
    await persistProject((current) => updatePhrase(current, id, patch))
  }

  async function handleRemovePhrase(id: string) {
    await persistProject((current) => removePhrase(current, id))
    if (selectedPhraseId === id) setSelectedPhraseId(null)
  }

  async function handleAddPart(partial: NewVoicePartInput) {
    await persistProject((current) => addPart(current, partial))
  }

  async function handleUpdatePart(id: string, patch: VoicePartPatch) {
    await persistProject((current) => updatePart(current, id, patch))
  }

  async function handleRemovePart(id: string) {
    await persistProject((current) => removePart(current, id))
  }

  function getEngine(): PlaybackEngine {
    if (!engineRef.current) {
      engineRef.current = createPlaybackEngine({
        getBuffer: () => bufferRef.current,
      })
    }
    return engineRef.current
  }

  const selectedPhrase = loaded.phrases.find((item) => item.id === selectedPhraseId) ?? null

  async function handlePlay(loop: boolean) {
    if (!selectedPhrase) return
    setPlayError(null)
    try {
      const mix = await loadPlaybackMixForPhrase(
        loaded,
        selectedPhrase.id,
        mixPresetId,
        createAudioBlobLoader((id) => repo.getAudioBlob(id)),
      )
      const started = await getEngine().play(
        {
          startMs: selectedPhrase.startMs,
          endMs: selectedPhrase.endMs,
          preRollMs: selectedPhrase.preRollMs ?? 0,
          postRollMs: selectedPhrase.postRollMs,
          gapMs: selectedPhrase.loopDefault.gapMs,
          loop,
        },
        {
          onEnded: () => setPlaying(false),
        },
        mix,
      )
      // play() returns false if Stop cancelled during AudioContext resume
      setPlaying(started)
    } catch (err: unknown) {
      setPlaying(false)
      setPlayError(err instanceof Error && err.message ? err.message : 'Could not play phrase')
    }
  }

  function handleStop() {
    engineRef.current?.stop()
    setPlaying(false)
  }

  const ghostMeta = loaded.settings.ghostMeta
  const hasGhost = Boolean(loaded.ghostTrackId && ghostMeta)

  return (
    <PreparerShell title={loaded.title} current="prepare" projectId={loaded.id}>
      <h2 className="font-display text-xl font-semibold tracking-tight">{loaded.title}</h2>
      <p className="mt-3 max-w-xl text-ink/70">The ghost is the lead everyone locks to.</p>
      {hasGhost && ghostMeta ? (
        <section className="mt-8 max-w-3xl" aria-label="Ghost track">
          <h3 className="font-medium">Ghost track</h3>
          <p className="mt-2">{ghostMeta.filename}</p>
          <p className="mt-1 text-ink-muted">{formatDuration(ghostMeta.durationMs)}</p>
          <GhostImporter label="Replace ghost track" onImported={handleImported} />
          <GhostTimeline
            durationMs={ghostMeta.durationMs}
            phrases={loaded.phrases}
            buffer={buffer}
            onMarkPhrase={handleMarkPhrase}
            onUpdatePhrase={handleUpdatePhrase}
            onRemovePhrase={handleRemovePhrase}
            onSelectPhrase={setSelectedPhraseId}
          />
          {selectedPhrase && buffer ? (
            <section className="mt-6" aria-label="Phrase playback">
              <h3 className="font-medium">Listen</h3>
              <p className="mt-1 text-sm text-ink-muted">{selectedPhrase.name}</p>
              <div className="mt-3">
                <MixPresetSelect value={mixPresetId} onChange={setMixPresetId} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                  onClick={() => void handlePlay(false)}
                >
                  Play once
                </button>
                <button
                  type="button"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                  onClick={() => void handlePlay(true)}
                >
                  Loop
                </button>
                <button
                  type="button"
                  className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5"
                  onClick={handleStop}
                >
                  Stop
                </button>
              </div>
              {playing ? <p className="mt-2 text-sm text-ink-muted">Playing</p> : null}
              {playError ? (
                <p role="alert" className="mt-2 text-record-red">
                  {playError}
                </p>
              ) : null}
            </section>
          ) : null}
        </section>
      ) : (
        <GhostImporter onImported={handleImported} />
      )}
      <VoiceRosterEditor
        parts={loaded.voiceRoster}
        onAddPart={handleAddPart}
        onUpdatePart={handleUpdatePart}
        onRemovePart={handleRemovePart}
      />
      <CompletionMatrix project={loaded} />
    </PreparerShell>
  )
}
