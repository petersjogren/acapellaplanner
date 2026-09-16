import { describe, expect, it } from 'vitest'
import { addPhrase, removePhrase } from '../../src/domain/phrases.ts'
import {
  addSection,
  phrasesInSection,
  removeSection,
  sectionWindowMs,
  updateSection,
} from '../../src/domain/sections.ts'
import { createEmptyProject, type Project } from '../../src/domain/schemas.ts'

function withPhrases(count: number, widthMs = 1000): Project {
  let project = createEmptyProject()
  for (let i = 0; i < count; i++) {
    project = addPhrase(project, {
      startMs: i * widthMs,
      endMs: (i + 1) * widthMs,
      name: `Phrase ${i + 1}`,
    })
  }
  return project
}

function ids(project: Project): string[] {
  return project.phrases.map((item) => item.id)
}

describe('addSection (stable project)', () => {
  it('adds a fixed-tempo section spanning phrases', () => {
    const base = withPhrases(3)
    const [from, , to] = ids(base)
    const project = addSection(base, {
      name: 'Verse',
      timeMode: 'fixed-tempo',
      fixedBpm: 120,
      fromPhraseId: from!,
      toPhraseId: to!,
      clickEnabled: true,
    })
    expect(project.sections).toHaveLength(1)
    expect(project.sections[0]).toEqual(
      expect.objectContaining({
        name: 'Verse',
        timeMode: 'fixed-tempo',
        fixedBpm: 120,
        fromPhraseId: from,
        toPhraseId: to,
        clickEnabled: true,
      }),
    )
    expect(phrasesInSection(project.sections[0]!, project.phrases).map((item) => item.name)).toEqual([
      'Phrase 1',
      'Phrase 2',
      'Phrase 3',
    ])
  })

  it('forces click off for follow-the-ghost sections', () => {
    const base = withPhrases(1)
    const project = addSection(base, {
      name: 'Intro',
      timeMode: 'ghost-follow',
      fromPhraseId: ids(base)[0]!,
      toPhraseId: ids(base)[0]!,
      clickEnabled: true,
    })
    expect(project.sections[0]).toEqual(
      expect.objectContaining({
        name: 'Intro',
        timeMode: 'ghost-follow',
        clickEnabled: false,
      }),
    )
    expect(project.sections[0]?.fixedBpm).toBeUndefined()
  })

  it('rejects in-time sections without bpm', () => {
    const base = withPhrases(1)
    expect(() =>
      addSection(base, {
        name: 'Chorus',
        timeMode: 'fixed-tempo',
        fromPhraseId: ids(base)[0]!,
        toPhraseId: ids(base)[0]!,
        clickEnabled: true,
      }),
    ).toThrow(/bpm/i)
  })

  it('rejects a from-phrase that is after the to-phrase', () => {
    const base = withPhrases(2)
    const [first, second] = ids(base)
    expect(() =>
      addSection(base, {
        name: 'Verse',
        timeMode: 'ghost-follow',
        fromPhraseId: second!,
        toPhraseId: first!,
        clickEnabled: false,
      }),
    ).toThrow(/after to-phrase/i)
  })

  it('rejects a missing phrase', () => {
    const base = withPhrases(1)
    expect(() =>
      addSection(base, {
        name: 'Verse',
        timeMode: 'ghost-follow',
        fromPhraseId: ids(base)[0]!,
        toPhraseId: 'missing',
        clickEnabled: false,
      }),
    ).toThrow(/missing phrase/i)
  })

  it('throws on overlapping spans and leaves the original project unchanged', () => {
    const base = withPhrases(3)
    const [p1, p2, p3] = ids(base)
    const project = addSection(base, {
      name: 'A',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p2!,
      clickEnabled: false,
    })
    expect(() =>
      addSection(project, {
        name: 'B',
        timeMode: 'ghost-follow',
        fromPhraseId: p2!,
        toPhraseId: p3!,
        clickEnabled: false,
      }),
    ).toThrow(/overlap/i)
    expect(project.sections).toHaveLength(1)
  })

  it('allows adjacent sections that share no phrase', () => {
    const base = withPhrases(2)
    const [p1, p2] = ids(base)
    let project = addSection(base, {
      name: 'A',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p1!,
      clickEnabled: false,
    })
    project = addSection(project, {
      name: 'B',
      timeMode: 'ghost-follow',
      fromPhraseId: p2!,
      toPhraseId: p2!,
      clickEnabled: false,
    })
    expect(project.sections.map((item) => item.name)).toEqual(['A', 'B'])
  })
})

