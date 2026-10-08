import { describe, expect, it } from 'vitest'
import {
  addPhrase,
  clampPhrase,
  DEFAULT_POST_ROLL_MS,
  DEFAULT_PRE_ROLL_MS,
  gapContainingMs,
  MIN_PHRASE_MS,
  phraseLabel,
  phraseLengthLabel,
  phraseTimelineStartMs,
  phrasesFromDrag,
  removePhrase,
  sortPhrases,
  timeLeftFraction,
  updatePhrase,
} from '../../src/domain/phrases.ts'
import { createEmptyProject, type Phrase, type Project } from '../../src/domain/schemas.ts'

function phrase(overrides: Partial<Phrase> & { id: string; startMs: number; endMs: number }): Phrase {
  return {
    name: overrides.name ?? overrides.id,
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

function projectWithGhost(phrases: Phrase[] = [], durationMs = 10_000): Project {
  return {
    ...createEmptyProject('When I Fall'),
    ghostTrackId: 'ghost-1',
    phrases,
    settings: { language: 'en', ghostMeta: { filename: 'lead.wav', durationMs } },
  }
}

describe('sortPhrases', () => {
  it('orders phrases by startMs without mutating the input', () => {
    const later = phrase({ id: 'b', startMs: 2000, endMs: 3000 })
    const earlier = phrase({ id: 'a', startMs: 200, endMs: 800 })
    const input = [later, earlier]

    expect(sortPhrases(input).map((item) => item.id)).toEqual(['a', 'b'])
    expect(input.map((item) => item.id)).toEqual(['b', 'a'])
  })
})

describe('phraseTimelineStartMs', () => {
  it('is startMs minus preRollMs', () => {
    expect(phraseTimelineStartMs({ startMs: 1000, preRollMs: 250 })).toBe(750)
  })

  it('clamps at 0 instead of going negative', () => {
    expect(phraseTimelineStartMs({ startMs: 1000, preRollMs: 2000 })).toBe(0)
  })

  it('treats a missing preRollMs as 0', () => {
    expect(phraseTimelineStartMs({ startMs: 1000 })).toBe(1000)
  })
})

describe('clampPhrase', () => {
  it('clamps start and end into [0, durationMs]', () => {
    expect(clampPhrase(-200, 12_000, 10_000)).toEqual({ startMs: 0, endMs: 10_000 })
  })

  it('enforces a minimum length of 50ms, shifting back from the duration cap', () => {
    expect(MIN_PHRASE_MS).toBe(50)
    expect(clampPhrase(980, 990, 1000)).toEqual({ startMs: 950, endMs: 1000 })
  })

  it('keeps start before end after clamping', () => {
    const clamped = clampPhrase(800, 100, 1000)
    expect(clamped.startMs).toBeLessThan(clamped.endMs)
    expect(clamped).toEqual({ startMs: 100, endMs: 800 })
  })
})

describe('phrasesFromDrag', () => {
  it('normalizes a reverse drag then clamps', () => {
    expect(phrasesFromDrag(800, 200, 1000)).toEqual({ startMs: 200, endMs: 800 })
  })

  it('clamps a drag that runs past the ghost duration', () => {
    expect(phrasesFromDrag(-50, 5000, 1000)).toEqual({ startMs: 0, endMs: 1000 })
  })
})

describe('gapContainingMs', () => {
  it('fills [0, duration] when there are no phrases', () => {
    expect(gapContainingMs([], 4000, 10_000)).toEqual({ startMs: 0, endMs: 10_000 })
  })

  it('fills the gap between neighbouring phrases', () => {
    expect(
      gapContainingMs(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 4000, endMs: 5000 },
        ],
        2500,
        10_000,
      ),
    ).toEqual({ startMs: 1000, endMs: 4000 })
  })

  it('fills from 0 to the first phrase and from the last phrase to duration', () => {
    expect(gapContainingMs([{ startMs: 2000, endMs: 3000 }], 500, 10_000)).toEqual({
      startMs: 0,
      endMs: 2000,
    })
    expect(gapContainingMs([{ startMs: 2000, endMs: 3000 }], 8000, 10_000)).toEqual({
      startMs: 3000,
      endMs: 10_000,
    })
  })

  it('returns null inside a phrase (half-open) and for a too-short gap', () => {
    expect(gapContainingMs([{ startMs: 0, endMs: 2000 }], 0, 10_000)).toBeNull()
    expect(gapContainingMs([{ startMs: 0, endMs: 2000 }], 1999, 10_000)).toBeNull()
    expect(gapContainingMs([{ startMs: 0, endMs: 2000 }], 2000, 10_000)).toEqual({
      startMs: 2000,
      endMs: 10_000,
    })
    expect(
      gapContainingMs(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 1020, endMs: 2000 },
        ],
        1010,
        10_000,
      ),
    ).toBeNull()
  })

  it('clamps the probe into [0, durationMs]', () => {
    expect(gapContainingMs([], -50, 10_000)).toEqual({ startMs: 0, endMs: 10_000 })
    expect(gapContainingMs([], 99_000, 10_000)).toEqual({ startMs: 0, endMs: 10_000 })
  })
})

