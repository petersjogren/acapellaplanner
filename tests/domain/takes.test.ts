import { describe, expect, it } from 'vitest'
import { createEmptyProject, type Take } from '../../src/domain/schemas.ts'
import { findTake, rateTake, removeTake } from '../../src/domain/takes.ts'

function sampleTake(overrides: Partial<Take> = {}): Take {
  return {
    id: 't1',
    phraseId: 'p1',
    voicePartId: 's1',
    takeIndex: 1,
    audioBlobId: 'blob-1',
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: 0,
    ...overrides,
  }
}

describe('takes', () => {
  it('removeTake drops the take and returns its audio blob id', () => {
    const base = createEmptyProject('Song')
    const project = {
      ...base,
      takes: [sampleTake(), sampleTake({ id: 't2', takeIndex: 2, audioBlobId: 'blob-2' })],
    }
    const result = removeTake(project, 't1')
    expect(result.audioBlobId).toBe('blob-1')
    expect(result.project.takes.map((item) => item.id)).toEqual(['t2'])
  })

  it('removeTake is a no-op for unknown ids', () => {
    const project = createEmptyProject('Song')
    const result = removeTake(project, 'missing')
    expect(result.audioBlobId).toBeNull()
    expect(result.project).toBe(project)
  })

  it('rateTake sets keeper/scratch', () => {
    const base = createEmptyProject('Song')
    const project = { ...base, takes: [sampleTake()] }
    expect(rateTake(project, 't1', 'keeper').takes[0]?.rating).toBe('keeper')
    expect(findTake(rateTake(project, 't1', 'scratch'), 't1')?.rating).toBe('scratch')
  })
})
