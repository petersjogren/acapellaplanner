import { useEffect, useId, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { createEmptyProject, type Project } from '../domain/schemas.ts'
import {
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
      const { project, blobs } = await importProjectZip(file)
      for (const item of blobs) {
        await repo.putAudioBlob({
          id: item.id,
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
    <div className="min-h-screen bg-paper px-10 py-8 font-ui text-ink fade-in">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Acapella Planner</h1>
      <p className="mt-1 text-sm text-ink-muted">Songs on the desk</p>
      <Link
        to="/calibrate"
        className="mt-3 inline-block text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        Line up headphones
      </Link>
      <div className="mt-8 flex flex-wrap items-end gap-6">
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
        <ul className="mt-8 flex max-w-xl flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id} className="flex items-center gap-2">
              <Link
                to={`/project/${project.id}/prepare`}
                className="flex min-w-0 flex-1 items-baseline justify-between gap-4 rounded-md px-3 py-2 studio-transition hover:bg-ink/5"
              >
                <span className="font-medium">{project.title}</span>
                <time className="text-sm text-ink-muted" dateTime={project.updatedAt}>
                  {new Date(project.updatedAt).toLocaleString()}
                </time>
              </Link>
              <button
                type="button"
                className="shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium studio-transition hover:bg-ink/5"
                aria-label={`Export ${project.title}`}
                onClick={() => void handleExport(project)}
              >
                Export
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
