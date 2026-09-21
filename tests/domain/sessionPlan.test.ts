import { describe, expect, it } from 'vitest'
import { markEnough, markInProgress, reopenEnough, suggestNext } from '../../src/domain/sessionPlan.ts'
import {
  createEmptyProject,
  type Phrase,
  type PhrasePartPlan,
  type Project,
  type Take,
  type VoicePart,
} from '../../src/domain/schemas.ts'

function part(overrides: Partial<VoicePart> & { id: string }): VoicePart {
  return {
    name: overrides.name ?? overrides.id,
    shortLabel: overrides.shortLabel ?? overrides.id.slice(0, 2).toUpperCase(),
    color: '#c23b2a',
    targetTakes: 4,
    ...overrides,
  }
}

function phrase(overrides: Partial<Phrase> & { id: string }): Phrase {
  return {
    name: overrides.name ?? overrides.id,
    startMs: 0,
    endMs: 1000,
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

function plan(overrides: Partial<PhrasePartPlan> & { voicePartId: string }): PhrasePartPlan {
  return {
    priority: 0,
    targetTakes: 4,
    requiredGuide: ['ghost'],
    status: 'not-started',
    ...overrides,
  }
}

function take(
  overrides: Partial<Take> & { id: string; phraseId: string; voicePartId: string },
): Take {
  return {
    takeIndex: 1,
    audioBlobId: 'blob-1',
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: -6,
    ...overrides,
  }
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    ...createEmptyProject('When I Fall'),
    ...overrides,
  }
}

describe('suggestNext', () => {
  it('prefers in-progress phrases for the selected part over uncovered ones', () => {
    const result = suggestNext(
      project({
        voiceRoster: [part({ id: 's1' })],
        phrases: [
          phrase({
            id: 'p-open',
            startMs: 0,
            endMs: 1000,
            partPlan: [plan({ voicePartId: 's1', status: 'not-started', priority: 0 })],
          }),
          phrase({
            id: 'p-going',
            startMs: 2000,
            endMs: 3000,
            partPlan: [plan({ voicePartId: 's1', status: 'in-progress', priority: 1 })],
          }),
        ],
      }),
      { voicePartId: 's1' },
    )

    expect(result).toEqual({ voicePartId: 's1', phraseId: 'p-going' })
  })

  it('picks the highest-priority uncovered phrase when nothing is in-progress', () => {
    const result = suggestNext(
      project({
        voiceRoster: [part({ id: 's1' })],
        phrases: [
          phrase({
            id: 'later-but-first',
            startMs: 4000,
            endMs: 5000,
            partPlan: [plan({ voicePartId: 's1', status: 'not-started', priority: 0 })],
          }),
          phrase({
            id: 'earlier-but-second',
            startMs: 0,
            endMs: 1000,
            partPlan: [plan({ voicePartId: 's1', status: 'not-started', priority: 1 })],
          }),
        ],
      }),
      { voicePartId: 's1' },
    )

    expect(result).toEqual({ voicePartId: 's1', phraseId: 'later-but-first' })
  })

  it('orders uncovered phrases by startMs when partPlan.priority is missing', () => {
    const result = suggestNext(
      project({
        voiceRoster: [part({ id: 's1' })],
        phrases: [
          phrase({ id: 'second', startMs: 2000, endMs: 3000 }),
          phrase({ id: 'first', startMs: 0, endMs: 1000 }),
        ],
      }),
      { voicePartId: 's1' },
    )

    expect(result).toEqual({ voicePartId: 's1', phraseId: 'first' })
  })

  it('fills doubles after uncovered phrases: keeper present, takeCount still under target', () => {
    const roster = [part({ id: 's1', targetTakes: 4 })]
    const phrases = [
      phrase({
        id: 'open',
        startMs: 0,
        endMs: 1000,
        partPlan: [plan({ voicePartId: 's1', status: 'not-started' })],
      }),
      phrase({
        id: 'double-me',
        startMs: 2000,
        endMs: 3000,
        partPlan: [plan({ voicePartId: 's1', status: 'not-started', targetTakes: 4 })],
      }),
    ]
    const withKeeper = project({
      voiceRoster: roster,
      phrases,
      takes: [
        take({
          id: 'k1',
          phraseId: 'double-me',
          voicePartId: 's1',
          takeIndex: 1,
          rating: 'keeper',
        }),
      ],
    })

    expect(suggestNext(withKeeper, { voicePartId: 's1' })).toEqual({
      voicePartId: 's1',
      phraseId: 'open',
    })

    const afterCovering = markEnough(withKeeper, 'open', 's1')
    expect(suggestNext(afterCovering, { voicePartId: 's1' })).toEqual({
      voicePartId: 's1',
      phraseId: 'double-me',
    })
  })

  it('falls through to the next not-enough cell when there are no doubles', () => {
    const result = suggestNext(
      project({
        voiceRoster: [part({ id: 's1', targetTakes: 4 })],
        phrases: [
          phrase({
            id: 'done',
            startMs: 0,
            endMs: 1000,
            partPlan: [plan({ voicePartId: 's1', status: 'enough' })],
          }),
          phrase({
            id: 'scratchy',
            startMs: 2000,
            endMs: 3000,
            partPlan: [plan({ voicePartId: 's1', status: 'not-started', targetTakes: 4 })],
          }),
        ],
        takes: [take({ id: 't1', phraseId: 'scratchy', voicePartId: 's1', takeIndex: 1 })],
      }),
      { voicePartId: 's1' },
    )

    expect(result).toEqual({ voicePartId: 's1', phraseId: 'scratchy' })
  })

  it('returns null when every cell is enough or final', () => {
    const result = suggestNext(
      project({
        voiceRoster: [part({ id: 's1' }), part({ id: 'a1' })],
        phrases: [
          phrase({
            id: 'p1',
            startMs: 0,
            endMs: 1000,
            partPlan: [
              plan({ voicePartId: 's1', status: 'enough' }),
              plan({ voicePartId: 'a1', status: 'final' }),
            ],
          }),
          phrase({
            id: 'p2',
            startMs: 2000,
            endMs: 3000,
            partPlan: [
              plan({ voicePartId: 's1', status: 'final' }),
              plan({ voicePartId: 'a1', status: 'enough' }),
            ],
          }),
        ],
      }),
    )

    expect(result).toBeNull()
  })

  it('returns null for a selected part that is fully enough even if another part has work', () => {
    const result = suggestNext(
      project({
        voiceRoster: [part({ id: 's1' }), part({ id: 'a1' })],
        phrases: [
          phrase({
            id: 'p1',
            partPlan: [
              plan({ voicePartId: 's1', status: 'enough' }),
              plan({ voicePartId: 'a1', status: 'not-started' }),
            ],
          }),
        ],
      }),
      { voicePartId: 's1' },
    )

    expect(result).toBeNull()
  })

  it('when no part is selected, prefers in-progress work on any live part', () => {
    const result = suggestNext(
      project({
        voiceRoster: [
          part({ id: 'ghost', name: 'Lead Ghost', shortLabel: 'G', isGhost: true }),
          part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' }),
          part({ id: 'a1', name: 'Alto 1', shortLabel: 'A1' }),
        ],
        phrases: [
          phrase({
            id: 'p1',
            startMs: 0,
            endMs: 1000,
            partPlan: [
              plan({ voicePartId: 's1', status: 'not-started' }),
              plan({ voicePartId: 'a1', status: 'in-progress' }),
            ],
          }),
        ],
      }),
    )

    expect(result).toEqual({ voicePartId: 'a1', phraseId: 'p1' })
  })

  it('when no part is selected and nothing is in-progress, uses the first live roster part with remaining work', () => {
    const result = suggestNext(
      project({
        voiceRoster: [
          part({ id: 'ghost', name: 'Lead Ghost', shortLabel: 'G', isGhost: true }),
          part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' }),
          part({ id: 'a1', name: 'Alto 1', shortLabel: 'A1' }),
        ],
        phrases: [
          phrase({
            id: 'p1',
            startMs: 0,
            endMs: 1000,
            partPlan: [
              plan({ voicePartId: 's1', status: 'enough' }),
              plan({ voicePartId: 'a1', status: 'not-started' }),
            ],
          }),
        ],
      }),
    )

    expect(result).toEqual({ voicePartId: 'a1', phraseId: 'p1' })
  })

  it('still offers a cell when takeCount meets target until the singer marks enough', () => {
    const result = suggestNext(
      project({
        voiceRoster: [part({ id: 's1', targetTakes: 2 })],
        phrases: [phrase({ id: 'p1' })],
        takes: [
          take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 }),
          take({ id: 't2', phraseId: 'p1', voicePartId: 's1', takeIndex: 2 }),
        ],
      }),
      { voicePartId: 's1' },
    )

    expect(result).toEqual({ voicePartId: 's1', phraseId: 'p1' })
  })

  it('returns null when there are no phrases or no live parts', () => {
    expect(suggestNext(createEmptyProject())).toBeNull()
    expect(
      suggestNext(
        project({
          voiceRoster: [part({ id: 'ghost', isGhost: true })],
          phrases: [phrase({ id: 'p1' })],
        }),
      ),
    ).toBeNull()
  })
})

