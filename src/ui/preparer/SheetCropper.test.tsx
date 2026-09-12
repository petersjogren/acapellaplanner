import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Phrase } from '../../domain/schemas.ts'
import { SheetCropper } from './SheetCropper.tsx'

afterEach(() => {
  cleanup()
})

const PAGE = 'data:image/png;base64,aaaa'

const phraseOne: Phrase = {
  id: 'p1',
  name: 'Phrase 1',
  startMs: 0,
  endMs: 1000,
  sheetRefs: [],
  partPlan: [],
  loopDefault: { mode: 'phrase-loop', gapMs: 400 },
  postRollMs: 0,
}

function mockPageRect(width = 200, height = 100) {
  const page = screen.getByLabelText('Sheet page')
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON() {
      return {}
    },
  })
  return page
}

describe('SheetCropper', () => {
  it('binds a dragged crop onto the selected phrase', async () => {
    const onBind = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={2}
        phrases={[phraseOne]}
        onPageChange={() => undefined}
        onBind={onBind}
      />,
    )

    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    const page = mockPageRect()
    fireEvent.pointerDown(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 120, clientY: 60, pointerId: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Bind crop' }))

    await waitFor(() => {
      expect(onBind).toHaveBeenCalledTimes(1)
    })
    expect(onBind).toHaveBeenCalledWith('p1', { x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })

  it('binds a reverse drag as a normalized region', async () => {
    const onBind = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        phrases={[phraseOne]}
        onPageChange={() => undefined}
        onBind={onBind}
      />,
    )

    const page = mockPageRect()
    fireEvent.pointerDown(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Bind crop' }))

    await waitFor(() => {
      expect(onBind).toHaveBeenCalledWith('p1', { x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    })
  })

  it('disables previous on the first page and next on the last', () => {
    const onPageChange = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        phrases={[phraseOne]}
        onPageChange={onPageChange}
        onBind={() => undefined}
      />,
    )

    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
