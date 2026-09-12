import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isEmptyTake,
  nextTakeIndex,
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
