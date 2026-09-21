import { describe, expect, it } from 'vitest'
import {
  forkProjectForImport,
  GHOST_DURATION_TOLERANCE_MS,
  phrasesBeyondGhost,
  reconcileGhostDuration,
  renameProject,
  uniqueImportedTitle,
} from '../../src/domain/project.ts'
import { createEmptyProject, type Phrase, type Project, type Take } from '../../src/domain/schemas.ts'

function phrase(id: string, name: string, startMs: number, endMs: number): Phrase {
  return {
    id,
    name,
    startMs,
    endMs,
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

describe('uniqueImportedTitle', () => {
  it('appends "(imported)" when the base title is free', () => {
    expect(uniqueImportedTitle('Autumn Leaves', ['Autumn Leaves'])).toBe(
      'Autumn Leaves (imported)',
    )
  })

  it('counts up when "(imported)" is already taken', () => {
    expect(
      uniqueImportedTitle('Autumn Leaves', ['Autumn Leaves', 'Autumn Leaves (imported)']),
    ).toBe('Autumn Leaves (imported 2)')
    expect(
      uniqueImportedTitle('Autumn Leaves', [
        'Autumn Leaves',
        'Autumn Leaves (imported)',
        'Autumn Leaves (imported 2)',
      ]),
    ).toBe('Autumn Leaves (imported 3)')
  })
})

function take(id: string, audioBlobId: string): Take {
  return {
    id,
    phraseId: 'p1',
    voicePartId: 'soprano',
    takeIndex: 1,
    audioBlobId,
    recordedAt: new Date().toISOString(),
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: -6,
  }
}

describe('forkProjectForImport', () => {
  it('gives the fork a fresh project id, the requested title, and fresh timestamps', () => {
    const source = createEmptyProject('Soprano part')
    const { project } = forkProjectForImport(source, { title: 'Soprano part (imported)' })

    expect(project.id).not.toBe(source.id)
    expect(project.title).toBe('Soprano part (imported)')
    expect(project.createdAt).toBeTruthy()
    expect(project.updatedAt).toBeTruthy()
    // Everything else about the song (roster, sections, phrases) carries over untouched.
    expect(project.voiceRoster).toEqual(source.voiceRoster)
  })

  it('remaps the ghost blob id and reports the mapping', () => {
    const source: Project = { ...createEmptyProject('Song'), ghostTrackId: 'ghost-1' }
    const { project, blobIdMap } = forkProjectForImport(source, { title: 'Song (imported)' })

    expect(project.ghostTrackId).not.toBe('ghost-1')
    expect(project.ghostTrackId).toBe(blobIdMap.get('ghost-1'))
  })

  it('remaps every take audio blob id, keeping each take intact otherwise', () => {
    const source: Project = {
      ...createEmptyProject('Song'),
      takes: [take('take-1', 'blob-a'), take('take-2', 'blob-b')],
    }
    const { project, blobIdMap } = forkProjectForImport(source, { title: 'Song (imported)' })

    expect(project.takes).toHaveLength(2)
    expect(project.takes[0]?.id).toBe('take-1')
    expect(project.takes[0]?.audioBlobId).toBe(blobIdMap.get('blob-a'))
    expect(project.takes[1]?.audioBlobId).toBe(blobIdMap.get('blob-b'))
    expect(project.takes[0]?.audioBlobId).not.toBe('blob-a')
    // Distinct source blobs never collide on the same forked id.
    expect(project.takes[0]?.audioBlobId).not.toBe(project.takes[1]?.audioBlobId)
  })

  it('maps a blob id referenced twice to the same forked id', () => {
    const source: Project = {
      ...createEmptyProject('Song'),
      ghostTrackId: 'shared-blob',
      guides: [
        { id: 'g1', kind: 'click', audioBlobId: 'shared-blob', gainDbDefault: 0, alignToGhost: true },
      ],
    }
    const { project, blobIdMap } = forkProjectForImport(source, { title: 'Song (imported)' })

    expect(blobIdMap.size).toBe(1)
    expect(project.ghostTrackId).toBe(project.guides[0]?.audioBlobId)
  })

  it('produces two independent forks from the same source with different ids each time', () => {
    const source: Project = { ...createEmptyProject('Song'), ghostTrackId: 'ghost-1' }
    const forkA = forkProjectForImport(source, { title: 'Song (imported)' })
    const forkB = forkProjectForImport(source, { title: 'Song (imported 2)' })

    expect(forkA.project.id).not.toBe(forkB.project.id)
    expect(forkA.project.ghostTrackId).not.toBe(forkB.project.ghostTrackId)
  })
})
