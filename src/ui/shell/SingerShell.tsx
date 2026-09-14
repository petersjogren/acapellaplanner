import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type SingerShellProps = {
  children: ReactNode
  songTitle?: string
  partLabel?: string
  projectId?: string
}

export function SingerShell({
  children,
  songTitle = 'Untitled song',
  partLabel,
  projectId,
}: SingerShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-paper font-ui text-ink fade-in">
      <header className="flex items-baseline justify-between gap-6 px-8 py-5">
        {projectId ? (
          <Link
            to={`/project/${projectId}/prepare`}
            className="font-display text-2xl font-semibold tracking-tight studio-transition hover:text-record-red"
          >
            {songTitle}
          </Link>
        ) : (
          <h1 className="font-display text-2xl font-semibold tracking-tight">{songTitle}</h1>
        )}
        <div className="flex items-baseline gap-6">
          {partLabel ? (
            <p className="text-sm tracking-wide text-ink/70">
              You are singing:{' '}
              <span className="font-medium text-ink">{partLabel}</span>
            </p>
          ) : null}
          <Link
            to="/workflow"
            className="text-sm text-ink-muted underline-offset-4 hover:underline"
          >
            Why this workflow
          </Link>
          <Link
            to="/calibrate"
            className="text-sm text-ink-muted underline-offset-4 hover:underline"
          >
            Line up headphones
          </Link>
          <Link
            to="/"
            className="text-sm text-ink-muted underline-offset-4 hover:underline"
          >
            Home
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col px-8 pb-12">{children}</main>
    </div>
  )
}
