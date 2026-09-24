import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SheetRef } from '../../domain/schemas.ts'
import { SheetCropper } from './SheetCropper.tsx'

afterEach(() => {
  cleanup()
})

const PAGE = 'data:image/png;base64,aaaa'

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
  it('adds a dragged rect to this page', async () => {
    const onAddRect = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={2}
        crops={[]}
        onPageChange={() => undefined}
        onAddRect={onAddRect}
      />,
    )

    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    const page = mockPageRect()
    fireEvent.pointerDown(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 120, clientY: 60, pointerId: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Add rect' }))

    await waitFor(() => {
      expect(onAddRect).toHaveBeenCalledTimes(1)
    })
    expect(onAddRect).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })

  it('clears the drag preview once the rect is added', async () => {
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
      />,
    )

    const page = mockPageRect()
    fireEvent.pointerDown(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 120, clientY: 60, pointerId: 1 })
    expect(document.querySelector('[data-crop-rect]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add rect' }))

    await waitFor(() => {
      expect(document.querySelector('[data-crop-rect]')).toBeNull()
    })
    expect((screen.getByRole('button', { name: 'Add rect' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('adds a reverse drag as a normalized region', async () => {
    const onAddRect = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={() => undefined}
        onAddRect={onAddRect}
      />,
    )

    const page = mockPageRect()
    fireEvent.pointerDown(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Add rect' }))

    await waitFor(() => {
      expect(onAddRect).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    })
  })

  it('disables previous on the first page and next on the last', () => {
    const onPageChange = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={onPageChange}
        onAddRect={() => undefined}
      />,
    )

    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not require phrases to add a rect', () => {
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        hasPhrases={false}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
      />,
    )
    expect(screen.getByText(/Mark phrases on the ghost so Play can scroll/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bind crop' })).toBeNull()
  })

  it('shows the score film and can remove a crop', async () => {
    const onRemoveCrop = vi.fn()
    const crops: SheetRef[] = [
      { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
    ]
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={crops}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        onRemoveCrop={onRemoveCrop}
      />,
    )

    const list = screen.getByLabelText('Score film')
    expect(list.textContent).toContain('Crop 1')
    expect(list.textContent).toContain('Crop 2')
    fireEvent.click(screen.getByRole('button', { name: 'Remove crop 1' }))
    await waitFor(() => {
      expect(onRemoveCrop).toHaveBeenCalledWith('ref-1')
    })
  })

  it('shows staged rects and commits them only when asked', () => {
    const onAddAll = vi.fn()
    const onDismiss = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        onFindSystems={() => undefined}
        pageRects={[
          { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
          { x: 0.1, y: 0.5, w: 0.8, h: 0.2 },
        ]}
        rectTotal={2}
        onAddAll={onAddAll}
        onDismissRects={onDismiss}
      />,
    )
    expect(document.querySelectorAll('[data-page-rect]')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Replace film and clear pins' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add all 2' }))
    expect(onAddAll).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('resizes a rect from its top edge', () => {
    const onResizeRect = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        pageRects={[{ x: 0.1, y: 0.1, w: 0.8, h: 0.2 }]}
        rectTotal={1}
        onResizeRect={onResizeRect}
      />,
    )
    mockPageRect(200, 100)
    const handle = screen.getByRole('button', { name: 'Resize rect 1 top' })
    fireEvent.pointerDown(handle, { clientX: 40, clientY: 10, pointerId: 2 })
    fireEvent.pointerMove(handle, { clientX: 40, clientY: 20, pointerId: 2 })
    fireEvent.pointerUp(handle, { clientX: 40, clientY: 20, pointerId: 2 })
    expect(onResizeRect).toHaveBeenCalled()
    const region = onResizeRect.mock.calls.at(-1)?.[1] as { y: number; h: number }
    expect(region.y).toBeCloseTo(0.2)
    expect(region.h).toBeCloseTo(0.1)
  })

  it('clears only the current page rects', () => {
    const onClearPageRects = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={1}
        pageCount={3}
        crops={[]}
        pageRects={[{ x: 0.1, y: 0.1, w: 0.8, h: 0.1 }]}
        rectTotal={4}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        onClearPageRects={onClearPageRects}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear page rects' }))
    expect(onClearPageRects).toHaveBeenCalledWith(1)
  })

  it('disables clear when this page has no rects', () => {
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        pageRects={[]}
        rectTotal={0}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        onClearPageRects={() => undefined}
      />,
    )
    expect(
      (screen.getByRole('button', { name: 'Clear page rects' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('numbers rects and removes one by index without starting a drag', () => {
    const onRemoveRect = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        pageRects={[
          { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
          { x: 0.1, y: 0.4, w: 0.8, h: 0.1 },
          { x: 0.1, y: 0.7, w: 0.8, h: 0.1 },
        ]}
        rectTotal={3}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        onRemoveRect={onRemoveRect}
      />,
    )
    const rects = document.querySelectorAll('[data-page-rect]')
    expect(rects).toHaveLength(3)
    expect(
      [...document.querySelectorAll('[data-rect-number]')].map((node) => node.textContent),
    ).toEqual(['1', '2', '3'])

    const remove = screen.getByRole('button', { name: 'Remove rect 2' })
    fireEvent.pointerDown(remove, { clientX: 40, clientY: 40, pointerId: 3 })
    fireEvent.click(remove)
    expect(onRemoveRect).toHaveBeenCalledWith(1)
    // The ✕ swallowed the pointer: no marquee started, so nothing is addable.
    expect(document.querySelector('[data-crop-rect]')).toBeNull()
    expect((screen.getByRole('button', { name: 'Add rect' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('numbers by film position, not per-page index', () => {
    const onRemoveRect = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={1}
        pageCount={2}
        crops={[]}
        pageRects={[
          { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
          { x: 0.1, y: 0.5, w: 0.8, h: 0.1 },
        ]}
        rectTotal={5}
        rectNumberOffset={3}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        onRemoveRect={onRemoveRect}
      />,
    )
    expect(
      [...document.querySelectorAll('[data-rect-number]')].map((node) => node.textContent),
    ).toEqual(['4', '5'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove rect 5' }))
    expect(onRemoveRect).toHaveBeenCalledWith(1)
  })

  it('shows a manual rect drawn after a resize as the last number on the page', () => {
    // The whole-page crop was resized onto the middle system, then the system
    // above was drawn by hand — it appends, so it badges 2, not 1.
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        pageRects={[
          { x: 0.05, y: 0.4, w: 0.9, h: 0.15 },
          { x: 0.05, y: 0.1, w: 0.9, h: 0.15 },
        ]}
        rectTotal={2}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
      />,
    )
    const numbers = [...document.querySelectorAll('[data-rect-number]')]
    expect(numbers.map((node) => node.textContent)).toEqual(['1', '2'])
    // Number 2 sits ABOVE number 1 on the page: the preparer can see the film
    // will scroll out of reading order and clear the page.
    expect(numbers[0]!.closest('[data-page-rect]')).toHaveProperty('style.top', '40%')
    expect(numbers[1]!.closest('[data-page-rect]')).toHaveProperty('style.top', '10%')
  })

  it('offers replace only when the film already has crops', () => {
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[{ id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 0.2 } }]}
        onPageChange={() => undefined}
        onAddRect={() => undefined}
        onFindSystems={() => undefined}
        pageRects={[{ x: 0, y: 0, w: 1, h: 0.2 }]}
        rectTotal={1}
        onReplaceFilm={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Replace film and clear pins' })).toBeTruthy()
  })
})
