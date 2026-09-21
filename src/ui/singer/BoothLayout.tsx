import type { ReactNode } from 'react'

export type BoothLayoutProps = {
  children: ReactNode
  dock: ReactNode
}

/** Viewport-locked booth: film fills leftover height; dock stays on screen. */
export function BoothLayout({ children, dock }: BoothLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <div className="shrink-0 border-t border-ink/10 bg-paper pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {dock}
      </div>
    </div>
  )
}
