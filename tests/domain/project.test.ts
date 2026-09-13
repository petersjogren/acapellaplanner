import { describe, expect, it } from 'vitest'
import {
  GHOST_DURATION_TOLERANCE_MS,
  phrasesBeyondGhost,
  reconcileGhostDuration,
  renameProject,
} from '../../src/domain/project.ts'
import { createEmptyProject, type Phrase, type Project } from '../../src/domain/schemas.ts'

function phrase(id: string, name: string, startMs: number, endMs: number): Phrase {
  return {
    id,
    name,
    startMs,
    endMs,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
  }
}

function withGhost(durationMs: number, phrases: Phrase[] = []): Project {
  const base = createEmptyProject('Song')
  return {
    ...base,
    phrases,
    ghostTrackId: 'ghost-blob',
    settings: { ...base.settings, ghostMeta: { filename: 'ghost.wav', durationMs } },
  }
}

describe('renameProject', () => {
  it('trims the new title', () => {
    expect(renameProject(createEmptyProject('Old'), '  Autumn Leaves  ').title).toBe('Autumn Leaves')
  })

  it('rejects a blank title', () => {
    expect(() => renameProject(createEmptyProject('Old'), '   ')).toThrow(/song name is required/i)
  })
})

describe('reconcileGhostDuration', () => {
  it('replaces stale metadata that outlives the real audio', () => {
    const project = withGhost(30_000)
    const fixed = reconcileGhostDuration(project, 2_500)
    expect(fixed.settings.ghostMeta?.durationMs).toBe(2_500)
    expect(fixed.settings.ghostMeta?.filename).toBe('ghost.wav')
  })

  it('replaces metadata that understates the real audio', () => {
    expect(reconcileGhostDuration(withGhost(2_500), 30_000).settings.ghostMeta?.durationMs).toBe(
      30_000,
    )
  })

  it('returns the same object when the difference is within tolerance', () => {
    const project = withGhost(10_000)
    expect(reconcileGhostDuration(project, 10_000 + GHOST_DURATION_TOLERANCE_MS)).toBe(project)
  })

  it('ignores a project with no ghost metadata', () => {
    const project = createEmptyProject('No ghost')
    expect(reconcileGhostDuration(project, 5_000)).toBe(project)
  })

  it('ignores a failed or zero-length decode', () => {
    const project = withGhost(30_000)
    expect(reconcileGhostDuration(project, 0)).toBe(project)
    expect(reconcileGhostDuration(project, Number.NaN)).toBe(project)
  })
})

describe('phrasesBeyondGhost', () => {
  it('finds phrases that run past the real ghost audio', () => {
    const project = withGhost(30_000, [
      phrase('p1', 'Phrase 1', 0, 10_000),
      phrase('p2', 'Phrase 2', 10_000, 20_000),
    ])
    // Ghost really only decodes to 2.5s: both phrases are stranded.
    expect(phrasesBeyondGhost(project, 2_500).map((item) => item.id)).toEqual(['p1', 'p2'])
    // With the full 30s of audio, none are.
    expect(phrasesBeyondGhost(project, 30_000)).toEqual([])
  })

  it('treats a phrase ending exactly at the ghost end as playable', () => {
    const project = withGhost(10_000, [phrase('p1', 'Phrase 1', 0, 10_000)])
    expect(phrasesBeyondGhost(project, 10_000)).toEqual([])
  })

  it('returns nothing for an unusable duration', () => {
    const project = withGhost(10_000, [phrase('p1', 'Phrase 1', 0, 10_000)])
    expect(phrasesBeyondGhost(project, 0)).toEqual([])
  })
})