describe('phraseLabel', () => {
  it('uses the trimmed name when non-empty', () => {
    expect(phraseLabel({ name: 'Verse', startMs: 30_000 })).toBe('Verse')
    expect(phraseLabel({ name: '  Intro  ', startMs: 30_000 })).toBe('Intro')
  })

  it('uses the start-time clock when the name is empty or whitespace', () => {
    expect(phraseLabel({ name: '', startMs: 30_000 })).toBe('0:30.0')
    expect(phraseLabel({ name: '   ', startMs: 83400 })).toBe('1:23.4')
    expect(phraseLabel({ name: '', startMs: 0 })).toBe('0:00.0')
  })

  it('keeps a stored Phrase N string as the label until cleared', () => {
    expect(phraseLabel({ name: 'Phrase 1', startMs: 30_000 })).toBe('Phrase 1')
  })
})

describe('phraseLengthLabel', () => {
  it('formats end − start as seconds with tenths and a unit', () => {
    expect(phraseLengthLabel({ startMs: 0, endMs: 8400 })).toBe('8.4 s')
    expect(phraseLengthLabel({ startMs: 1000, endMs: 2500 })).toBe('1.5 s')
    expect(phraseLengthLabel({ startMs: 0, endMs: 100 })).toBe('0.1 s')
  })
})

describe('timeLeftFraction', () => {
  const span = { startMs: 2000, endMs: 4000 }

  it('is 0 before the phrase start, including the head-start window', () => {
    expect(timeLeftFraction(span, 0)).toBe(0)
    expect(timeLeftFraction(span, 1999)).toBe(0)
  })

  it('is elapsed/length while the phrase sounds', () => {
    expect(timeLeftFraction(span, 2000)).toBe(0)
    expect(timeLeftFraction(span, 3000)).toBe(0.5)
    expect(timeLeftFraction(span, 3500)).toBe(0.75)
  })

  it('is 1 at and after the phrase end, including the crossfade tail', () => {
    expect(timeLeftFraction(span, 4000)).toBe(1)
    expect(timeLeftFraction(span, 6000)).toBe(1)
  })

  it('is 1 for a zero-length span at or after start', () => {
    expect(timeLeftFraction({ startMs: 1000, endMs: 1000 }, 1000)).toBe(1)
    expect(timeLeftFraction({ startMs: 1000, endMs: 1000 }, 500)).toBe(0)
  })
})

describe('addPhrase', () => {
  it('appends a clamped, unnamed phrase and sorts by startMs', () => {
    const existing = phrase({ id: 'later', startMs: 4000, endMs: 5000, name: 'Phrase 1' })
    const project = projectWithGhost([existing])

    const next = addPhrase(project, { startMs: 200, endMs: 800, lyricText: 'when I fall' })

    expect(next.phrases.map((item) => item.name)).toEqual(['', 'Phrase 1'])
    expect(next.phrases[0]?.startMs).toBe(200)
    expect(next.phrases[0]?.endMs).toBe(800)
    expect(next.phrases[0]?.lyricText).toBe('when I fall')
    expect(next.phrases[0]?.id.length).toBeGreaterThan(0)
    expect(phraseLabel(next.phrases[0]!)).toBe('0:00.2')
    expect(project.phrases).toHaveLength(1)
  })

  it('stores an empty name string when no name is given', () => {
    const next = addPhrase(projectWithGhost(), { startMs: 2000, endMs: 3000 })
    expect(next.phrases[0]?.name).toBe('')
    expect(Object.prototype.hasOwnProperty.call(next.phrases[0], 'name')).toBe(true)
  })

  it('does not inherit a freed Phrase N after a clear', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 0, endMs: 1000, name: '' }),
      phrase({ id: 'b', startMs: 2000, endMs: 3000, name: 'Phrase 2' }),
    ])
    const cleared = updatePhrase(project, 'b', { name: '' })
    const next = addPhrase(cleared, { startMs: 4000, endMs: 5000 })
    expect(next.phrases.map((item) => item.name)).toEqual(['', '', ''])
  })

  it('leaves other stored names alone when adding, and allows shared typed names', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 0, endMs: 1000, name: 'Verse' }),
    ])
    const next = addPhrase(project, { startMs: 2000, endMs: 3000, name: 'Verse' })
    expect(next.phrases.map((item) => item.name)).toEqual(['Verse', 'Verse'])
  })

  it('throws on overlap and leaves the original project unchanged', () => {
    const project = projectWithGhost([phrase({ id: 'a', startMs: 0, endMs: 1000 })])

    expect(() => addPhrase(project, { startMs: 500, endMs: 1500 })).toThrow(/overlap/i)
    expect(project.phrases).toHaveLength(1)
  })

  it('defaults head start and crossfade tail to 2000 ms', () => {
    const project = projectWithGhost()

    const next = addPhrase(project, { startMs: 2000, endMs: 3000 })

    expect(next.phrases[0]).toMatchObject({
      name: '',
      startMs: 2000,
      endMs: 3000,
      preRollMs: DEFAULT_PRE_ROLL_MS,
      postRollMs: DEFAULT_POST_ROLL_MS,
    })
    expect(DEFAULT_PRE_ROLL_MS).toBe(2000)
    expect(DEFAULT_POST_ROLL_MS).toBe(2000)
  })

  it('still writes those defaults when the phrase starts at 0', () => {
    const next = addPhrase(projectWithGhost(), { startMs: 0, endMs: 1000 })

    expect(next.phrases[0]).toMatchObject({
      name: '',
      startMs: 0,
      endMs: 1000,
      preRollMs: DEFAULT_PRE_ROLL_MS,
      postRollMs: DEFAULT_POST_ROLL_MS,
    })
  })
})

