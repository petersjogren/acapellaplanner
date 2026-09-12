import { describe, expect, it } from 'vitest'
import {
  addPhrase,
  clampPhrase,
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
