import { PreparerShell } from '../ui/shell/PreparerShell.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

export function ReviewPage() {
  const { project, error } = useLoadedProject()

  if (error) {
    return <StorageError message={error} />
  }
  if (project === undefined) {
    return <p className="px-10 py-8 font-ui text-ink-muted">Loading…</p>
  }
  if (project === null) {
    return <ProjectNotFound />
  }

  return (
    <PreparerShell title={project.title} current="review" projectId={project.id}>
      <h2 className="font-display text-xl font-semibold tracking-tight">Keepers</h2>
      <p className="mt-3 max-w-xl text-ink/70">Review takes come next</p>
    </PreparerShell>
  )
}
