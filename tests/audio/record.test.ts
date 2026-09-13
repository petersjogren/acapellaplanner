import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isEmptyTake,
  isProcessedCapture,
  micProcessingFlags,
  nextTakeIndex,
  requestMicStream,
  startRecording,
  takeLabel,
} from '../../src/audio/record.ts'
import type { Take } from '../../src/domain/schemas.ts'

function take(overrides: Partial<Take> & { phraseId: string; voicePartId: string }): Take {
  return {
    id: overrides.id ?? 't1',
    takeIndex: 1,
    audioBlobId: 'blob-1',
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: 0,
    ...overrides,
  }
}

describe('nextTakeIndex', () => {
  it('is 1 when there are no matching takes', () => {
    expect(nextTakeIndex([], 'p1', 'v1')).toBe(1)
    expect(
      nextTakeIndex(
        [take({ phraseId: 'p2', voicePartId: 'v1', takeIndex: 4 })],
        'p1',
        'v1',
      ),
    ).toBe(1)
  })

  it('increments from the max takeIndex for the phrase and part', () => {
    expect(
      nextTakeIndex(
        [
          take({ id: 'a', phraseId: 'p1', voicePartId: 'v1', takeIndex: 1 }),
          take({ id: 'b', phraseId: 'p1', voicePartId: 'v1', takeIndex: 3 }),
          take({ id: 'c', phraseId: 'p1', voicePartId: 'v2', takeIndex: 9 }),
        ],
        'p1',
        'v1',
      ),
    ).toBe(4)
  })
})

describe('isEmptyTake', () => {
  it('is true when the blob is under 1KB', () => {
    expect(isEmptyTake({ byteSize: 1023, durationMs: 1000 })).toBe(true)
  })

  it('is true when duration is under 200ms', () => {
    expect(isEmptyTake({ byteSize: 5000, durationMs: 199 })).toBe(true)
  })

  it('is false when both thresholds are met', () => {
    expect(isEmptyTake({ byteSize: 1024, durationMs: 200 })).toBe(false)
  })
})

describe('takeLabel', () => {
  it('formats shortLabel_pN_tN', () => {
    expect(takeLabel('S1', 1, 2)).toBe('S1_p1_t2')
  })
})

describe('startRecording', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts MediaRecorder and resolves blob metadata on stop', async () => {
    const chunks = new Uint8Array(2048)
    class FakeMediaRecorder {
      state = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob([chunks], { type: this.mimeType }) })
        this.onstop?.()
      }
      static isTypeSupported() {
        return true
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    const stream = { getTracks: () => [] } as unknown as MediaStream
    const rec = startRecording(stream)
    const result = await rec.stop()

    expect(result.byteSize).toBe(2048)
    expect(result.mimeType).toBe('audio/webm')
    expect(result.blob.size).toBe(2048)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// Regression: `{ audio: true }` silently opts into Chrome's voice-call DSP.
// Echo cancellation treats the sung take as echo of the ghost and ducks it, so
// a loudly sung phrase comes back near-silent with only the tail audible.
describe('requestMicStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubGum(impl: (c: MediaStreamConstraints) => Promise<MediaStream>) {
    const getUserMedia = vi.fn(impl)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    return getUserMedia
  }

  it('asks for raw capture with all voice processing disabled', async () => {
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream
    const getUserMedia = stubGum(async () => stream)

    await expect(requestMicStream()).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  })

  it('falls back to default capture when the device rejects the constraints', async () => {
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream
    const error = new Error('cannot satisfy')
    error.name = 'OverconstrainedError'
    const getUserMedia = stubGum(async (constraints) => {
      if (constraints.audio !== true) throw error
      return stream
    })

    await expect(requestMicStream()).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true })
  })

  it('propagates a denied permission instead of retrying', async () => {
    const error = new Error('Permission denied')
    error.name = 'NotAllowedError'
    const getUserMedia = stubGum(async () => {
      throw error
    })

    await expect(requestMicStream()).rejects.toThrow(/permission denied/i)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('throws a clear error when the browser has no microphone API', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    await expect(requestMicStream()).rejects.toThrow(/microphone is not available/i)
  })
})

describe('micProcessingFlags', () => {
  function streamWith(settings: MediaTrackSettings | null): MediaStream {
    return {
      getAudioTracks: () => (settings === null ? [] : [{ getSettings: () => settings }]),
    } as unknown as MediaStream
  }

  it('reports the processing the device actually applied', () => {
    expect(
      micProcessingFlags(
        streamWith({ echoCancellation: true, noiseSuppression: false, autoGainControl: true }),
      ),
    ).toEqual({ echoCancellation: true, noiseSuppression: false, autoGainControl: true })
  })

  it('reports raw capture when every processor is off', () => {
    const flags = micProcessingFlags(
      streamWith({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }),
    )
    expect(flags).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
    expect(isProcessedCapture(flags)).toBe(false)
  })

  it('is null when there is no audio track to inspect', () => {
    expect(micProcessingFlags(streamWith(null))).toBeNull()
    expect(isProcessedCapture(null)).toBe(false)
  })

  it('flags a stream as processed when any processor is on', () => {
    expect(
      isProcessedCapture({
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      }),
    ).toBe(true)
    expect(
      isProcessedCapture({
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false,
      }),
    ).toBe(true)
  })
})
