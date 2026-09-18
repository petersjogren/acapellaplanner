import { useEffect, useId, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { forkProjectForImport, renameProject, uniqueImportedTitle } from '../domain/project.ts'
import { createEmptyProject, type Project } from '../domain/schemas.ts'
import {
  collectProjectBlobIds,
  downloadBlob,
  exportProjectZip,
  importProjectZip,
  projectZipFilename,
  resolveExportBlob,
} from '../storage/projectIO.ts'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function HomePage() {
  const repo = useProjectRepository()
  const navigate = useNavigate()
  const importId = useId()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void repo
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageFrom(err, 'Could not load songs'))
      })
    return () => {
      cancelled = true
    }
  }, [repo])

  async function handleNewSong() {
    setCreating(true)
    setError(null)
    try {
      const project = await repo.saveProject(createEmptyProject())
      navigate(`/project/${project.id}/prepare`)
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not create song'))
    } finally {
      setCreating(false)
    }
  }

  function startRename(project: Project) {
    setError(null)
    setPendingDeleteId(null)
    setRenamingId(project.id)
    setDraftTitle(project.title)
  }

  function cancelRename() {
    setRenamingId(null)
    setDraftTitle('')
  }

  async function handleRename(project: Project) {
    const title = draftTitle.trim()
    if (!title) {
      setError('Song name is required')
      return
    }
    if (title === project.title) {
      cancelRename()
      return
    }
    setError(null)
    try {
      await repo.saveProject(renameProject(project, title))
      setProjects(await repo.listProjects())
      cancelRename()
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not rename song'))
    }
  }

  async function handleDelete(project: Project) {
    setError(null)
    try {
      await repo.deleteProject(project.id)
      setProjects(await repo.listProjects())
      setPendingDeleteId(null)
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not delete song'))
    }
  }

  async function handleExport(project: Project) {
    setError(null)
    try {
      const zip = await exportProjectZip(project, (id) =>
        resolveExportBlob((blobId) => repo.getAudioBlob(blobId), id),
      )
      downloadBlob(zip, projectZipFilename(project.title))
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not export project'))
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const { project: incoming, blobs } = await importProjectZip(file)
      const existingTitles = (projects ?? []).map((item) => item.title)
      const title = uniqueImportedTitle(incoming.title, existingTitles)
      const { project, blobIdMap } = forkProjectForImport(incoming, { title })
      const allowed = new Set(collectProjectBlobIds(incoming))
      for (const item of blobs) {
        if (!allowed.has(item.id)) continue
        const id = blobIdMap.get(item.id)
        if (!id) continue
        await repo.putAudioBlob({
          id,
          projectId: project.id,
          kind: item.kind,
          mimeType: item.mimeType,
          byteSize: item.blob.size,
          createdAt: new Date().toISOString(),
          blob: item.blob,
        })
      }
      await repo.saveProject(project)
      setProjects(await repo.listProjects())
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not import zip'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="min-h-dvh bg-paper py-6 font-ui text-ink fade-in pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] md:py-8 md:pl-[max(2.5rem,env(safe-area-inset-left))] md:pr-[max(2.5rem,env(safe-area-inset-right))]">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Acapella Planner</h1>
      <p className="mt-1 text-sm text-ink-muted">Songs on the desk</p>
      <Link
        to="/calibrate"
        className="mt-3 inline-block text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        Line up headphones
      </Link>
      <div className="mt-8 flex flex-wrap items-end gap-4 sm:gap-6">
        <button
          type="button"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
          onClick={() => void handleNewSong()}
          disabled={creating}
        >
          New song
        </button>
        <label htmlFor={importId} className="flex flex-col gap-2 text-sm">
          <span className="font-medium">Import zip</span>
          <input
            id={importId}
            type="file"
            accept=".zip,application/zip"
            disabled={importing}
            onChange={(event) => void handleImport(event)}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-4 file:py-2 file:font-medium file:text-paper hover:file:bg-record-red disabled:opacity-50"
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-8 text-record-red">
          {error}
        </p>
      ) : null}
      {projects === null && !error ? (
        <p className="mt-8 text-ink-muted">Loading…</p>
      ) : projects === null || projects.length === 0 ? (
        error ? null : <p className="mt-8 text-ink-muted">No songs yet</p>
      ) : (
        <ul className="mt-8 flex max-w-xl flex-col gap-3 sm:gap-2">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex flex-col gap-3 rounded-md border border-ink/10 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:border-0 sm:p-0"
            >
              {renamingId === project.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleRename(project)
                  }}
                >
                  <input
                    autoFocus
                    type="text"
                    aria-label="Song name"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') cancelRename()
                    }}
                    className="min-w-0 flex-1 rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm font-medium"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium studio-transition hover:bg-ink/5"
                    onClick={cancelRename}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <Link
                    to={`/project/${project.id}/prepare`}
                    className="flex min-w-0 flex-col gap-0.5 rounded-md studio-transition hover:bg-ink/5 sm:flex-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 sm:px-3 sm:py-2"
                  >
                    <span className="font-medium">{project.title}</span>
                    <time className="text-sm text-ink-muted" dateTime={project.updatedAt}>
                      {new Date(project.updatedAt).toLocaleString()}
                    </time>
                  </Link>
                  <div className="flex flex-wrap gap-2 sm:contents">
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium studio-transition hover:bg-ink/5"
                      aria-label={`Rename ${project.title}`}
                      onClick={() => startRename(project)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium studio-transition hover:bg-ink/5"
                      aria-label={`Export ${project.title}`}
                      onClick={() => void handleExport(project)}
                    >
                      Export
                    </button>
                    {pendingDeleteId === project.id ? (
                      <>
                        <button
                          type="button"
                          className="shrink-0 rounded-md bg-record-red px-3 py-1.5 text-sm font-medium text-paper studio-transition"
                          aria-label={`Confirm delete ${project.title}`}
                          onClick={() => void handleDelete(project)}
                        >
                          Delete for good
                        </button>
                        <button
                          type="button"
                          className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium studio-transition hover:bg-ink/5"
                          onClick={() => setPendingDeleteId(null)}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium text-record-red studio-transition hover:bg-record-red/10"
                        aria-label={`Delete ${project.title}`}
                        onClick={() => {
                          setError(null)
                          setRenamingId(null)
                          setPendingDeleteId(project.id)
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
