import { describe, expect, it } from 'vitest'
import { cellKey, deriveCompletion } from '../../src/domain/completion.ts'
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

function cellOf(
  state: ReturnType<typeof deriveCompletion>,
  phraseId: string,
  voicePartId: string,
) {
  return state.cells.find(
    (item) => item.phraseId === phraseId && item.voicePartId === voicePartId,
  )
}

describe('cellKey', () => {
  it('joins phrase and voice part ids', () => {
    expect(cellKey('phrase-1', 'alto-2')).toBe('phrase-1:alto-2')
  })
})

describe('deriveCompletion', () => {
  it('returns no cells for an empty project', () => {
    expect(deriveCompletion(createEmptyProject()).cells).toEqual([])
  })

  it('builds a not-started cell for 1 phrase × 1 part with 0 takes, without partPlan rows', () => {
    const state = deriveCompletion(
      project({
        voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })],
        phrases: [phrase({ id: 'p1', name: 'when I fall' })],
      }),
    )

    expect(state.cells).toEqual([
      {
        phraseId: 'p1',
        voicePartId: 's1',
        takeCount: 0,
        keeperCount: 0,
        status: 'not-started',
      },
    ])
  })

  it('increments takeCount and moves not-started → in-progress → enough', () => {
    const roster = [part({ id: 's1', targetTakes: 4 })]
    const phrases = [phrase({ id: 'p1' })]
    const base = project({ voiceRoster: roster, phrases })

    expect(cellOf(deriveCompletion(base), 'p1', 's1')?.status).toBe('not-started')

    const oneTake = deriveCompletion({
      ...base,
      takes: [take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 })],
    })
    expect(cellOf(oneTake, 'p1', 's1')).toMatchObject({
      takeCount: 1,
      keeperCount: 0,
      status: 'in-progress',
    })

    const fourTakes = deriveCompletion({
      ...base,
      takes: [1, 2, 3, 4].map((takeIndex) =>
        take({ id: `t${takeIndex}`, phraseId: 'p1', voicePartId: 's1', takeIndex }),
      ),
    })
    expect(cellOf(fourTakes, 'p1', 's1')).toMatchObject({
      takeCount: 4,
      status: 'enough',
    })
  })

  it('counts keepers separately from scratch and numeric ratings', () => {
    const state = deriveCompletion(
      project({
        voiceRoster: [part({ id: 's1' })],
        phrases: [phrase({ id: 'p1' })],
        takes: [
          take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1, rating: 'keeper' }),
          take({ id: 't2', phraseId: 'p1', voicePartId: 's1', takeIndex: 2, rating: 'scratch' }),
          take({ id: 't3', phraseId: 'p1', voicePartId: 's1', takeIndex: 3, rating: 5 }),
          take({ id: 't4', phraseId: 'p1', voicePartId: 's1', takeIndex: 4 }),
        ],
      }),
    )

    expect(cellOf(state, 'p1', 's1')).toMatchObject({
      takeCount: 4,
      keeperCount: 1,
      status: 'enough',
    })
  })

  it('uses part targetTakes to decide enough, and PhrasePartPlan.targetTakes when present', () => {
    const roster = [part({ id: 's1', targetTakes: 3 })]
    const phrases = [phrase({ id: 'p1' })]
    const twoTakes = [
      take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 }),
      take({ id: 't2', phraseId: 'p1', voicePartId: 's1', takeIndex: 2 }),
    ]

    expect(
      cellOf(deriveCompletion(project({ voiceRoster: roster, phrases, takes: twoTakes })), 'p1', 's1')
        ?.status,
    ).toBe('in-progress')

    const withPlanTarget = deriveCompletion(
      project({
        voiceRoster: roster,
        phrases: [
          phrase({
            id: 'p1',
            partPlan: [plan({ voicePartId: 's1', targetTakes: 2, status: 'in-progress' })],
          }),
        ],
        takes: twoTakes,
      }),
    )
    expect(cellOf(withPlanTarget, 'p1', 's1')?.status).toBe('enough')
  })

  it('skips isGhost parts so the matrix is live roster × phrases', () => {
    const state = deriveCompletion(
      project({
        voiceRoster: [
          part({ id: 'ghost', name: 'Lead Ghost', shortLabel: 'G', isGhost: true }),
          part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' }),
        ],
        phrases: [phrase({ id: 'p1' }), phrase({ id: 'p2' })],
      }),
    )

    expect(state.cells.map((item) => cellKey(item.phraseId, item.voicePartId))).toEqual([
      'p1:s1',
      'p2:s1',
    ])
  })

  it('uses plan.status final even with no takes', () => {
    const state = deriveCompletion(
      project({
        voiceRoster: [part({ id: 's1' })],
        phrases: [
          phrase({
            id: 'p1',
            partPlan: [plan({ voicePartId: 's1', status: 'final' })],
          }),
        ],
      }),
    )

    expect(cellOf(state, 'p1', 's1')).toMatchObject({
      takeCount: 0,
      keeperCount: 0,
      status: 'final',
    })
  })

  it('keeps plan enough only while takeCount still meets target, otherwise re-derives', () => {
    const roster = [part({ id: 's1', targetTakes: 4 })]
    const enoughPlan = [
      phrase({
        id: 'p1',
        partPlan: [plan({ voicePartId: 's1', targetTakes: 4, status: 'enough' })],
      }),
    ]

    const stillEnough = deriveCompletion(
      project({
        voiceRoster: roster,
        phrases: enoughPlan,
        takes: [1, 2, 3, 4].map((takeIndex) =>
          take({ id: `t${takeIndex}`, phraseId: 'p1', voicePartId: 's1', takeIndex }),
        ),
      }),
    )
    expect(cellOf(stillEnough, 'p1', 's1')?.status).toBe('enough')

    const dropped = deriveCompletion(
      project({
        voiceRoster: roster,
        phrases: enoughPlan,
        takes: [take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 })],
      }),
    )
    expect(cellOf(dropped, 'p1', 's1')).toMatchObject({
      takeCount: 1,
      status: 'in-progress',
    })
  })

  it('ignores takes that belong to another phrase or part', () => {
    const state = deriveCompletion(
      project({
        voiceRoster: [part({ id: 's1' }), part({ id: 'a1' })],
        phrases: [phrase({ id: 'p1' }), phrase({ id: 'p2' })],
        takes: [
          take({ id: 't1', phraseId: 'p2', voicePartId: 's1', takeIndex: 1 }),
          take({ id: 't2', phraseId: 'p1', voicePartId: 'a1', takeIndex: 1 }),
        ],
      }),
    )

    expect(cellOf(state, 'p1', 's1')).toMatchObject({ takeCount: 0, status: 'not-started' })
    expect(cellOf(state, 'p1', 'a1')).toMatchObject({ takeCount: 1, status: 'in-progress' })
    expect(cellOf(state, 'p2', 's1')).toMatchObject({ takeCount: 1, status: 'in-progress' })
    expect(cellOf(state, 'p2', 'a1')).toMatchObject({ takeCount: 0, status: 'not-started' })
  })
})
