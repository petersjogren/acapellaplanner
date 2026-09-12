import { PreparerShell } from '../ui/shell/PreparerShell.tsx'
import { formatDuration } from '../audio/decode.ts'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import {
  GhostImporter,
  type GhostImportResult,
} from '../ui/preparer/GhostImporter.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

export function PreparePage() {
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()

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

  const ghostMeta = loaded.settings.ghostMeta
  const hasGhost = Boolean(loaded.ghostTrackId && ghostMeta)

  return (
    <PreparerShell title={loaded.title} current="prepare" projectId={loaded.id}>
      <h2 className="font-display text-xl font-semibold tracking-tight">{loaded.title}</h2>
      <p className="mt-3 max-w-xl text-ink/70">The ghost is the lead everyone locks to.</p>
      {hasGhost && ghostMeta ? (
        <section className="mt-8 max-w-xl" aria-label="Ghost track">
          <h3 className="font-medium">Ghost track</h3>
          <p className="mt-2">{ghostMeta.filename}</p>
          <p className="mt-1 text-ink-muted">{formatDuration(ghostMeta.durationMs)}</p>
          <GhostImporter label="Replace ghost track" onImported={handleImported} />
        </section>
      ) : (
        <GhostImporter onImported={handleImported} />
      )}
    </PreparerShell>
  )
}
