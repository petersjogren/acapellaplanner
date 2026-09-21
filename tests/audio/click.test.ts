import { describe, expect, it } from 'vitest'
import { clicksForPhrase, clickTimesMs } from '../../src/audio/click.ts'
import type { Phrase, Section } from '../../src/domain/schemas.ts'

function section(overrides: Partial<Section> & Pick<Section, 'id' | 'timeMode' | 'fromPhraseId' | 'toPhraseId'>): Section {
  return {
    name: overrides.name ?? overrides.id,
    clickEnabled: false,
    ...overrides,
  }
}

function phrase(overrides: Partial<Phrase> = {}): Phrase {
  return {
    id: 'p1',
    name: 'Phrase 1',
    startMs: 0,
    endMs: 2000,
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

describe('clickTimesMs', () => {
  it('places quarter-note clicks at 60bpm with exclusive end', () => {
    expect(clickTimesMs({ startMs: 0, endMs: 2000, bpm: 60 })).toEqual([0, 1000])
  })

  it('starts on startMs and steps by 60000/bpm while t < endMs', () => {
    expect(clickTimesMs({ startMs: 500, endMs: 2500, bpm: 120 })).toEqual([500, 1000, 1500, 2000])
  })

  it('returns no times when the window is empty or bpm is not positive', () => {
    expect(clickTimesMs({ startMs: 0, endMs: 0, bpm: 60 })).toEqual([])
    expect(clickTimesMs({ startMs: 1000, endMs: 500, bpm: 60 })).toEqual([])
    expect(clickTimesMs({ startMs: 0, endMs: 2000, bpm: 0 })).toEqual([])
  })

  it('returns no times when bpm is non-finite or the interval would be 0', () => {
    expect(clickTimesMs({ startMs: 0, endMs: 2000, bpm: Number.POSITIVE_INFINITY })).toEqual([])
    expect(clickTimesMs({ startMs: 0, endMs: 2000, bpm: Number.NaN })).toEqual([])
    expect(clickTimesMs({ startMs: 0, endMs: 2000, bpm: Number.NEGATIVE_INFINITY })).toEqual([])
  })
})

describe('clicksForPhrase', () => {
  it('returns click times on the section grid, clipped to the phrase play window', () => {
    const p1 = phrase({ id: 'p1', startMs: 0, endMs: 2000 })
    const p2 = phrase({ id: 'p2', startMs: 2000, endMs: 4000 })
    const sections = [
      section({
        id: 'verse',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: true,
        fromPhraseId: 'p1',
        toPhraseId: 'p2',
      }),
    ]
    expect(clicksForPhrase(p2, sections, [p1, p2])).toEqual([2000, 3000])
  })

  it('returns no clicks for a phrase that is not in the section', () => {
    const p1 = phrase({ id: 'p1', startMs: 0, endMs: 2000 })
    const p2 = phrase({ id: 'p2', startMs: 2000, endMs: 4000 })
    const sections = [
      section({
        id: 'verse',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: true,
        fromPhraseId: 'p2',
        toPhraseId: 'p2',
      }),
    ]
    expect(clicksForPhrase(p1, sections, [p1, p2])).toEqual([])
  })

  it('returns no clicks for ghost-follow / rubato sections', () => {
    const p1 = phrase()
    const sections = [
      section({
        id: 'rubato',
        timeMode: 'ghost-follow',
        clickEnabled: true,
        fixedBpm: 60,
        fromPhraseId: 'p1',
        toPhraseId: 'p1',
      }),
    ]
    expect(clicksForPhrase(p1, sections, [p1])).toEqual([])
  })

  it('returns no clicks when clickEnabled is false', () => {
    const p1 = phrase()
    const sections = [
      section({
        id: 'in-time',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: false,
        fromPhraseId: 'p1',
        toPhraseId: 'p1',
      }),
    ]
    expect(clicksForPhrase(p1, sections, [p1])).toEqual([])
  })

  it('never generates clicks outside the derived section window', () => {
    const p1 = phrase({ id: 'p1', startMs: 1000, endMs: 3000 })
    const sections = [
      section({
        id: 'in-time',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: true,
        fromPhraseId: 'p1',
        toPhraseId: 'p1',
      }),
    ]
    expect(clicksForPhrase(p1, sections, [p1])).toEqual([1000, 2000])
  })

  it('does not emit negative click times when a phrase at 0 has a 2000 ms head start', () => {
    const p1 = phrase({
      id: 'p1',
      startMs: 0,
      endMs: 2000,
      preRollMs: 2000,
      postRollMs: 2000,
    })
    const sections = [
      section({
        id: 'in-time',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: true,
        fromPhraseId: 'p1',
        toPhraseId: 'p1',
      }),
    ]
    const times = clicksForPhrase(p1, sections, [p1])
    expect(times.every((time) => time >= 0)).toBe(true)
    expect(times[0]).toBe(0)
    expect(times).toEqual([0, 1000, 2000, 3000])
  })
})
