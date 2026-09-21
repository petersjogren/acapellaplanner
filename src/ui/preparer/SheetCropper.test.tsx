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
})
