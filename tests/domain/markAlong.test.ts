import { describe, expect, it } from 'vitest'
import { MIN_PHRASE_MS } from '../../src/domain/phrases.ts'
import { stopMarkAlong, tapMarkAlong } from '../../src/domain/markAlong.ts'

describe('tapMarkAlong', () => {
  it('opens on the first tap when nothing is open', () => {
    expect(tapMarkAlong([], null, 1200, 10_000)).toEqual({ kind: 'open', startMs: 1200 })
  })

  it('commits an adjacent phrase on the next tap and reopens there', () => {
    expect(tapMarkAlong([], 1200, 4000, 10_000)).toEqual({
      kind: 'commit',
      startMs: 1200,
      endMs: 4000,
      nextOpenMs: 4000,
    })
  })

  it('ignores a tap inside an existing phrase when nothing is open', () => {
    expect(
      tapMarkAlong([{ startMs: 0, endMs: 2000 }], null, 500, 10_000),
    ).toEqual({ kind: 'ignore' })
  })

  it('allows a tap exactly at an existing phrase end (half-open)', () => {
    expect(
      tapMarkAlong([{ startMs: 0, endMs: 2000 }], null, 2000, 10_000),
    ).toEqual({ kind: 'open', startMs: 2000 })
  })

  it('clamps a commit to the next phrase start and does not reopen there', () => {
    expect(
      tapMarkAlong([{ startMs: 5000, endMs: 8000 }], 1000, 6000, 10_000),
    ).toEqual({
      kind: 'commit',
      startMs: 1000,
      endMs: 5000,
      nextOpenMs: null,
    })
  })

  it('ignores a tap shorter than MIN_PHRASE_MS', () => {
    expect(tapMarkAlong([], 1000, 1000 + MIN_PHRASE_MS - 1, 10_000)).toEqual({
      kind: 'ignore',
    })
  })

  it('clamps the tap into [0, durationMs]', () => {
    expect(tapMarkAlong([], null, -50, 10_000)).toEqual({ kind: 'open', startMs: 0 })
    expect(tapMarkAlong([], 1000, 99_000, 10_000)).toEqual({
      kind: 'commit',
      startMs: 1000,
      endMs: 10_000,
      nextOpenMs: 10_000,
    })
  })
})

describe('stopMarkAlong', () => {
  it('commits the open interval at now when long enough', () => {
    expect(stopMarkAlong([], 1000, 3500, 10_000)).toEqual({
      kind: 'commit',
      startMs: 1000,
      endMs: 3500,
    })
  })

  it('returns none when nothing is open or the interval is too short', () => {
    expect(stopMarkAlong([], null, 3500, 10_000)).toEqual({ kind: 'none' })
    expect(stopMarkAlong([], 1000, 1020, 10_000)).toEqual({ kind: 'none' })
  })

  it('clamps stop to the next phrase start', () => {
    expect(
      stopMarkAlong([{ startMs: 4000, endMs: 5000 }], 1000, 4500, 10_000),
    ).toEqual({ kind: 'commit', startMs: 1000, endMs: 4000 })
  })
})
