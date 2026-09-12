import type { Project, Take } from './schemas.ts'

export function findTake(project: Project, takeId: string): Take | undefined {
  return project.takes.find((item) => item.id === takeId)
}

/** Remove a take from the project. Returns the audio blob id to delete, if any. */
export function removeTake(
  project: Project,
  takeId: string,
): { project: Project; audioBlobId: string | null } {
  const take = findTake(project, takeId)
  if (!take) {
    return { project, audioBlobId: null }
  }
  return {
    project: {
      ...project,
      takes: project.takes.filter((item) => item.id !== takeId),
    },
    audioBlobId: take.audioBlobId,
  }
}

export function rateTake(project: Project, takeId: string, rating: Take['rating']): Project {
  return {
    ...project,
    takes: project.takes.map((item) => (item.id === takeId ? { ...item, rating } : item)),
  }
}
