import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { createEmptyProject, type Project } from '../domain/schemas.ts'

export function HomePage() {
  const repo = useProjectRepository()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    void repo.listProjects().then((list) => {
      if (!cancelled) setProjects(list)
    })
    return () => {
      cancelled = true
    }
  }, [repo])

  async function handleNewSong() {
    setCreating(true)
    try {
      const project = await repo.saveProject(createEmptyProject())
      navigate(`/project/${project.id}/prepare`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper px-10 py-8 font-ui text-ink fade-in">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Acapella Planner</h1>
      <p className="mt-1 text-sm text-ink-muted">Songs on the desk</p>
      <button
        type="button"
        className="mt-8 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red disabled:opacity-50"
        onClick={() => void handleNewSong()}
        disabled={creating}
      >
        New song
      </button>
      {projects === null ? (
        <p className="mt-8 text-ink-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="mt-8 text-ink-muted">No songs yet</p>
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
