import { describe, expect, it } from 'vitest'
import {
  classifyMicLevel,
  framePeakAbs,
  smoothLevel,
} from '../../src/audio/micLevel.ts'

describe('framePeakAbs', () => {
  it('is ~1 when a byte frame has one sample at 255 and the rest 128', () => {
    const frame = new Uint8Array(8).fill(128)
    frame[3] = 255
    expect(framePeakAbs(frame)).toBeCloseTo(1, 1)
  })

  it('is ~1 when a byte frame has one sample at 0 and the rest 128', () => {
    const frame = new Uint8Array(8).fill(128)
    frame[3] = 0
    expect(framePeakAbs(frame)).toBeCloseTo(1, 1)
  })

  it('is the max abs sample on a float frame', () => {
    expect(framePeakAbs(new Float32Array([0.1, -0.4, 0.25]))).toBeCloseTo(0.4)
  })

  it('is ~0 for a silent byte frame (all 128)', () => {
    expect(framePeakAbs(new Uint8Array(16).fill(128))).toBeCloseTo(0)
  })

  it('is 0 for an empty frame', () => {
    expect(framePeakAbs(new Uint8Array(0))).toBe(0)
    expect(framePeakAbs(new Float32Array(0))).toBe(0)
  })
})

describe('smoothLevel', () => {
  it('attacks faster than it releases', () => {
    const attacked = smoothLevel(0, 1)
    const released = smoothLevel(1, 0)
    expect(attacked).toBeCloseTo(0.35)
    expect(released).toBeCloseTo(0.92)
    expect(attacked - 0).toBeGreaterThan(1 - released)
  })
})

describe('classifyMicLevel', () => {
  it('is not living at 0 and is living at 0.05', () => {
    expect(classifyMicLevel(0).living).toBe(false)
    expect(classifyMicLevel(0.05).living).toBe(true)
  })
})
