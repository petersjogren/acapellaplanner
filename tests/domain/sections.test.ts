import { describe, expect, it } from 'vitest'
import { addSection, removeSection, updateSection } from '../../src/domain/sections.ts'
import { createEmptyProject } from '../../src/domain/schemas.ts'

describe('addSection', () => {
  it('adds a fixed-tempo section with click', () => {
    const project = addSection(createEmptyProject(), {
      name: 'Tag',
      timeMode: 'fixed-tempo',
      fixedBpm: 120,
      startMs: 0,
      endMs: 8000,
      clickEnabled: true,
    })
    expect(project.sections).toHaveLength(1)
    expect(project.sections[0]).toEqual(
      expect.objectContaining({
        name: 'Tag',
        timeMode: 'fixed-tempo',
        fixedBpm: 120,
        startMs: 0,
        endMs: 8000,
        clickEnabled: true,
      }),
    )
    expect(project.sections[0]?.id.length).toBeGreaterThan(0)
  })

  it('forces click off for follow-the-ghost sections', () => {
    const project = addSection(createEmptyProject(), {
      name: 'Intro',
      timeMode: 'ghost-follow',
      startMs: 0,
      endMs: 4000,
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
    expect(() =>
      addSection(createEmptyProject(), {
        name: 'Chorus',
        timeMode: 'fixed-tempo',
        startMs: 0,
        endMs: 1000,
        clickEnabled: true,
      }),
    ).toThrow(/bpm/i)
  })
})

describe('updateSection / removeSection', () => {
  it('updates and removes a section', () => {
    let project = addSection(createEmptyProject(), {
      name: 'Verse',
      timeMode: 'ghost-follow',
      startMs: 0,
      endMs: 2000,
      clickEnabled: false,
    })
    const id = project.sections[0]!.id
    project = updateSection(project, id, { name: 'Bridge', endMs: 3000 })
    expect(project.sections[0]).toEqual(
      expect.objectContaining({ id, name: 'Bridge', endMs: 3000 }),
    )
    project = removeSection(project, id)
    expect(project.sections).toEqual([])
  })
})
