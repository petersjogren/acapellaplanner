import { CURRENT_SCHEMA_VERSION, ProjectSchema, type Project } from './schemas.ts'

/**
 * One step per schemaVersion bump: takes the raw (not-yet-validated) shape
 * at version N and returns the raw shape at version N+1. Steps run in order
 * from whatever version the data claims up to CURRENT_SCHEMA_VERSION, then
 * the result is validated once by ProjectSchema.
 *
 * Keep steps small and additive (rename a field, backfill a default, split
 * one field into two) — each one is independently unit-testable against a
 * fixture of the old shape, and ProjectSchema only ever has to describe the
 * current version, not every version that ever existed.
 *
 * Add the next step here when CURRENT_SCHEMA_VERSION bumps, e.g.:
 *   2: (raw) => ({ ...raw, newRequiredField: legacyDefaultFor(raw) }),
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (raw) => ({ ...raw, /* v1 -> v2 changes */ }),
}

export class UnsupportedProjectVersionError extends Error {
  readonly foundVersion: number
  readonly supportedVersion: number

  constructor(foundVersion: number, supportedVersion: number) {
    super(
      `This song was saved by a newer version of Acapella Planner (format v${foundVersion}, this app supports up to v${supportedVersion}). Update the app to open it.`,
    )
    this.name = 'UnsupportedProjectVersionError'
    this.foundVersion = foundVersion
    this.supportedVersion = supportedVersion
  }
}

/**
 * Every project.json that predates schemaVersion (all of them, as of the
 * field's introduction) is implicitly v1 — stamp that in before running any
 * migrations or validation ever sees the data.
 */
function withVersionStamped(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return raw as Record<string, unknown>
  const obj = raw as Record<string, unknown>
  if (typeof obj.schemaVersion === 'number') return obj
  return { ...obj, schemaVersion: 1 }
}

/**
 * Migrate raw (untrusted, not-yet-validated) project data up to
 * CURRENT_SCHEMA_VERSION and validate it. Use this instead of calling
 * ProjectSchema.parse() directly on anything that did not just come out of
 * createEmptyProject() in this same running app — IndexedDB rows and
 * imported zips both need to survive schema changes across app versions.
 */
export function migrateAndParseProject(raw: unknown): Project {
  let data = withVersionStamped(raw)
  const foundVersion = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0

  if (foundVersion > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedProjectVersionError(foundVersion, CURRENT_SCHEMA_VERSION)
  }

  for (let version = foundVersion; version < CURRENT_SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version]
    if (!step) break
    data = { ...step(data), schemaVersion: version + 1 }
  }

  return ProjectSchema.parse(data)
}
