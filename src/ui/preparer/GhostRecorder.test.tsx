import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeAudioFile } from '../../audio/decode.ts'
import {
  EMPTY_TAKE_MAX_BYTES,
  EMPTY_TAKE_MIN_DURATION_MS,
  isProcessedCapture,
  micProcessingFlags,
  requestMicStream,
  startRecording,
  type RecordingResult,
} from '../../audio/record.ts'
import { GhostRecorder } from './GhostRecorder.tsx'

vi.mock('../../audio/record.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../audio/record.ts')>()
  return {
    ...actual,
    requestMicStream: vi.fn(),
    startRecording: vi.fn(),
    isProcessedCapture: vi.fn(() => false),
    micProcessingFlags: vi.fn(() => null),
  }
})

vi.mock('../../audio/decode.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../audio/decode.ts')>()
  return {
    ...actual,
    decodeAudioFile: vi.fn(),
  }
})

const decoded = {
  buffer: { duration: 2.5, sampleRate: 44100 } as AudioBuffer,
  durationMs: 2500,
  sampleRate: 44100,
}

function fakeTrack() {
  return { stop: vi.fn() }
}

function fakeStream(tracks = [fakeTrack()]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  } as unknown as MediaStream
}

function wellAboveEmptyResult(overrides: Partial<RecordingResult> = {}): RecordingResult {
  return {
    blob: new Blob([new Uint8Array(4096)], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    durationMs: EMPTY_TAKE_MIN_DURATION_MS + 5000,
    byteSize: EMPTY_TAKE_MAX_BYTES + 4096,
    ...overrides,
  }
}

function emptyTakeResult(): RecordingResult {
  return {
    blob: new Blob([], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    durationMs: EMPTY_TAKE_MIN_DURATION_MS - 1,
    byteSize: EMPTY_TAKE_MAX_BYTES - 1,
  }
}

function fakeRecorder(result: RecordingResult) {
  return { stop: vi.fn(() => Promise.resolve(result)) }
}

async function checkMic() {
  fireEvent.click(screen.getByRole('button', { name: 'Check mic' }))
  await waitFor(() => {
    expect(screen.getByRole('meter')).toBeDefined()
  })
}

describe('GhostRecorder', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.mocked(requestMicStream).mockReset()
    vi.mocked(startRecording).mockReset()
    vi.mocked(isProcessedCapture).mockReset()
    vi.mocked(isProcessedCapture).mockReturnValue(false)
    vi.mocked(micProcessingFlags).mockReset()
    vi.mocked(micProcessingFlags).mockReturnValue(null)
    vi.mocked(decodeAudioFile).mockReset()
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded)
    vi.mocked(requestMicStream).mockResolvedValue(fakeStream())
  })

  it('shows Check mic and does not request the mic yet', () => {
    render(<GhostRecorder onImported={() => undefined} />)

    expect(screen.getByRole('button', { name: 'Check mic' })).toBeDefined()
    expect(requestMicStream).not.toHaveBeenCalled()
  })

  it('requests the mic and shows the level meter on Check mic', async () => {
    render(<GhostRecorder onImported={() => undefined} />)

    await checkMic()

    expect(requestMicStream).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('meter')).toBeDefined()
  })

  it('shows an error and keeps Check mic available when permission is denied', async () => {
    vi.mocked(requestMicStream).mockRejectedValue(new Error('Permission denied'))
    render(<GhostRecorder onImported={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Check mic' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Permission denied')
    })
    expect(screen.getByRole('button', { name: 'Check mic' })).toBeDefined()
  })

  it('records and stops into a confirm step offering Use this / Discard', async () => {
    const result = wellAboveEmptyResult()
    vi.mocked(startRecording).mockReturnValue(fakeRecorder(result))
    render(<GhostRecorder onImported={() => undefined} />)
    await checkMic()

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(startRecording).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Use this' })).toBeDefined()
    })
    expect(screen.getByRole('button', { name: 'Discard & record again' })).toBeDefined()
  })

  it('calls decodeAudioFile and onImported with a timestamped filename on Use this', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'))
    const result = wellAboveEmptyResult()
    vi.mocked(startRecording).mockReturnValue(fakeRecorder(result))
    const onImported = vi.fn()
    render(<GhostRecorder onImported={onImported} />)
    await checkMic()
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Use this' })).toBeDefined()
    })
    const firstFilename = (() => {
      fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
      return undefined
    })()
    void firstFilename

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1)
    })
    expect(decodeAudioFile).toHaveBeenCalledWith(result.blob)
    const firstCall = onImported.mock.calls[0]?.[0]
    expect(firstCall).toEqual({
      blob: result.blob,
      meta: {
        filename: expect.stringMatching(/\d/) as unknown as string,
        durationMs: decoded.durationMs,
        sampleRate: decoded.sampleRate,
      },
    })
    expect(firstCall.meta.filename).not.toBe('ghost')
    expect(firstCall.meta.filename).not.toBe('')

    vi.setSystemTime(new Date('2026-06-15T18:30:00.000Z'))
    vi.mocked(startRecording).mockReturnValue(fakeRecorder(wellAboveEmptyResult()))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Use this' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(2)
    })
    const secondCall = onImported.mock.calls[1]?.[0]
    expect(secondCall.meta.filename).not.toBe(firstCall.meta.filename)
    vi.useRealTimers()
  })

  it('discards and goes back to armed without re-requesting the mic', async () => {
    const result = wellAboveEmptyResult()
    vi.mocked(startRecording).mockReturnValue(fakeRecorder(result))
    render(<GhostRecorder onImported={() => undefined} />)
    await checkMic()
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Discard & record again' })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Discard & record again' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Record' })).toBeDefined()
    })
    expect(requestMicStream).toHaveBeenCalledTimes(1)
  })

  it('shows an empty-take error and only Record again when below the thresholds', async () => {
    const onImported = vi.fn()
    vi.mocked(startRecording).mockReturnValue(fakeRecorder(emptyTakeResult()))
    render(<GhostRecorder onImported={onImported} />)
    await checkMic()
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Record again' })).toBeDefined()
    expect(onImported).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Record again' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Record' })).toBeDefined()
    })
    expect(requestMicStream).toHaveBeenCalledTimes(1)
  })

  it('shows the reused processed-capture warning copy', async () => {
    vi.mocked(isProcessedCapture).mockReturnValue(true)
    render(<GhostRecorder onImported={() => undefined} />)

    await checkMic()

    expect(
      screen.getByText(/This device insists on echo cancellation or noise suppression/),
    ).toBeDefined()
  })

  it('stops mic tracks on unmount', async () => {
    const track = fakeTrack()
    vi.mocked(requestMicStream).mockResolvedValue(fakeStream([track]))
    const { unmount } = render(<GhostRecorder onImported={() => undefined} />)
    await checkMic()

    unmount()

    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
