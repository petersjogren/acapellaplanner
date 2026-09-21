import { describe, expect, it } from 'vitest'
import { addPart, removePart, updatePart } from '../../src/domain/roster.ts'
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

function plan(overrides: Partial<PhrasePartPlan> & { voicePartId: string }): PhrasePartPlan {
  return {
    priority: 0,
    targetTakes: 4,
    requiredGuide: ['ghost'],
    status: 'not-started',
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
  return { ...createEmptyProject('When I Fall'), ...overrides }
}

describe('addPart', () => {
  it('appends a trimmed part with a generated id and default target takes', () => {
    const next = addPart(project(), {
      name: '  Soprano 1 ',
      shortLabel: ' S1 ',
      color: '#c23b2a',
    })
    expect(next.voiceRoster).toHaveLength(1)
    expect(next.voiceRoster[0]).toMatchObject({
      name: 'Soprano 1',
      shortLabel: 'S1',
      color: '#c23b2a',
      targetTakes: 4,
    })
    expect(next.voiceRoster[0]?.id.length).toBeGreaterThan(0)
  })

  it('keeps an existing part when adding another', () => {
    const withSoprano = addPart(project(), {
      name: 'Soprano 1',
      shortLabel: 'S1',
      color: '#c23b2a',
    })
    const next = addPart(withSoprano, { name: 'Alto 1', shortLabel: 'A1', color: '#4d6a8f' })
    expect(next.voiceRoster.map((item) => item.shortLabel)).toEqual(['S1', 'A1'])
  })

  it('rejects a duplicate short label case-insensitively after trim', () => {
    const withSoprano = addPart(project(), {
      name: 'Soprano 1',
      shortLabel: 'S1',
      color: '#c23b2a',
    })
    expect(() =>
      addPart(withSoprano, { name: 'Soprano double', shortLabel: ' s1 ', color: '#3f5d4a' }),
    ).toThrow(/already used/i)
  })
})

describe('updatePart', () => {
  it('patches fields on the matching part', () => {
    const base = project({
      voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })],
    })
    const next = updatePart(base, 's1', { name: ' Alto 1 ', shortLabel: 'A1', targetTakes: 2 })
    expect(next.voiceRoster[0]).toMatchObject({
      id: 's1',
      name: 'Alto 1',
      shortLabel: 'A1',
      targetTakes: 2,
    })
  })

  it('allows a case-only change of the same part label', () => {
    const base = project({
      voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })],
    })
    const next = updatePart(base, 's1', { shortLabel: 's1' })
    expect(next.voiceRoster[0]?.shortLabel).toBe('s1')
  })

  it('rejects renaming onto another part short label', () => {
    const base = project({
      voiceRoster: [
        part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' }),
        part({ id: 'a1', name: 'Alto 1', shortLabel: 'A1' }),
      ],
    })
    expect(() => updatePart(base, 'a1', { shortLabel: ' s1 ' })).toThrow(/already used/i)
  })
})

describe('removePart', () => {
  it('cascades takes and partPlan rows for the deleted voice part', () => {
    const base = project({
      voiceRoster: [
        part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' }),
        part({ id: 'a1', name: 'Alto 1', shortLabel: 'A1' }),
      ],
      phrases: [
        phrase({
          id: 'p1',
          partPlan: [plan({ voicePartId: 's1' }), plan({ voicePartId: 'a1', priority: 1 })],
        }),
      ],
      takes: [
        take({ id: 't-s1', phraseId: 'p1', voicePartId: 's1' }),
        take({ id: 't-a1', phraseId: 'p1', voicePartId: 'a1' }),
      ],
    })

    const next = removePart(base, 's1')
    expect(next.voiceRoster.map((item) => item.id)).toEqual(['a1'])
    expect(next.takes.map((item) => item.id)).toEqual(['t-a1'])
    expect(next.phrases[0]?.partPlan.map((row) => row.voicePartId)).toEqual(['a1'])
  })

  it('leaves the project unchanged when the part is missing', () => {
    const base = project({ voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })] })
    expect(removePart(base, 'missing')).toBe(base)
  })
})
