import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetUploader } from './SheetUploader.tsx'

afterEach(() => {
  cleanup()
})

function pickFile(name = 'lead.pdf') {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' })
  fireEvent.change(screen.getByLabelText('Upload sheet PDF'), { target: { files: [file] } })
  return file
}

describe('SheetUploader', () => {
  it('uses a PDF file picker labeled Upload sheet PDF', () => {
    render(<SheetUploader onUploaded={() => undefined} />)

    const input = screen.getByLabelText('Upload sheet PDF') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.type).toBe('file')
    expect(input.accept).toBe('application/pdf')
    expect(input.disabled).toBe(false)
  })

  it('calls onUploaded with the blob and filename', async () => {
    const onUploaded = vi.fn()
    render(<SheetUploader onUploaded={onUploaded} />)
    const file = pickFile('chart.pdf')

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1)
    })
    expect(onUploaded.mock.calls[0]?.[0]).toEqual({
      blob: file,
      filename: 'chart.pdf',
    })
  })

  it('shows an alert when upload fails', async () => {
    const onUploaded = vi.fn(() => Promise.reject(new Error('Could not open PDF')))
    render(<SheetUploader onUploaded={onUploaded} />)
    pickFile()

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not open PDF')
    })
    expect((screen.getByLabelText('Upload sheet PDF') as HTMLInputElement).disabled).toBe(false)
  })

  it('does nothing when the picker has no file', () => {
    const onUploaded = vi.fn()
    render(<SheetUploader onUploaded={onUploaded} />)
    fireEvent.change(screen.getByLabelText('Upload sheet PDF'), { target: { files: [] } })
    expect(onUploaded).not.toHaveBeenCalled()
  })
})
