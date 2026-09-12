import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import type { Project } from '../domain/schemas.ts'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useLoadedProject(): {
  project: Project | null | undefined
  error: string | null
} {
  const { id } = useParams()
  const repo = useProjectRepository()
  const [project, setProject] = useState<Project | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!id) {
      setProject(null)
      setError(null)
      return
    }
    setProject(undefined)
    setError(null)
    void repo
      .getProject(id)
      .then((loaded) => {
        if (!cancelled) setProject(loaded ?? null)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setProject(null)
          setError(messageFrom(err, 'Could not load project'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, repo])

  return { project, error }
}
