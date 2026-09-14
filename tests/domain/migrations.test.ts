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

  it('stamps schemaVersion 1 onto data saved before the field existed', () => {
    // Every project.json exported (or IndexedDB row saved) before
    // schemaVersion was introduced looks exactly like this: same shape,
    // just missing the field entirely.
    const { schemaVersion: _drop, ...legacyShape } = createEmptyProject('Old Song')

    const migrated = migrateAndParseProject(legacyShape)

    expect(migrated.schemaVersion).toBe(1)
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
})