describe('markEnough', () => {
  it('sets PhrasePartPlan.status to enough', () => {
    const before = project({
      voiceRoster: [part({ id: 's1' })],
      phrases: [
        phrase({
          id: 'p1',
          partPlan: [plan({ voicePartId: 's1', status: 'in-progress' })],
        }),
      ],
    })

    const after = markEnough(before, 'p1', 's1')
    expect(after.phrases[0]?.partPlan[0]?.status).toBe('enough')
    expect(before.phrases[0]?.partPlan[0]?.status).toBe('in-progress')
  })

  it('creates a plan row when the phrase has none for that part', () => {
    const after = markEnough(
      project({
        voiceRoster: [part({ id: 's1', targetTakes: 3 })],
        phrases: [phrase({ id: 'p1' })],
      }),
      'p1',
      's1',
    )

    expect(after.phrases[0]?.partPlan).toEqual([
      {
        voicePartId: 's1',
        priority: 0,
        targetTakes: 3,
        requiredGuide: ['ghost'],
        status: 'enough',
      },
    ])
  })
})

describe('reopenEnough', () => {
  it('resets enough cells to in-progress and raises targetTakes so another take is requested', () => {
    const before = project({
      voiceRoster: [part({ id: 's1' })],
      phrases: [
        phrase({
          id: 'p1',
          partPlan: [plan({ voicePartId: 's1', status: 'enough', targetTakes: 4 })],
        }),
        phrase({
          id: 'p2',
          startMs: 2000,
          endMs: 3000,
          partPlan: [plan({ voicePartId: 's1', status: 'enough', targetTakes: 4 })],
        }),
      ],
      takes: [
        take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 }),
        take({ id: 't2', phraseId: 'p1', voicePartId: 's1', takeIndex: 2 }),
        take({ id: 't3', phraseId: 'p1', voicePartId: 's1', takeIndex: 3 }),
        take({ id: 't4', phraseId: 'p1', voicePartId: 's1', takeIndex: 4 }),
      ],
    })

    const after = reopenEnough(before, 's1')
    expect(after.phrases[0]?.partPlan[0]).toEqual(
      expect.objectContaining({ status: 'in-progress', targetTakes: 5 }),
    )
    expect(after.phrases[1]?.partPlan[0]).toEqual(
      expect.objectContaining({ status: 'in-progress', targetTakes: 4 }),
    )
    expect(suggestNext(after, { voicePartId: 's1' })).toEqual({
      voicePartId: 's1',
      phraseId: 'p1',
    })
  })

  it('leaves final cells and other parts alone', () => {
    const before = project({
      voiceRoster: [part({ id: 's1' }), part({ id: 'a1' })],
      phrases: [
        phrase({
          id: 'p1',
          partPlan: [
            plan({ voicePartId: 's1', status: 'final' }),
            plan({ voicePartId: 'a1', status: 'enough' }),
          ],
        }),
      ],
    })

    const after = reopenEnough(before, 's1')
    expect(after.phrases[0]?.partPlan).toEqual(before.phrases[0]?.partPlan)
  })
})

describe('markInProgress', () => {
  it('sets not-started plan rows to in-progress', () => {
    const after = markInProgress(
      project({
        voiceRoster: [part({ id: 's1' })],
        phrases: [
          phrase({
            id: 'p1',
            partPlan: [plan({ voicePartId: 's1', status: 'not-started' })],
          }),
        ],
      }),
      'p1',
      's1',
    )

    expect(after.phrases[0]?.partPlan[0]?.status).toBe('in-progress')
  })

  it('does not downgrade enough or final', () => {
    const enough = project({
      voiceRoster: [part({ id: 's1' })],
      phrases: [
        phrase({
          id: 'p1',
          partPlan: [plan({ voicePartId: 's1', status: 'enough' })],
        }),
      ],
    })
    expect(markInProgress(enough, 'p1', 's1').phrases[0]?.partPlan[0]?.status).toBe('enough')

    const fin = project({
      voiceRoster: [part({ id: 's1' })],
      phrases: [
        phrase({
          id: 'p1',
          partPlan: [plan({ voicePartId: 's1', status: 'final' })],
        }),
      ],
    })
    expect(markInProgress(fin, 'p1', 's1').phrases[0]?.partPlan[0]?.status).toBe('final')
  })
})
