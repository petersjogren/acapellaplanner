import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type SingerShellProps = {
  children: ReactNode
  songTitle?: string
  partLabel?: string
  projectId?: string
  current?: 'sing' | 'play'
}

export function SingerShell({
  children,
  songTitle = 'Untitled song',
  partLabel,
  projectId,
  current,
}: SingerShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper font-ui text-ink fade-in pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="flex flex-col gap-3 py-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:py-5 md:flex-row md:items-baseline md:justify-between md:gap-6 md:pl-[max(2rem,env(safe-area-inset-left))] md:pr-[max(2rem,env(safe-area-inset-right))]">
        {projectId ? (
          <Link
            to={`/project/${projectId}/prepare`}
            className="font-display text-xl font-semibold tracking-tight studio-transition hover:text-record-red sm:text-2xl"
          >
            {songTitle}
          </Link>
        ) : (
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{songTitle}</h1>
        )}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 sm:gap-6">
          {partLabel ? (
            <p className="text-sm tracking-wide text-ink/70">
              You are singing:{' '}
              <span className="font-medium text-ink">{partLabel}</span>
            </p>
          ) : null}
          {projectId ? (
            <>
              <Link
                to={`/project/${projectId}/sing`}
                aria-current={current === 'sing' ? 'page' : undefined}
                className="text-sm text-ink-muted underline-offset-4 hover:underline"
              >
                Sing
              </Link>
              <Link
                to={`/project/${projectId}/play`}
                aria-current={current === 'play' ? 'page' : undefined}
                className="text-sm text-ink-muted underline-offset-4 hover:underline"
              >
                Play
              </Link>
            </>
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
      <main className="flex flex-1 flex-col pb-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pb-8 md:pb-12 md:pl-[max(2rem,env(safe-area-inset-left))] md:pr-[max(2rem,env(safe-area-inset-right))]">{children}</main>
    </div>
  )
}
