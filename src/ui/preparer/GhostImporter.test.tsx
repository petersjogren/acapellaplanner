import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeAudioFile } from '../../audio/decode.ts'
import { GhostImporter } from './GhostImporter.tsx'

vi.mock('../../audio/decode.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../audio/decode.ts')>()
  return {
    ...actual,
    decodeAudioFile: vi.fn(),
  }
})

const decoded = {
  buffer: { duration: 83.4, sampleRate: 44100 } as AudioBuffer,
  durationMs: 83400,
  sampleRate: 44100,
}

function pickFile(name = 'lead.wav') {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/wav' })
  fireEvent.change(screen.getByLabelText('Import ghost track'), { target: { files: [file] } })
  return file
}

describe('GhostImporter', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.mocked(decodeAudioFile).mockReset()
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded)
  })

  it('uses a disabled-capable audio file picker labeled Import ghost track', () => {
    render(<GhostImporter onImported={() => undefined} />)

    const input = screen.getByLabelText('Import ghost track') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.type).toBe('file')
    expect(input.accept).toBe('audio/*')
    expect(input.disabled).toBe(false)
    expect(screen.queryByText('Upload file')).toBeNull()
  })

  it('disables the picker while decoding', async () => {
    let finish: (value: typeof decoded) => void = () => undefined
    vi.mocked(decodeAudioFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )

    render(<GhostImporter onImported={() => undefined} />)
    pickFile()

    await waitFor(() => {
      expect((screen.getByLabelText('Import ghost track') as HTMLInputElement).disabled).toBe(true)
    })

    finish(decoded)

    await waitFor(() => {
      expect((screen.getByLabelText('Import ghost track') as HTMLInputElement).disabled).toBe(false)
    })
  })

  it('calls onImported with the blob and decode metadata', async () => {
    const onImported = vi.fn()
    render(<GhostImporter onImported={onImported} />)
    const file = pickFile('ghost-lead.wav')

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1)
    })
    expect(onImported.mock.calls[0]?.[0]).toEqual({
      blob: file,
      meta: {
        filename: 'ghost-lead.wav',
        durationMs: 83400,
        sampleRate: 44100,
      },
    })
  })

  it('shows an alert when decoding fails', async () => {
    vi.mocked(decodeAudioFile).mockRejectedValue(new Error('Could not decode audio file'))
    render(<GhostImporter onImported={() => undefined} />)
    pickFile()

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not decode audio file')
    })
    expect((screen.getByLabelText('Import ghost track') as HTMLInputElement).disabled).toBe(false)
  })

  it('does nothing when the picker has no file', () => {
    const onImported = vi.fn()
    render(<GhostImporter onImported={onImported} />)
    fireEvent.change(screen.getByLabelText('Import ghost track'), { target: { files: [] } })
    expect(decodeAudioFile).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
  })
})
