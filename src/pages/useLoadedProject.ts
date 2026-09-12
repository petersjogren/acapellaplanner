import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import type { Project } from '../domain/schemas.ts'

export function useLoadedProject(): {
  project: Project | null | undefined
} {
  const { id } = useParams()
  const repo = useProjectRepository()
  const [project, setProject] = useState<Project | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    if (!id) {
      setProject(null)
      return
    }
    setProject(undefined)
    void repo.getProject(id).then((loaded) => {
      if (!cancelled) setProject(loaded ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [id, repo])

  return { project }
}
