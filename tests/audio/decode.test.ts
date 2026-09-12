import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeAudioFile, formatDuration } from '../../src/audio/decode.ts'

describe('formatDuration', () => {
  it('formats minutes, seconds, and tenths', () => {
    expect(formatDuration(83400)).toBe('1:23.4')
  })

  it('pads seconds and keeps a tenths place', () => {
    expect(formatDuration(0)).toBe('0:00.0')
    expect(formatDuration(100)).toBe('0:00.1')
    expect(formatDuration(1000)).toBe('0:01.0')
    expect(formatDuration(60000)).toBe('1:00.0')
    expect(formatDuration(125500)).toBe('2:05.5')
  })

  it('rounds to the nearest tenth of a second', () => {
    expect(formatDuration(1249)).toBe('0:01.2')
    expect(formatDuration(1250)).toBe('0:01.3')
    expect(formatDuration(59999)).toBe('1:00.0')
  })

  it('clamps negative durations to zero', () => {
    expect(formatDuration(-40)).toBe('0:00.0')
  })
})

describe('decodeAudioFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockBuffer(duration: number, sampleRate: number): AudioBuffer {
    return { duration, sampleRate } as AudioBuffer
  }

  it('decodes via AudioContext.decodeAudioData and returns duration metadata', async () => {
    const buffer = mockBuffer(2.5, 48000)
    const decodeAudioData = vi.fn().mockResolvedValue(buffer)
    const close = vi.fn().mockResolvedValue(undefined)
    const audioContext = { decodeAudioData, close } as unknown as AudioContext
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })

    const result = await decodeAudioFile(file, audioContext)

    expect(decodeAudioData).toHaveBeenCalledTimes(1)
    expect(decodeAudioData.mock.calls[0]?.[0]).toBeInstanceOf(ArrayBuffer)
    expect(result.buffer).toBe(buffer)
    expect(result.durationMs).toBe(2500)
    expect(result.sampleRate).toBe(48000)
    expect(close).not.toHaveBeenCalled()
  })

  it('creates and closes an AudioContext when none is provided', async () => {
    const buffer = mockBuffer(1, 44100)
    const decodeAudioData = vi.fn().mockResolvedValue(buffer)
    const close = vi.fn().mockResolvedValue(undefined)

    class FakeAudioContext {
      decodeAudioData = decodeAudioData
      close = close
    }

    vi.stubGlobal('AudioContext', FakeAudioContext)

    const result = await decodeAudioFile(new Blob([new Uint8Array([9])]))

    expect(result.durationMs).toBe(1000)
    expect(result.sampleRate).toBe(44100)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('wraps decode failures and still closes an owned context', async () => {
    const decodeAudioData = vi.fn().mockRejectedValue(new Error('EncodingError'))
    const close = vi.fn().mockResolvedValue(undefined)

    class FakeAudioContext {
      decodeAudioData = decodeAudioData
      close = close
    }

    vi.stubGlobal('AudioContext', FakeAudioContext)

    await expect(decodeAudioFile(new Blob([new Uint8Array([9])]))).rejects.toThrow(
      'EncodingError',
    )
    expect(close).toHaveBeenCalledTimes(1)
  })
})
