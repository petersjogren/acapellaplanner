import { describe, expect, it } from 'vitest'
import {
  addPhrase,
  clampPhrase,
  DEFAULT_POST_ROLL_MS,
  DEFAULT_PRE_ROLL_MS,
  gapContainingMs,
  MIN_PHRASE_MS,
  nextPhraseName,
  phrasesFromDrag,
  removePhrase,
  sortPhrases,
  updatePhrase,
} from '../../src/domain/phrases.ts'
import { createEmptyProject, type Phrase, type Project } from '../../src/domain/schemas.ts'

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

describe('nextPhraseName', () => {
  it('starts at Phrase 1 and fills the lowest unused number', () => {
    expect(nextPhraseName([])).toBe('Phrase 1')
    expect(nextPhraseName([phrase({ id: 'a', name: 'Phrase 1', startMs: 0, endMs: 100 })])).toBe(
      'Phrase 2',
    )
    expect(
      nextPhraseName([
        phrase({ id: 'a', name: 'Phrase 1', startMs: 0, endMs: 100 }),
        phrase({ id: 'c', name: 'Phrase 3', startMs: 200, endMs: 300 }),
      ]),
    ).toBe('Phrase 2')
  })
})

describe('addPhrase', () => {
  it('appends a clamped, named phrase and sorts by startMs', () => {
    const existing = phrase({ id: 'later', startMs: 4000, endMs: 5000, name: 'Phrase 1' })
    const project = projectWithGhost([existing])

    const next = addPhrase(project, { startMs: 200, endMs: 800, lyricText: 'when I fall' })

    expect(next.phrases.map((item) => item.name)).toEqual(['Phrase 2', 'Phrase 1'])
    expect(next.phrases[0]?.startMs).toBe(200)
    expect(next.phrases[0]?.endMs).toBe(800)
    expect(next.phrases[0]?.lyricText).toBe('when I fall')
    expect(next.phrases[0]?.id.length).toBeGreaterThan(0)
    expect(project.phrases).toHaveLength(1)
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
