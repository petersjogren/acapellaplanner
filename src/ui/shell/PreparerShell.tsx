import { clsx } from 'clsx'
import type { ReactNode } from 'react'

const NAV = [
  { id: 'prepare', href: '/prepare', label: 'Prepare', hint: 'Score desk' },
  { id: 'sing', href: '/sing', label: 'Sing', hint: 'Booth' },
  { id: 'review', href: '/review', label: 'Review', hint: 'Keepers' },
] as const

export type PreparerNavId = (typeof NAV)[number]['id']

export type PreparerShellProps = {
  children: ReactNode
  title?: string
  current?: PreparerNavId
}

export function PreparerShell({
  children,
  title = 'Acapella Planner',
  current = 'prepare',
}: PreparerShellProps) {
  return (
    <div className="flex min-h-screen bg-paper font-ui text-ink fade-in">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink/10 px-5 py-8">
        <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">Studio desk</p>
        <nav aria-label="Studio" className="mt-10 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = current === item.id
            return (
              <a
                key={item.id}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'rounded-md px-3 py-2 studio-transition',
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
                <span className={clsx('block text-xs', active ? 'text-paper/80' : 'text-ink-muted')}>
                  {item.hint}
                </span>
              </a>
            )
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-8">{children}</main>
    </div>
  )
}
