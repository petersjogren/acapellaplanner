import { describe, expect, it } from 'vitest'
import { encodeWav, encodeWavPadded, floatToPcm16, msToSamples, wavFromPcm16 } from '../../src/storage/wav.ts'

function bufferOf(samples: number[], sampleRate = 48000): AudioBuffer {
  return {
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
    duration: samples.length / sampleRate,
    getChannelData: () => Float32Array.from(samples),
  } as unknown as AudioBuffer
}

describe('floatToPcm16', () => {
  it('scales to full range symmetrically', () => {
    expect(Array.from(floatToPcm16(Float32Array.from([0, 1, -1])))).toEqual([0, 32767, -32767])
  })

  it('clamps out-of-range samples instead of wrapping', () => {
    expect(Array.from(floatToPcm16(Float32Array.from([2, -2])))).toEqual([32767, -32767])
  })

  it('never emits a value outside Int16 range', () => {
    for (const v of [-1e9, -1.0001, 1.0001, 1e9, Number.NaN]) {
      const [out] = Array.from(floatToPcm16(Float32Array.from([v])))
      expect(out).toBeGreaterThanOrEqual(-32768)
      expect(out).toBeLessThanOrEqual(32767)
    }
  })
})

describe('wavFromPcm16', () => {
  it('writes a RIFF/WAVE header with PCM fmt and data sizes', () => {
    const bytes = wavFromPcm16(Int16Array.from([0, 1, 2, 3]), 48000)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...Array.from(bytes.slice(o, o + n)))

    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(dv.getUint32(16, true)).toBe(16)
    expect(dv.getUint16(20, true)).toBe(1)
    expect(dv.getUint16(22, true)).toBe(1)
    expect(dv.getUint32(24, true)).toBe(48000)
    expect(dv.getUint32(28, true)).toBe(96000)
    expect(dv.getUint16(32, true)).toBe(2)
    expect(dv.getUint16(34, true)).toBe(16)
    expect(ascii(36, 4)).toBe('data')
    expect(dv.getUint32(40, true)).toBe(8)
    expect(bytes.byteLength).toBe(44 + 8)
    expect(dv.getUint32(4, true)).toBe(36 + 8)
  })
})

describe('encodeWav', () => {
  it('round-trips an AudioBuffer through both halves', () => {
    const bytes = encodeWav(bufferOf([0, 0.5, -0.5, 1]))
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(bytes.byteLength).toBe(44 + 8)
    expect(dv.getInt16(44 + 6, true)).toBe(32767)
  })
})

describe('msToSamples', () => {
  it('rounds to the nearest sample and floors at zero', () => {
    expect(msToSamples(1, 48000)).toBe(48)
    expect(msToSamples(-500, 48000)).toBe(0)
    expect(msToSamples(Number.NaN, 48000)).toBe(0)
  })
})

describe('encodeWavPadded', () => {
  it('prepends silence for the timeline offset', () => {
    const bytes = encodeWavPadded(bufferOf([1, 1, 1, 1]), 1)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(dv.getUint32(40, true)).toBe((48 + 4) * 2)
    expect(dv.getInt16(44, true)).toBe(0)
    expect(dv.getInt16(44 + 47 * 2, true)).toBe(0)
    expect(dv.getInt16(44 + 48 * 2, true)).toBe(32767)
  })

  it('is identical to encodeWav when the offset is zero', () => {
    const plain = encodeWav(bufferOf([0.25, -0.25]))
    const padded = encodeWavPadded(bufferOf([0.25, -0.25]), 0)
    expect(Array.from(padded)).toEqual(Array.from(plain))
  })

  it('ignores a negative or non-finite offset', () => {
    expect(encodeWavPadded(bufferOf([1]), -500).byteLength).toBe(44 + 2)
    expect(encodeWavPadded(bufferOf([1]), Number.NaN).byteLength).toBe(44 + 2)
  })

  it('trims leading latency compensation from the take', () => {
    const junk = new Array(48).fill(0.9)
    const bytes = encodeWavPadded(bufferOf([...junk, 0.1]), 0, 1)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(dv.getUint32(40, true)).toBe(2)
    expect(dv.getInt16(44, true)).toBe(Math.round(0.1 * 32767))
  })
})
