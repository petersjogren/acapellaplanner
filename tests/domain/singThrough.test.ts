import { describe, expect, it } from 'vitest'
import { TakeSchema } from '../../src/domain/schemas.ts'
import {
  completedRun,
  phrasesAreAdjacent,
  singThroughPlaySpec,
  singThroughRun,
  spanPhraseSkipMs,
  takeCoversPhrase,
} from '../../src/domain/singThrough.ts'

function phrase(
  id: string,
  startMs: number,
  endMs: number,
  extras: { preRollMs?: number; postRollMs?: number } = {},
) {
  return {
    id,
    startMs,
    endMs,
    preRollMs: extras.preRollMs,
    postRollMs: extras.postRollMs ?? 0,
    loopDefault: { mode: 'phrase-loop' as const, gapMs: 400 },
  }
}

describe('singThroughRun', () => {
  const phrases = [
    phrase('p1', 0, 1000),
    phrase('p2', 1000, 2500),
    phrase('p3', 2500, 4000),
    phrase('p4', 4500, 6000),
  ]

  it('treats touching phrase ends as adjacent and a gap as a break', () => {
    expect(phrasesAreAdjacent(phrases[0]!, phrases[1]!)).toBe(true)
    expect(phrasesAreAdjacent(phrases[2]!, phrases[3]!)).toBe(false)
  })

  it('walks forward from the start phrase until a gap', () => {
    expect(singThroughRun(phrases, 'p1').map((item) => item.id)).toEqual(['p1', 'p2', 'p3'])
    expect(singThroughRun(phrases, 'p2').map((item) => item.id)).toEqual(['p2', 'p3'])
    expect(singThroughRun(phrases, 'p4').map((item) => item.id)).toEqual(['p4'])
  })

  it('does not include a phrase before the start', () => {
    expect(singThroughRun(phrases, 'p3').map((item) => item.id)).toEqual(['p3'])
  })

  it('returns an empty run when the start phrase is missing', () => {
    expect(singThroughRun(phrases, 'missing')).toEqual([])
  })
})

describe('singThroughPlaySpec', () => {
  it('merges the first head start through the last tail and lists every enter', () => {
    const run = [
      phrase('p1', 1000, 3000, { preRollMs: 250, postRollMs: 100 }),
      phrase('p2', 3000, 5000, { preRollMs: 2000, postRollMs: 80 }),
    ]
    expect(singThroughPlaySpec(run)).toEqual({
      startMs: 1000,
      endMs: 5000,
      preRollMs: 250,
      postRollMs: 80,
      gapMs: 400,
      loop: false,
      phraseEnterMs: [1000, 3000],
    })
  })
})

describe('completedRun', () => {
  const run = [phrase('p1', 0, 1000), phrase('p2', 1000, 2500), phrase('p3', 2500, 4000)]

  it('drops the phrase under the playhead and keeps only a finished prefix', () => {
    expect(completedRun(run, 0).map((item) => item.id)).toEqual([])
    expect(completedRun(run, 999).map((item) => item.id)).toEqual([])
    expect(completedRun(run, 1000).map((item) => item.id)).toEqual(['p1'])
    expect(completedRun(run, 2500).map((item) => item.id)).toEqual(['p1', 'p2'])
    expect(completedRun(run, 4000).map((item) => item.id)).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('take span membership', () => {
  const spanning = {
    phraseId: 'p1',
    spanPhraseIds: ['p1', 'p2', 'p3'],
    timelineStartMs: 0,
  }

  it('covers the anchor by phraseId and later phrases by the span', () => {
    expect(takeCoversPhrase(spanning, 'p1')).toBe(true)
    expect(takeCoversPhrase(spanning, 'p2')).toBe(true)
    expect(takeCoversPhrase({ phraseId: 'p1' }, 'p2')).toBe(false)
  })

  it('skips into the shared blob by the phrase play-window offset from the run start', () => {
    expect(spanPhraseSkipMs(spanning, phrase('p1', 0, 1000, { preRollMs: 200 }))).toBe(0)
    expect(
      spanPhraseSkipMs(spanning, phrase('p2', 1000, 2500, { preRollMs: 250 })),
    ).toBe(750)
  })

  it('does not seek when the record-time origin is missing', () => {
    expect(
      spanPhraseSkipMs(
        { phraseId: 'p1', spanPhraseIds: ['p1', 'p2'] },
        phrase('p2', 1000, 2000),
      ),
    ).toBe(0)
  })
})

describe('TakeSchema spanPhraseIds', () => {
  const base = {
    id: 't1',
    phraseId: 'p1',
    voicePartId: 's1',
    takeIndex: 1,
    audioBlobId: 'b1',
    recordedAt: '2026-09-28T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: 0,
  }

  it('accepts a missing span and a span whose first id is phraseId', () => {
    expect(TakeSchema.parse(base).spanPhraseIds).toBeUndefined()
    expect(TakeSchema.parse({ ...base, spanPhraseIds: ['p1', 'p2'] }).spanPhraseIds).toEqual([
      'p1',
      'p2',
    ])
  })

  it('rejects a span that does not start with phraseId', () => {
    expect(TakeSchema.safeParse({ ...base, spanPhraseIds: ['p2', 'p3'] }).success).toBe(false)
    expect(TakeSchema.safeParse({ ...base, spanPhraseIds: [] }).success).toBe(false)
  })
})
