import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BoothLayout } from './BoothLayout.tsx'

/** Peak armed-lamp glow: `0 0 18px 4px` (blur + spread). Not the layout constant. */
const PEAK_LAMP_GLOW_PX = 22

/** Smallest px length declared in an inline padding value. Empty style is NaN. */
function inlineInsetPx(value: string): number {
  const amounts = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]))
  if (amounts.length === 0) return Number.NaN
  return Math.min(...amounts)
}

afterEach(() => {
  cleanup()
})

describe('BoothLayout', () => {
  it('keeps the dock after the film stage', () => {
    render(
      <BoothLayout dock={<button type="button">Record</button>}>
        <p>Or I'll never fall in love</p>
      </BoothLayout>,
    )

    const lyric = screen.getByText(/never fall in love/)
    const record = screen.getByRole('button', { name: 'Record' })
    expect(lyric.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the armed record lamp inset from the booth clip by the glow extent', () => {
    const { container } = render(
      <BoothLayout
        dock={
          <button type="button" aria-label="Record" aria-pressed="true">
            Record
          </button>
        }
      >
        <p>Or I'll never fall in love</p>
      </BoothLayout>,
    )

    const clip = container.querySelector('[data-booth-clip]')
    const dock = container.querySelector('[data-booth-dock]')
    const record = screen.getByRole('button', { name: 'Record' })
    expect(clip).toBeTruthy()
    expect(dock).toBeTruthy()
    expect(clip).toBeInstanceOf(HTMLElement)
    expect(dock).toBeInstanceOf(HTMLElement)
    expect((clip as HTMLElement).classList.contains('overflow-hidden')).toBe(true)
    expect(clip!.contains(dock!)).toBe(true)
    expect(dock!.contains(record)).toBe(true)
    // Inline padding is the inset the clip actually reserves. Tailwind classes do not land on .style.
    const padded = dock as HTMLElement
    expect(inlineInsetPx(padded.style.paddingLeft)).toBeGreaterThanOrEqual(PEAK_LAMP_GLOW_PX)
    expect(inlineInsetPx(padded.style.paddingTop)).toBeGreaterThanOrEqual(PEAK_LAMP_GLOW_PX)
    expect(inlineInsetPx(padded.style.paddingRight)).toBeGreaterThanOrEqual(PEAK_LAMP_GLOW_PX)
    expect(inlineInsetPx(padded.style.paddingBottom)).toBeGreaterThanOrEqual(PEAK_LAMP_GLOW_PX)
  })
})
