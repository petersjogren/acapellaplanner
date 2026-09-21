import { describe, expect, it } from 'vitest'
import {
  migrateAndParseProject,
  UnsupportedProjectVersionError,
} from '../../src/domain/migrations.ts'
import { CURRENT_SCHEMA_VERSION, createEmptyProject } from '../../src/domain/schemas.ts'

describe('migrateAndParseProject', () => {
  it('passes a current-version project through unchanged', () => {
    const project = createEmptyProject('When I Fall')
    const migrated = migrateAndParseProject(project)

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migrated.title).toBe('When I Fall')
    expect(migrated.id).toBe(project.id)
  })

  it('stamps missing schemaVersion as v1 and migrates up to current', () => {
    // Every project.json exported (or IndexedDB row saved) before
    // schemaVersion was introduced looks exactly like this: same shape,
    // just missing the field entirely.
    const { schemaVersion: _drop, ...legacyShape } = createEmptyProject('Old Song')

    const migrated = migrateAndParseProject(legacyShape)

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migrated.title).toBe('Old Song')
  })

  it('rejects data from a schemaVersion newer than this app supports', () => {
    const future = { ...createEmptyProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }

    expect(() => migrateAndParseProject(future)).toThrow(UnsupportedProjectVersionError)
    try {
      migrateAndParseProject(future)
      throw new Error('expected migrateAndParseProject to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedProjectVersionError)
      const err = error as UnsupportedProjectVersionError
      expect(err.foundVersion).toBe(CURRENT_SCHEMA_VERSION + 1)
      expect(err.supportedVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(err.message).toMatch(/newer version of Acapella Planner/)
    }
  })

  it('still rejects data that fails validation after migration', () => {
    const broken = { ...createEmptyProject(), title: '' }
    expect(() => migrateAndParseProject(broken)).toThrow()
  })

  it('rejects non-object input the same way ProjectSchema would', () => {
    expect(() => migrateAndParseProject(null)).toThrow()
    expect(() => migrateAndParseProject('not a project')).toThrow()
  })

  it('rewrites v1 time-window sections into phrase spans', () => {
    const base = createEmptyProject('When I Fall')
    const v1 = {
      ...base,
      schemaVersion: 1,
      phrases: [
        {
          id: 'p1',
          name: 'Phrase 1',
          startMs: 0,
          endMs: 1000,
          sheetRefs: [],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
        {
          id: 'p2',
          name: 'Phrase 2',
          startMs: 1000,
          endMs: 2000,
          sheetRefs: [],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
        {
          id: 'p3',
          name: 'Phrase 3',
          startMs: 4000,
          endMs: 5000,
          sheetRefs: [],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
      ],
      sections: [
        {
          id: 'verse',
          name: 'Verse',
          timeMode: 'fixed-tempo',
          fixedBpm: 80,
          startMs: 0,
          endMs: 2500,
          clickEnabled: true,
        },
        {
          id: 'orphan',
          name: 'Empty stretch',
          timeMode: 'ghost-follow',
          startMs: 9000,
          endMs: 10000,
          clickEnabled: false,
        },
      ],
    }

    const migrated = migrateAndParseProject(v1)
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.sections).toEqual([
      expect.objectContaining({
        id: 'verse',
        name: 'Verse',
        timeMode: 'fixed-tempo',
        fixedBpm: 80,
        fromPhraseId: 'p1',
        toPhraseId: 'p2',
        clickEnabled: true,
      }),
    ])
    expect(migrated.sections.find((item) => item.id === 'orphan')).toBeUndefined()
  })

  it('does not fill missing preRollMs with the new-phrase default', () => {
    const migrated = migrateAndParseProject({
      ...createEmptyProject('When I Fall'),
      phrases: [
        {
          id: 'p1',
          name: 'Phrase 1',
          startMs: 0,
          endMs: 1000,
          sheetRefs: [],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
      ],
    })
    expect(migrated.phrases[0]?.preRollMs).toBeUndefined()
    expect(migrated.phrases[0]?.postRollMs).toBe(0)
  })

  it('flattens v2 phrase sheetRefs into a song film', () => {
    const refA = {
      id: 'a',
      sheetDocId: 'doc-1',
      pageIndex: 0,
      regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 },
    }
    const refB = {
      id: 'b',
      sheetDocId: 'doc-1',
      pageIndex: 0,
      regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    }
    const base = createEmptyProject('When I Fall')
    const { sheetCrops: _drop, ...withoutFilm } = base
    const v2 = {
      ...withoutFilm,
      schemaVersion: 2,
      phrases: [
        {
          id: 'p1',
          name: 'Phrase 1',
          startMs: 0,
          endMs: 1000,
          sheetRefs: [refA],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
        {
          id: 'p2',
          name: 'Phrase 2',
          startMs: 1000,
          endMs: 2000,
          sheetRefs: [refB],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
      ],
    }

    const migrated = migrateAndParseProject(v2)
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.sheetCrops).toEqual([refA, refB])
    expect(migrated.phrases[0]).not.toHaveProperty('sheetRefs')
    expect(migrated.phrases[1]).not.toHaveProperty('sheetRefs')
  })

  it('collapses consecutive identical crop geometry, but not non-consecutive repeats', () => {
    const regionA = { x: 0, y: 0, w: 0.5, h: 0.5 }
    const regionB = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    const a1 = { id: 'a1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: regionA }
    const a2 = { id: 'a2', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: regionA }
    const b = { id: 'b', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: regionB }
    const a3 = { id: 'a3', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: regionA }
    const base = createEmptyProject('When I Fall')
    const { sheetCrops: _drop, ...withoutFilm } = base
    const v2 = {
      ...withoutFilm,
      schemaVersion: 2,
      phrases: [
        {
          id: 'p1',
          name: 'Phrase 1',
          startMs: 0,
          endMs: 1000,
          sheetRefs: [a1],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
        {
          id: 'p2',
          name: 'Phrase 2',
          startMs: 1000,
          endMs: 2000,
          sheetRefs: [a2, b, a3],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
      ],
    }

    const migrated = migrateAndParseProject(v2)
    expect(migrated.sheetCrops.map((crop) => crop.id)).toEqual(['a1', 'b', 'a3'])
  })

  it('gives an empty film when no phrase had crops', () => {
    const base = createEmptyProject('When I Fall')
    const { sheetCrops: _drop, ...withoutFilm } = base
    const v2 = {
      ...withoutFilm,
      schemaVersion: 2,
      phrases: [
        {
          id: 'p1',
          name: 'Phrase 1',
          startMs: 0,
          endMs: 1000,
          sheetRefs: [],
          partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
      ],
    }
    const migrated = migrateAndParseProject(v2)
    expect(migrated.sheetCrops).toEqual([])
  })
})
