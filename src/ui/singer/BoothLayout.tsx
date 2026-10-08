import type { ReactNode } from 'react'

/**
 * Peak `.record-lamp` glow extent (`0 0 18px 4px` → blur + spread ≈ 22px).
 * Dock padding must leave at least this much room inside the booth clip.
 */
export const RECORD_LAMP_GLOW_EXTENT_PX = 22

export type BoothLayoutProps = {
  children: ReactNode
  dock: ReactNode
}

/** Viewport-locked booth: film fills leftover height; dock stays on screen. */
export function BoothLayout({ children, dock }: BoothLayoutProps) {
  const haloInset = `${RECORD_LAMP_GLOW_EXTENT_PX}px`
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-booth-clip>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <div
        className="shrink-0 border-t border-ink/10 bg-paper"
        data-booth-dock
        style={{
          paddingTop: haloInset,
          paddingRight: haloInset,
          paddingBottom: `max(${haloInset}, env(safe-area-inset-bottom))`,
          paddingLeft: haloInset,
        }}
      >
        {dock}
      </div>
    </div>
  )
}