describe('updatePhrase', () => {
  it('patches name, lyric, and clamped times', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 200, endMs: 800, name: 'Phrase 1', lyricText: 'old' }),
    ])

    const next = updatePhrase(project, 'a', {
      name: 'Intro',
      lyricText: 'when I fall',
      startMs: -10,
      endMs: 900,
    })

    expect(next.phrases[0]).toMatchObject({
      id: 'a',
      name: 'Intro',
      lyricText: 'when I fall',
      startMs: 0,
      endMs: 900,
    })
  })

  it('allows clearing the name to an empty string', () => {
    const project = projectWithGhost(
      [
        phrase({ id: 'a', startMs: 30_000, endMs: 31_000, name: 'Phrase 1' }),
        phrase({ id: 'b', startMs: 40_000, endMs: 41_000, name: 'Verse' }),
      ],
      50_000,
    )

    const next = updatePhrase(project, 'a', { name: '' })
    expect(next.phrases[0]?.name).toBe('')
    expect(phraseLabel(next.phrases[0]!)).toBe('0:30.0')
    expect(next.phrases[1]?.name).toBe('Verse')
  })

  it('trims whitespace-only names to empty', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 200, endMs: 800, name: 'Intro' }),
    ])
    const next = updatePhrase(project, 'a', { name: '   ' })
    expect(next.phrases[0]?.name).toBe('')
    expect(phraseLabel(next.phrases[0]!)).toBe('0:00.2')
  })

  it('keeps a typed Phrase 1 string and leaves siblings alone on trim', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 0, endMs: 1000, name: 'Phrase 1' }),
      phrase({ id: 'b', startMs: 2000, endMs: 3000, name: 'Verse' }),
    ])
    const next = updatePhrase(project, 'b', { startMs: 2100, endMs: 2900 })
    expect(next.phrases[0]?.name).toBe('Phrase 1')
    expect(next.phrases[1]?.name).toBe('Verse')
  })

  it('patches preRollMs and postRollMs, clamping negative values to 0', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 2000, endMs: 3000, name: 'Phrase 1' }),
    ])

    const withRoll = updatePhrase(project, 'a', { preRollMs: 300, postRollMs: 500 })
    expect(withRoll.phrases[0]).toMatchObject({ preRollMs: 300, postRollMs: 500 })

    const clamped = updatePhrase(withRoll, 'a', { preRollMs: -50, postRollMs: -10 })
    expect(clamped.phrases[0]).toMatchObject({ preRollMs: 0, postRollMs: 0 })
  })

  it('leaves preRollMs/postRollMs untouched when not part of the patch', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 2000, endMs: 3000, name: 'Phrase 1', preRollMs: 300 }),
    ])

    const next = updatePhrase(project, 'a', { name: 'Verse' })
    expect(next.phrases[0]).toMatchObject({ name: 'Verse', preRollMs: 300, postRollMs: 0 })
  })

  it('allows preRollMs/postRollMs to reach into a neighboring phrase without overlap failing', () => {
    // Head start / crossfade tail extend the play window, not the phrase
    // boundary — two adjacent phrases can still have non-overlapping
    // startMs/endMs while their audio genuinely overlaps in playback.
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 0, endMs: 1000, name: 'Phrase 1' }),
      phrase({ id: 'b', startMs: 1000, endMs: 2000, name: 'Phrase 2' }),
    ])

    const next = updatePhrase(project, 'b', { preRollMs: 400 })
    expect(next.phrases[1]).toMatchObject({ startMs: 1000, endMs: 2000, preRollMs: 400 })
  })

  it('rejects an update that would overlap another phrase', () => {
    const project = projectWithGhost([
      phrase({ id: 'a', startMs: 0, endMs: 1000 }),
      phrase({ id: 'b', startMs: 2000, endMs: 3000 }),
    ])

    expect(() => updatePhrase(project, 'b', { startMs: 500, endMs: 1500 })).toThrow(/overlap/i)
    expect(project.phrases[1]?.startMs).toBe(2000)
  })
})

describe('removePhrase', () => {
  it('drops the phrase by id', () => {
    const project = projectWithGhost([
      phrase({ id: 'keep', startMs: 0, endMs: 400 }),
      phrase({ id: 'drop', startMs: 800, endMs: 1200 }),
    ])

    const next = removePhrase(project, 'drop')
    expect(next.phrases.map((item) => item.id)).toEqual(['keep'])
    expect(project.phrases).toHaveLength(2)
  })
})