describe('sectionWindowMs', () => {
  it('includes the first head start and the last tail', () => {
    let project = withPhrases(2)
    const [p1, p2] = ids(project)
    project = {
      ...project,
      phrases: project.phrases.map((item) =>
        item.id === p1 ? { ...item, preRollMs: 250 } : item.id === p2 ? { ...item, postRollMs: 100 } : item,
      ),
    }
    const section = addSection(project, {
      name: 'Verse',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p2!,
      clickEnabled: false,
    }).sections[0]!
    expect(sectionWindowMs(section, project.phrases)).toEqual({ startMs: 0, endMs: 2100 })
  })

  it('clamps a 2000 ms head start when the first phrase starts at 0', () => {
    const project = withPhrases(1)
    const [p1] = ids(project)
    expect(project.phrases[0]).toMatchObject({ startMs: 0, preRollMs: 2000, postRollMs: 2000 })
    const section = addSection(project, {
      name: 'Intro',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p1!,
      clickEnabled: false,
    }).sections[0]!
    expect(sectionWindowMs(section, project.phrases)).toEqual({ startMs: 0, endMs: 3000 })
  })
})

describe('updateSection / removeSection', () => {
  it('updates and removes a section', () => {
    const base = withPhrases(2)
    const [p1, p2] = ids(base)
    let project = addSection(base, {
      name: 'Verse',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p2!,
      clickEnabled: false,
    })
    const id = project.sections[0]!.id
    project = updateSection(project, id, { name: 'Bridge', toPhraseId: p1 })
    expect(project.sections[0]).toEqual(expect.objectContaining({ id, name: 'Bridge', toPhraseId: p1 }))
    project = removeSection(project, id)
    expect(project.sections).toEqual([])
  })

  it('rejects an update that would overlap another section', () => {
    const base = withPhrases(3)
    const [p1, p2, p3] = ids(base)
    let project = addSection(base, {
      name: 'A',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p1!,
      clickEnabled: false,
    })
    project = addSection(project, {
      name: 'B',
      timeMode: 'ghost-follow',
      fromPhraseId: p3!,
      toPhraseId: p3!,
      clickEnabled: false,
    })
    const id = project.sections[1]!.id
    expect(() => updateSection(project, id, { fromPhraseId: p1, toPhraseId: p2 })).toThrow(/overlap/i)
    expect(project.sections[1]?.fromPhraseId).toBe(p3)
  })
})

describe('removePhrase retargets sections', () => {
  it('drops a section whose only phrase was deleted', () => {
    const base = withPhrases(1)
    const [p1] = ids(base)
    const project = addSection(base, {
      name: 'Intro',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p1!,
      clickEnabled: false,
    })
    expect(removePhrase(project, p1!).sections).toEqual([])
  })

  it('slides from/to onto remaining members', () => {
    const base = withPhrases(3)
    const [p1, p2, p3] = ids(base)
    const project = addSection(base, {
      name: 'Verse',
      timeMode: 'ghost-follow',
      fromPhraseId: p1!,
      toPhraseId: p3!,
      clickEnabled: false,
    })
    const afterFrom = removePhrase(project, p1!)
    expect(afterFrom.sections[0]).toEqual(
      expect.objectContaining({ fromPhraseId: p2, toPhraseId: p3 }),
    )
    const afterTo = removePhrase(project, p3!)
    expect(afterTo.sections[0]).toEqual(
      expect.objectContaining({ fromPhraseId: p1, toPhraseId: p2 }),
    )
  })
})
