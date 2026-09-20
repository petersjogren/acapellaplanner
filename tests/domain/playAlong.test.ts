import { describe, expect, it } from 'vitest'
import {
  phraseForPlayhead,
  playAlongWindow,
  sheetElapsedInPhrase,
} from '../../src/domain/playAlong.ts'
import type { Phrase, Section } from '../../src/domain/schemas.ts'

function phrase(overrides: Partial<Phrase> & { id: string; startMs: number; endMs: number }): Phrase {
  return {
    name: overrides.name ?? overrides.id,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

const p1 = phrase({ id: 'p1', name: 'when I fall', startMs: 1000, endMs: 3000, loopDefault: { mode: 'phrase-loop', gapMs: 400 } })
const p2 = phrase({ id: 'p2', name: 'in love', startMs: 3000, endMs: 5000, loopDefault: { mode: 'phrase-loop', gapMs: 250 } })
const p3 = phrase({ id: 'p3', name: 'it will be', startMs: 7000, endMs: 9000 })

const verse: Section = {
  id: 's1',
  name: 'Verse',
  timeMode: 'ghost-follow',
  fromPhraseId: 'p1',
  toPhraseId: 'p2',
  clickEnabled: false,
}

describe('phraseForPlayhead', () => {
  it('returns undefined when there are no phrases', () => {
    expect(phraseForPlayhead([], 0)).toBeUndefined()
  })

  it('returns the containing phrase', () => {
    expect(phraseForPlayhead([p1, p2, p3], 1500)?.id).toBe('p1')
    expect(phraseForPlayhead([p1, p2, p3], 3000)?.id).toBe('p2')
    expect(phraseForPlayhead([p1, p2, p3], 4999)?.id).toBe('p2')
  })

  it('holds the previous phrase in a gap so the sheet does not flash blank', () => {
    expect(phraseForPlayhead([p1, p2, p3], 5500)?.id).toBe('p2')
  })

  it('pins to the first phrase before anything has started', () => {
    expect(phraseForPlayhead([p1, p2, p3], 0)?.id).toBe('p1')
    expect(phraseForPlayhead([p1, p2, p3], 999)?.id).toBe('p1')
  })

  it('holds the last phrase after the song', () => {
    expect(phraseForPlayhead([p1, p2, p3], 12_000)?.id).toBe('p3')
  })
})

describe('sheetElapsedInPhrase', () => {
  it('is playhead minus phrase start, clamped to the phrase span', () => {
    expect(sheetElapsedInPhrase(p1, 1000)).toBe(0)
    expect(sheetElapsedInPhrase(p1, 2000)).toBe(1000)
    expect(sheetElapsedInPhrase(p1, 3000)).toBe(2000)
    expect(sheetElapsedInPhrase(p1, 0)).toBe(0)
    expect(sheetElapsedInPhrase(p1, 9000)).toBe(2000)
  })
})

describe('playAlongWindow', () => {
  const phrases = [p1, p2, p3]
  const sections = [verse]

  it('plays from fromMs to the ghost end when loop is off', () => {
    expect(
      playAlongWindow({
        loopMode: 'off',
        phrases,
        sections,
        selectedPhraseId: 'p2',
        ghostDurationMs: 10_000,
        fromMs: 3000,
      }),
    ).toEqual({ startMs: 3000, endMs: 10_000, loop: false, gapMs: 0 })
  })

  it('starts at 0 when fromMs is omitted', () => {
    expect(
      playAlongWindow({
        loopMode: 'off',
        phrases,
        sections,
        selectedPhraseId: null,
        ghostDurationMs: 10_000,
      }),
    ).toEqual({ startMs: 0, endMs: 10_000, loop: false, gapMs: 0 })
  })

  it('is null when there is no ghost duration, or resume is at the end', () => {
    expect(
      playAlongWindow({
        loopMode: 'off',
        phrases,
        sections,
        selectedPhraseId: null,
        ghostDurationMs: 0,
      }),
    ).toBeNull()
    expect(
      playAlongWindow({
        loopMode: 'off',
        phrases,
        sections,
        selectedPhraseId: null,
        ghostDurationMs: 10_000,
        fromMs: 10_000,
      }),
    ).toBeNull()
  })

  it('loops the selected phrase using its stored gap, without pre/post-roll', () => {
    expect(
      playAlongWindow({
        loopMode: 'phrase',
        phrases,
        sections,
        selectedPhraseId: 'p2',
        ghostDurationMs: 10_000,
      }),
    ).toEqual({ startMs: 3000, endMs: 5000, loop: true, gapMs: 250 })
  })

  it('loops the section that contains the selected phrase', () => {
    expect(
      playAlongWindow({
        loopMode: 'section',
        phrases,
        sections,
        selectedPhraseId: 'p2',
        ghostDurationMs: 10_000,
      }),
    ).toEqual({ startMs: 1000, endMs: 5000, loop: true, gapMs: 400 })
  })

  it('falls back to phrase-loop when the selected phrase is not in a section', () => {
    expect(
      playAlongWindow({
        loopMode: 'section',
        phrases,
        sections,
        selectedPhraseId: 'p3',
        ghostDurationMs: 10_000,
      }),
    ).toEqual({ startMs: 7000, endMs: 9000, loop: true, gapMs: 400 })
  })

  it('falls back to the first phrase when none is selected', () => {
    expect(
      playAlongWindow({
        loopMode: 'phrase',
        phrases,
        sections,
        selectedPhraseId: null,
        ghostDurationMs: 10_000,
      }),
    ).toEqual({ startMs: 1000, endMs: 3000, loop: true, gapMs: 400 })
  })

  it('is null when looping with no phrases', () => {
    expect(
      playAlongWindow({
        loopMode: 'phrase',
        phrases: [],
        sections: [],
        selectedPhraseId: null,
        ghostDurationMs: 10_000,
      }),
    ).toBeNull()
  })
})
