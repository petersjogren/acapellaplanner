import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { createEmptyProject, type Project } from '../domain/schemas.ts'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function HomePage() {
  const repo = useProjectRepository()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

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
      <button
        type="button"
        className="mt-8 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
        onClick={() => void handleNewSong()}
        disabled={creating}
      >
        New song
      </button>
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
            <li key={project.id}>
              <Link
                to={`/project/${project.id}/prepare`}
                className="flex items-baseline justify-between gap-4 rounded-md px-3 py-2 studio-transition hover:bg-ink/5"
              >
                <span className="font-medium">{project.title}</span>
                <time className="text-sm text-ink-muted" dateTime={project.updatedAt}>
                  {new Date(project.updatedAt).toLocaleString()}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
