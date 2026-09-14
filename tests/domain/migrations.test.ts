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
    expect(migrated.schemaVersion).toBe(2)
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
})
