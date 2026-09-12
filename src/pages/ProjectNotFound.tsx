import { Link } from 'react-router-dom'

export function ProjectNotFound() {
  return (
    <div className="min-h-screen bg-paper px-10 py-8 font-ui text-ink fade-in">
      <h1 className="font-display text-xl font-semibold tracking-tight">Project not found</h1>
      <Link
        to="/"
        className="mt-6 inline-block text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        Home
      </Link>
    </div>
  )
}
