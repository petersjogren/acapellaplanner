import type { Project } from './schemas.ts'

export function renameProject(project: Project, title: string): Project {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Song name is required')
  return { ...project, title: trimmed }
}
