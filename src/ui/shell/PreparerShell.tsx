import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const NAV = [
  { id: 'prepare', label: 'Prepare', hint: 'Score desk' },
  { id: 'sing', label: 'Sing', hint: 'Booth' },
  { id: 'play', label: 'Play', hint: 'Follow along' },
  { id: 'review', label: 'Review', hint: 'Keepers' },
] as const

export type PreparerNavId = (typeof NAV)[number]['id']

export type PreparerShellProps = {
  children: ReactNode
  title?: string
  current?: PreparerNavId
  projectId?: string
}

function navHref(id: PreparerNavId, projectId?: string): string {
  return projectId ? `/project/${projectId}/${id}` : `/${id}`
}

export function PreparerShell({
  children,
  title = 'Acapella Planner',
  current = 'prepare',
  projectId,
}: PreparerShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper font-ui text-ink fade-in pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="flex flex-col gap-3 py-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:py-5 md:flex-row md:items-baseline md:justify-between md:gap-6 md:pl-[max(2rem,env(safe-area-inset-left))] md:pr-[max(2rem,env(safe-area-inset-right))]">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          <p className="text-sm text-ink-muted">Studio desk</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 sm:gap-6">
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
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-ink/10 py-4 pl-[max(1rem,env(safe-area-inset-left))] pr-4 sm:pl-[max(1.25rem,env(safe-area-inset-left))] md:w-56 md:border-r md:border-b-0 md:py-8">
          <nav
            aria-label="Studio"
            className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible"
          >
            {NAV.map((item) => {
              const active = current === item.id
              return (
                <Link
                  key={item.id}
                  to={navHref(item.id, projectId)}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'shrink-0 rounded-md px-3 py-2 studio-transition',
                    active ? 'bg-ink text-paper' : 'text-ink/80 hover:bg-ink/5',
                  )}
                >
                  <span className="block font-medium">
                    {item.label}
                    {item.id === 'review' ? (
                      <span
                        className="ml-2 inline-block h-1.5 w-1.5 rounded-pill bg-gold align-middle"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className={clsx('hidden text-xs md:block', active ? 'text-paper/80' : 'text-ink-muted')}>
                    {item.hint}
                  </span>
                </Link>
              )
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 py-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:py-6 md:py-8 md:pl-[max(2.5rem,env(safe-area-inset-left))] md:pr-[max(2.5rem,env(safe-area-inset-right))]">{children}</main>
      </div>
    </div>
  )
}
