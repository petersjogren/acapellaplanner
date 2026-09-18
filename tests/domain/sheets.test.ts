import { describe, expect, it } from 'vitest'
import {
  addSheetRefToPhrase,
  bindSheetRefToPhrase,
  MIN_REGION_NORM,
  regionFromDrag,
  removeSheetRefFromPhrase,
  sheetPageBlobId,
  sheetPageBlobIdsForPhrase,
  sheetScrollFrame,
} from '../../src/domain/sheets.ts'
import { createEmptyProject, type Phrase, type Project, type SheetRef } from '../../src/domain/schemas.ts'

function phrase(overrides: Partial<Phrase> & { id: string }): Phrase {
  return {
    name: overrides.name ?? overrides.id,
    startMs: 0,
    endMs: 1000,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

function projectWithPhrase(item: Phrase, extra: Partial<Project> = {}): Project {
  return { ...createEmptyProject('When I Fall'), phrases: [item], ...extra }
}

describe('regionFromDrag', () => {
  it('normalizes a drag to a 0–1 region', () => {
    expect(regionFromDrag(20, 10, 120, 60, 200, 100)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })

  it('accepts a reverse drag', () => {
    expect(regionFromDrag(120, 60, 20, 10, 200, 100)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })

  it('clamps coordinates that run off the page', () => {
    expect(regionFromDrag(-20, -10, 50, 40, 100, 100)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.4 })
    expect(regionFromDrag(90, 90, 200, 200, 100, 100)).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 })
  })

  it('enforces a minimum size, shifting back from the far edge', () => {
    expect(MIN_REGION_NORM).toBe(0.02)
    expect(regionFromDrag(99, 99, 99, 99, 100, 100)).toEqual({
      x: 0.98,
      y: 0.98,
      w: 0.02,
      h: 0.02,
    })
  })

  it('treats a zero-size page as the full region', () => {
    expect(regionFromDrag(1, 1, 2, 2, 0, 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('bindSheetRefToPhrase', () => {
  const ref: SheetRef = {
    id: 'ref-1',
    sheetDocId: 'doc-1',
    pageIndex: 0,
    regionNorm: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
  }

  it('sets a sheet ref on the phrase', () => {
    const project = projectWithPhrase(phrase({ id: 'p1' }))
    const next = bindSheetRefToPhrase(project, 'p1', ref)

    expect(next.phrases[0]?.sheetRefs).toEqual([ref])
    expect(project.phrases[0]?.sheetRefs).toEqual([])
  })

  it('replaces the phrase crop instead of appending, including a different page or PDF', () => {
    const oldRef: SheetRef = {
      id: 'old',
      sheetDocId: 'doc-1',
      pageIndex: 0,
      regionNorm: { x: 0, y: 0, w: 1, h: 1 },
    }
    const otherRef: SheetRef = {
      id: 'other',
      sheetDocId: 'doc-1',
      pageIndex: 0,
      regionNorm: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 },
    }
    const laterRef: SheetRef = {
      id: 'ref-2',
      sheetDocId: 'doc-2',
      pageIndex: 1,
      regionNorm: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 },
    }
    const project: Project = {
      ...createEmptyProject('When I Fall'),
      phrases: [phrase({ id: 'p1', sheetRefs: [oldRef] }), phrase({ id: 'p2', sheetRefs: [otherRef] })],
    }

    const next = bindSheetRefToPhrase(project, 'p1', laterRef)
    expect(next.phrases[0]?.sheetRefs).toEqual([laterRef])
    expect(next.phrases[1]?.sheetRefs).toEqual([otherRef])
    expect(sheetPageBlobId(
      {
        ...next,
        sheetDocs: [
          {
            id: 'doc-1',
            name: 'old.pdf',
            source: 'pdf',
            pages: [{ pageIndex: 0, imageBlobId: 'img-old' }],
          },
          {
            id: 'doc-2',
            name: 'new.pdf',
            source: 'pdf',
            pages: [
              { pageIndex: 0, imageBlobId: 'img-0' },
              { pageIndex: 1, imageBlobId: 'img-new' },
            ],
          },
        ],
      },
      next.phrases[0]!,
    )).toBe('img-new')
  })

  it('throws when the phrase is missing', () => {
    const project = createEmptyProject()
    expect(() => bindSheetRefToPhrase(project, 'missing', ref)).toThrow(/not found/)
  })
})

describe('sheetPageBlobId', () => {
  it('resolves the page image blob for the first sheet ref', () => {
    const item = phrase({
      id: 'p1',
      sheetRefs: [{ id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 1 }],
    })
    const project = projectWithPhrase(item, {
      sheetDocs: [
        {
          id: 'doc-1',
          name: 'lead.pdf',
          source: 'pdf',
          pages: [
            { pageIndex: 0, imageBlobId: 'img-0' },
            { pageIndex: 1, imageBlobId: 'img-1' },
          ],
        },
      ],
    })

    expect(sheetPageBlobId(project, item)).toBe('img-1')
  })

  it('returns undefined without sheet refs', () => {
    const item = phrase({ id: 'p1' })
    expect(sheetPageBlobId(projectWithPhrase(item), item)).toBeUndefined()
  })
})

describe('addSheetRefToPhrase / removeSheetRefFromPhrase', () => {
  const refA: SheetRef = {
    id: 'ref-a',
    sheetDocId: 'doc-1',
    pageIndex: 0,
    regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 },
  }
  const refB: SheetRef = {
    id: 'ref-b',
    sheetDocId: 'doc-1',
    pageIndex: 0,
    regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  }

  it('appends crops in order instead of replacing', () => {
    const project = projectWithPhrase(phrase({ id: 'p1', sheetRefs: [refA] }))
    const next = addSheetRefToPhrase(project, 'p1', refB)
    expect(next.phrases[0]?.sheetRefs).toEqual([refA, refB])
  })

  it('throws when the phrase is missing', () => {
    const project = createEmptyProject()
    expect(() => addSheetRefToPhrase(project, 'missing', refA)).toThrow(/not found/)
  })

  it('removes one crop, leaving the others in order', () => {
    const project = projectWithPhrase(phrase({ id: 'p1', sheetRefs: [refA, refB] }))
    const next = removeSheetRefFromPhrase(project, 'p1', 'ref-a')
    expect(next.phrases[0]?.sheetRefs).toEqual([refB])
  })
})

describe('sheetPageBlobIdsForPhrase', () => {
  it('resolves an image id per crop, in order', () => {
    const item = phrase({
      id: 'p1',
      sheetRefs: [
        { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0 },
        { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 1 },
      ],
    })
    const project = projectWithPhrase(item, {
      sheetDocs: [
        {
          id: 'doc-1',
          name: 'lead.pdf',
          source: 'pdf',
          pages: [
            { pageIndex: 0, imageBlobId: 'img-0' },
            { pageIndex: 1, imageBlobId: 'img-1' },
          ],
        },
      ],
    })
    expect(sheetPageBlobIdsForPhrase(project, item)).toEqual(['img-0', 'img-1'])
  })

  it('returns an empty array without sheet refs', () => {
    const item = phrase({ id: 'p1' })
    expect(sheetPageBlobIdsForPhrase(projectWithPhrase(item), item)).toEqual([])
  })
})

describe('sheetScrollFrame', () => {
  const refA: SheetRef = {
    id: 'ref-a',
    sheetDocId: 'doc-1',
    pageIndex: 0,
    regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 },
  }
  const refB: SheetRef = {
    id: 'ref-b',
    sheetDocId: 'doc-1',
    pageIndex: 0,
    regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  }
  const refC: SheetRef = {
    id: 'ref-c',
    sheetDocId: 'doc-2',
    pageIndex: 0,
    regionNorm: { x: 0, y: 0, w: 1, h: 1 },
  }

  it('returns null with no crops', () => {
    expect(sheetScrollFrame([], [], 0, 1000)).toBeNull()
  })

  it('returns one slide at progress 0 regardless of elapsed time', () => {
    const frame = sheetScrollFrame([refA], ['img-a'], 5000, 1000)
    expect(frame).toEqual({
      slides: [{ id: 'ref-a', region: refA.regionNorm, imageKey: 'img-a' }],
      progress: 0,
    })
  })

  it('lists every crop as a slide, in order, regardless of source image', () => {
    const frame = sheetScrollFrame([refA, refC], ['img-a', 'img-c'], 0, 1000)
    expect(frame?.slides).toEqual([
      { id: 'ref-a', region: refA.regionNorm, imageKey: 'img-a' },
      { id: 'ref-c', region: refC.regionNorm, imageKey: 'img-c' },
    ])
  })

  it('progress is 0 at elapsed 0 and 1 at durationMs regardless of slide count', () => {
    const start = sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 0, 1000)
    expect(start?.progress).toBe(0)
    const end = sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 1000, 1000)
    expect(end?.progress).toBe(1)
  })

  it('progress is continuous mid-phrase, same image or not', () => {
    const sameImage = sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 500, 1000)
    expect(sameImage?.progress).toBe(0.5)
    const differentImage = sheetScrollFrame([refA, refC], ['img-a', 'img-c'], 500, 1000)
    expect(differentImage?.progress).toBe(0.5)
  })

  it('clamps elapsed time outside the phrase span', () => {
    const before = sheetScrollFrame([refA, refB], ['img-a', 'img-a'], -500, 1000)
    expect(before?.progress).toBe(0)
    const after = sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 5000, 1000)
    expect(after?.progress).toBe(1)
  })

  it('progress is a plain elapsed/duration ratio regardless of how many crops are bound', () => {
    const oneThird = sheetScrollFrame([refA, refB, refC], ['img-a', 'img-a', 'img-c'], 1000, 3000)
    expect(oneThird?.progress).toBeCloseTo(1 / 3, 10)
  })
})
