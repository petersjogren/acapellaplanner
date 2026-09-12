import { useEffect, useRef, useState } from 'react'
import { PreparerShell } from '../ui/shell/PreparerShell.tsx'
import { decodeAudioFile, formatDuration } from '../audio/decode.ts'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import {
  GhostImporter,
  type GhostImportResult,
} from '../ui/preparer/GhostImporter.tsx'
import { GhostTimeline } from '../ui/preparer/GhostTimeline.tsx'
import { deriveCompletion } from '../domain/completion.ts'
import { addPhrase, removePhrase, updatePhrase, type PhrasePatch } from '../domain/phrases.ts'
import type { Project, VoicePart } from '../domain/schemas.ts'
import { CompletionMatrix } from '../ui/preparer/CompletionMatrix.tsx'
import { VoiceRosterEditor } from '../ui/preparer/VoiceRosterEditor.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

export function PreparePage() {
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const projectRef = useRef<Project | null>(null)
  const writeQueueRef = useRef(Promise.resolve())

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
  }

  async function handleRosterChange(voiceRoster: VoicePart[]) {
    await persistProject((current) => ({ ...current, voiceRoster }))
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
          />
        </section>
      ) : (
        <GhostImporter onImported={handleImported} />
      )}
      <VoiceRosterEditor parts={loaded.voiceRoster} onChange={handleRosterChange} />
      <CompletionMatrix project={loaded} />
    </PreparerShell>
  )
}
