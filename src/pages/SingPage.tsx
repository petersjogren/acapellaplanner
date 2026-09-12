import { SingerShell } from '../ui/shell/SingerShell.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

export function SingPage() {
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
    <SingerShell songTitle={project.title}>
      <p className="font-display text-lyric leading-snug">The booth is quiet.</p>
      <p className="mt-3 max-w-md text-ink/70">Headphones carry the ghost. Sing the line when it comes.</p>
    </SingerShell>
  )
}
