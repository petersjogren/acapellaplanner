import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Phrase } from '../../domain/schemas.ts'
import { SheetCue } from './SheetCue.tsx'

afterEach(() => {
  cleanup()
})

const PAGE = 'data:image/png;base64,aaaa'

function phrase(overrides: Partial<Phrase> = {}): Phrase {
  return {
    id: 'p1',
    name: 'when I fall',
    startMs: 0,
    endMs: 1000,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

describe('SheetCue', () => {
  it('renders nothing without sheetRefs', () => {
    const { container } = render(<SheetCue phrase={phrase()} pageImageUrl={PAGE} />)
    expect(container.querySelector('img, canvas')).toBeNull()
    expect(screen.queryByLabelText('Sheet crop')).toBeNull()
  })

  it('renders nothing without a page image even when a crop exists', () => {
    const { container } = render(
      <SheetCue
        phrase={phrase({
          sheetRefs: [{ id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 1 } }],
        })}
      />,
    )
    expect(container.querySelector('img, canvas')).toBeNull()
  })

  it('shows an img clipped to the crop', () => {
    render(
      <SheetCue
        phrase={phrase({
          sheetRefs: [
            {
              id: 'ref-1',
              sheetDocId: 'doc-1',
              pageIndex: 0,
              regionNorm: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
            },
          ],
        })}
        pageImageUrl={PAGE}
      />,
    )

    const figure = screen.getByLabelText('Sheet crop')
    const img = figure.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe(PAGE)
  })
})
