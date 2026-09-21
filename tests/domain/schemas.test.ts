import { describe, expect, it } from 'vitest'
import {
  assertNoPhraseOverlap,
  assertNoSectionOverlap,
  createEmptyProject,
  PhraseSchema,
  ProjectSchema,
  SectionSchema,
  VoicePartSchema,
  validatePhrases,
  validateSections,
} from '../../src/domain/schemas.ts'

function phrase(overrides: { id: string; startMs: number; endMs: number }) {
  return {
    id: overrides.id,
    name: overrides.id,
    startMs: overrides.startMs,
    endMs: overrides.endMs,
    partPlan: [],
    loopDefault: { mode: 'phrase-loop' as const, gapMs: 400 },
    postRollMs: 0,
  }
}

function section(overrides: { id: string; fromPhraseId: string; toPhraseId: string }) {
  return {
    id: overrides.id,
    name: overrides.id,
    timeMode: 'ghost-follow' as const,
    fromPhraseId: overrides.fromPhraseId,
    toPhraseId: overrides.toPhraseId,
    clickEnabled: false,
  }
}

describe('createEmptyProject', () => {
  it('parses as a valid Project with defaults', () => {
    const project = createEmptyProject()
    const parsed = ProjectSchema.parse(project)

    expect(parsed.schemaVersion).toBe(3)
    expect(parsed.title).toBe('Untitled song')
    expect(parsed.defaultTuningHz).toBe(440)
    expect(parsed.ghostTrackId).toBeNull()
    expect(parsed.voiceRoster).toEqual([])
    expect(parsed.sections).toEqual([])
    expect(parsed.phrases).toEqual([])
    expect(parsed.guides).toEqual([])
    expect(parsed.sheetDocs).toEqual([])
    expect(parsed.sheetCrops).toEqual([])
    expect(parsed.takes).toEqual([])
    expect(parsed.mixPresets).toEqual([])
    expect(parsed.completion.cells).toEqual([])
    expect(parsed.settings.language).toBe('en')
    expect(parsed.id.length).toBeGreaterThan(0)
    expect(parsed.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(parsed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('uses the provided title', () => {
    expect(createEmptyProject('When I Fall').title).toBe('When I Fall')
  })

  it('assigns a unique id per project', () => {
    expect(createEmptyProject().id).not.toBe(createEmptyProject().id)
  })

  it('accepts optional ghostMeta on settings', () => {
    const project = {
      ...createEmptyProject(),
      ghostTrackId: 'blob-1',
      settings: {
        language: 'en',
        ghostMeta: { filename: 'lead.wav', durationMs: 83400 },
      },
    }

    expect(ProjectSchema.parse(project).settings.ghostMeta).toEqual({
      filename: 'lead.wav',
      durationMs: 83400,
    })
  })

  it('rejects a project missing schemaVersion (use migrateAndParseProject for untrusted data)', () => {
    const { schemaVersion: _drop, ...withoutVersion } = createEmptyProject()
    expect(ProjectSchema.safeParse(withoutVersion).success).toBe(false)
  })
})

describe('phrase overlap', () => {
  it('rejects overlapping phrases', () => {
    const phrases = [
      phrase({ id: 'a', startMs: 0, endMs: 1000 }),
      phrase({ id: 'b', startMs: 500, endMs: 1500 }),
    ]
    const project = { ...createEmptyProject(), phrases }

    expect(ProjectSchema.safeParse(project).success).toBe(false)
    expect(() => assertNoPhraseOverlap(phrases)).toThrow()
    expect(() => validatePhrases(phrases)).toThrow()
  })

  it('allows adjacent phrases that only touch endpoints', () => {
    const phrases = [
      phrase({ id: 'a', startMs: 0, endMs: 1000 }),
      phrase({ id: 'b', startMs: 1000, endMs: 2000 }),
    ]
    const project = { ...createEmptyProject(), phrases }

    expect(ProjectSchema.safeParse(project).success).toBe(true)
    expect(() => assertNoPhraseOverlap(phrases)).not.toThrow()
    expect(() => validatePhrases(phrases)).not.toThrow()
  })

  it('rejects nested overlapping phrases', () => {
    const phrases = [
      phrase({ id: 'outer', startMs: 0, endMs: 2000 }),
      phrase({ id: 'inner', startMs: 250, endMs: 500 }),
    ]
    const project = { ...createEmptyProject(), phrases }

    expect(ProjectSchema.safeParse(project).success).toBe(false)
    expect(() => assertNoPhraseOverlap(phrases)).toThrow()
  })
})

describe('section overlap', () => {
  it('rejects overlapping sections', () => {
    const phrases = [
      phrase({ id: 'p1', startMs: 0, endMs: 1000 }),
      phrase({ id: 'p2', startMs: 1000, endMs: 2000 }),
      phrase({ id: 'p3', startMs: 2000, endMs: 3000 }),
    ]
    const sections = [
      section({ id: 'a', fromPhraseId: 'p1', toPhraseId: 'p2' }),
      section({ id: 'b', fromPhraseId: 'p2', toPhraseId: 'p3' }),
    ]
    const project = { ...createEmptyProject(), phrases, sections }

    expect(ProjectSchema.safeParse(project).success).toBe(false)
    expect(() => assertNoSectionOverlap(sections, phrases)).toThrow()
    expect(() => validateSections(sections, phrases)).toThrow()
  })

  it('allows adjacent sections that share no phrase', () => {
    const phrases = [
      phrase({ id: 'p1', startMs: 0, endMs: 1000 }),
      phrase({ id: 'p2', startMs: 1000, endMs: 2000 }),
    ]
    const sections = [
      section({ id: 'a', fromPhraseId: 'p1', toPhraseId: 'p1' }),
      section({ id: 'b', fromPhraseId: 'p2', toPhraseId: 'p2' }),
    ]
    const project = { ...createEmptyProject(), phrases, sections }

    expect(ProjectSchema.safeParse(project).success).toBe(true)
    expect(() => assertNoSectionOverlap(sections, phrases)).not.toThrow()
    expect(() => validateSections(sections, phrases)).not.toThrow()
  })

  it('rejects nested overlapping sections', () => {
    const phrases = [
      phrase({ id: 'p1', startMs: 0, endMs: 1000 }),
      phrase({ id: 'p2', startMs: 1000, endMs: 2000 }),
      phrase({ id: 'p3', startMs: 2000, endMs: 3000 }),
    ]
    const sections = [
      section({ id: 'outer', fromPhraseId: 'p1', toPhraseId: 'p3' }),
      section({ id: 'inner', fromPhraseId: 'p2', toPhraseId: 'p2' }),
    ]
    const project = { ...createEmptyProject(), phrases, sections }

    expect(ProjectSchema.safeParse(project).success).toBe(false)
    expect(() => assertNoSectionOverlap(sections, phrases)).toThrow()
  })
})

describe('schema parse failures', () => {
  it('rejects an invalid section timeMode', () => {
    const result = SectionSchema.safeParse({
      id: 's1',
      name: 'Verse',
      timeMode: 'rubato',
      fromPhraseId: 'p1',
      toPhraseId: 'p1',
      clickEnabled: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    expect(ProjectSchema.safeParse({}).success).toBe(false)
    expect(VoicePartSchema.safeParse({ id: 'v1' }).success).toBe(false)
  })

  it('rejects a phrase whose startMs is not before endMs', () => {
    expect(PhraseSchema.safeParse(phrase({ id: 'a', startMs: 1000, endMs: 500 })).success).toBe(
      false,
    )
    expect(() => validatePhrases([phrase({ id: 'a', startMs: 1000, endMs: 1000 })])).toThrow()
  })

  it('rejects a section whose from-phrase is after its to-phrase', () => {
    const phrases = [
      phrase({ id: 'a', startMs: 0, endMs: 1000 }),
      phrase({ id: 'b', startMs: 1000, endMs: 2000 }),
    ]
    expect(() =>
      validateSections([section({ id: 's', fromPhraseId: 'b', toPhraseId: 'a' })], phrases),
    ).toThrow(/after to-phrase/)
  })
})
