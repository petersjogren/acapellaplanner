import { describe, expect, it } from 'vitest'
import {
  assertNoPhraseOverlap,
  createEmptyProject,
  PhraseSchema,
  ProjectSchema,
  SectionSchema,
  VoicePartSchema,
  validatePhrases,
} from '../../src/domain/schemas.ts'

function phrase(overrides: { id: string; startMs: number; endMs: number }) {
  return {
    id: overrides.id,
    name: overrides.id,
    startMs: overrides.startMs,
    endMs: overrides.endMs,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop' as const, gapMs: 400 },
    postRollMs: 0,
  }
}

describe('createEmptyProject', () => {
  it('parses as a valid Project with defaults', () => {
    const project = createEmptyProject()
    const parsed = ProjectSchema.parse(project)

    expect(parsed.title).toBe('Untitled song')
    expect(parsed.defaultTuningHz).toBe(440)
    expect(parsed.ghostTrackId).toBeNull()
    expect(parsed.voiceRoster).toEqual([])
    expect(parsed.sections).toEqual([])
    expect(parsed.phrases).toEqual([])
    expect(parsed.guides).toEqual([])
    expect(parsed.sheetDocs).toEqual([])
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

describe('schema parse failures', () => {
  it('rejects an invalid section timeMode', () => {
    const result = SectionSchema.safeParse({
      id: 's1',
      name: 'Verse',
      timeMode: 'rubato',
      startMs: 0,
      endMs: 1000,
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
})
