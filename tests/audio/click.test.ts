import { describe, expect, it } from 'vitest'
import { clicksForPhrase, clickTimesMs } from '../../src/audio/click.ts'
import type { Phrase, Section } from '../../src/domain/schemas.ts'

function section(overrides: Partial<Section> & Pick<Section, 'id' | 'timeMode'>): Section {
  return {
    name: overrides.name ?? overrides.id,
    startMs: 0,
    endMs: 2000,
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
    sheetRefs: [],
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
  it('returns click times clipped to the phrase when it overlaps a fixed-tempo click section', () => {
    const sections = [
      section({
        id: 'in-time',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: true,
        startMs: 0,
        endMs: 4000,
      }),
    ]
    expect(clicksForPhrase(phrase({ startMs: 500, endMs: 2500 }), sections)).toEqual([1000, 2000])
  })

  it('uses the phrase sectionId when present', () => {
    const sections = [
      section({
        id: 'ghost',
        timeMode: 'ghost-follow',
        clickEnabled: true,
        startMs: 0,
        endMs: 4000,
      }),
      section({
        id: 'in-time',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: true,
        startMs: 0,
        endMs: 2000,
      }),
    ]
    expect(clicksForPhrase(phrase({ sectionId: 'in-time' }), sections)).toEqual([0, 1000])
  })

  it('returns no clicks for ghost-follow / rubato sections', () => {
    const sections = [
      section({
        id: 'rubato',
        timeMode: 'ghost-follow',
        clickEnabled: true,
        fixedBpm: 60,
        startMs: 0,
        endMs: 2000,
      }),
    ]
    expect(clicksForPhrase(phrase({ sectionId: 'rubato' }), sections)).toEqual([])
    expect(clicksForPhrase(phrase(), sections)).toEqual([])
  })

  it('returns no clicks when clickEnabled is false', () => {
    const sections = [
      section({
        id: 'in-time',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: false,
        startMs: 0,
        endMs: 2000,
      }),
    ]
    expect(clicksForPhrase(phrase({ sectionId: 'in-time' }), sections)).toEqual([])
  })

  it('never generates clicks outside the section window', () => {
    const sections = [
      section({
        id: 'in-time',
        timeMode: 'fixed-tempo',
        fixedBpm: 60,
        clickEnabled: true,
        startMs: 1000,
        endMs: 3000,
      }),
    ]
    expect(clicksForPhrase(phrase({ startMs: 0, endMs: 4000 }), sections)).toEqual([1000, 2000])
  })
})
