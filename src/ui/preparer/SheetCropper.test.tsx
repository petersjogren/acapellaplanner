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
  it('adds a dragged crop to the score film', async () => {
    const onAddCrop = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={2}
        crops={[]}
        onPageChange={() => undefined}
        onAddCrop={onAddCrop}
      />,
    )

    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    const page = mockPageRect()
    fireEvent.pointerDown(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 120, clientY: 60, pointerId: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Add crop' }))

    await waitFor(() => {
      expect(onAddCrop).toHaveBeenCalledTimes(1)
    })
    expect(onAddCrop).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })

  it('adds a reverse drag as a normalized region', async () => {
    const onAddCrop = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={() => undefined}
        onAddCrop={onAddCrop}
      />,
    )

    const page = mockPageRect()
    fireEvent.pointerDown(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Add crop' }))

    await waitFor(() => {
      expect(onAddCrop).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
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
        onAddCrop={() => undefined}
      />,
    )

    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not require phrases to add a crop', () => {
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        hasPhrases={false}
        onPageChange={() => undefined}
        onAddCrop={() => undefined}
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
        onAddCrop={() => undefined}
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

  it('shows suggestion boxes and adds them only when asked', () => {
    const onAddAll = vi.fn()
    const onDismiss = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={() => undefined}
        onAddCrop={() => undefined}
        onFindSystems={() => undefined}
        suggestions={[
          { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
          { x: 0.1, y: 0.5, w: 0.8, h: 0.2 },
        ]}
        suggestionTotal={2}
        onAddAll={onAddAll}
        onDismissSuggestions={onDismiss}
      />,
    )
    expect(document.querySelectorAll('[data-system-rect]')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Replace film and clear pins' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add all 2' }))
    expect(onAddAll).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('resizes a suggestion from its top edge', () => {
    const onResizeSuggestion = vi.fn()
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[]}
        onPageChange={() => undefined}
        onAddCrop={() => undefined}
        suggestions={[{ x: 0.1, y: 0.1, w: 0.8, h: 0.2 }]}
        suggestionTotal={1}
        onResizeSuggestion={onResizeSuggestion}
      />,
    )
    mockPageRect(200, 100)
    const handle = screen.getByRole('button', { name: 'Resize system 1 top' })
    fireEvent.pointerDown(handle, { clientX: 40, clientY: 10, pointerId: 2 })
    fireEvent.pointerMove(handle, { clientX: 40, clientY: 20, pointerId: 2 })
    fireEvent.pointerUp(handle, { clientX: 40, clientY: 20, pointerId: 2 })
    expect(onResizeSuggestion).toHaveBeenCalled()
    const region = onResizeSuggestion.mock.calls.at(-1)?.[1] as { y: number; h: number }
    expect(region.y).toBeCloseTo(0.2)
    expect(region.h).toBeCloseTo(0.1)
  })

  it('offers replace only when the film already has crops', () => {
    render(
      <SheetCropper
        pageImageUrl={PAGE}
        pageIndex={0}
        pageCount={1}
        crops={[{ id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 0.2 } }]}
        onPageChange={() => undefined}
        onAddCrop={() => undefined}
        onFindSystems={() => undefined}
        suggestions={[{ x: 0, y: 0, w: 1, h: 0.2 }]}
        suggestionTotal={1}
        onReplaceFilm={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Replace film and clear pins' })).toBeTruthy()
  })
})
