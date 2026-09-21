import { describe, expect, it } from 'vitest'
import {
  appendSheetCrop,
  filmScrollProgress,
  ghostToOccupiedMs,
  MIN_REGION_NORM,
  occupiedDurationMs,
  regionFromDrag,
  removeSheetCrop,
  sheetPageBlobIdsForCrops,
  sheetScrollFrame,
} from '../../src/domain/sheets.ts'
import { createEmptyProject, type Project, type SheetRef } from '../../src/domain/schemas.ts'

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

describe('appendSheetCrop / removeSheetCrop', () => {
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

  it('appends crops to the song film in order', () => {
    const project = createEmptyProject('When I Fall')
    const next = appendSheetCrop(appendSheetCrop(project, refA), refB)
    expect(next.sheetCrops).toEqual([refA, refB])
    expect(project.sheetCrops).toEqual([])
  })

  it('removes one crop, leaving the others in order', () => {
    const project: Project = { ...createEmptyProject('When I Fall'), sheetCrops: [refA, refB] }
    const next = removeSheetCrop(project, 'ref-a')
    expect(next.sheetCrops).toEqual([refB])
  })
})

describe('sheetPageBlobIdsForCrops', () => {
  const crops: SheetRef[] = [
    { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0 },
    { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 1 },
  ]

  it('resolves an image id per crop, in order', () => {
    const project: Project = {
      ...createEmptyProject('When I Fall'),
      sheetCrops: crops,
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
    }
    expect(sheetPageBlobIdsForCrops(project, crops)).toEqual(['img-0', 'img-1'])
  })

  it('returns an empty array without crops', () => {
    expect(sheetPageBlobIdsForCrops(createEmptyProject(), [])).toEqual([])
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
    expect(sheetScrollFrame([], [], 0)).toBeNull()
  })

  it('returns one slide at progress 0 regardless of the given progress', () => {
    const frame = sheetScrollFrame([refA], ['img-a'], 0.8)
    expect(frame).toEqual({
      slides: [{ id: 'ref-a', region: refA.regionNorm, imageKey: 'img-a' }],
      progress: 0,
    })
  })

  it('lists every crop as a slide, in order, regardless of source image', () => {
    const frame = sheetScrollFrame([refA, refC], ['img-a', 'img-c'], 0)
    expect(frame?.slides).toEqual([
      { id: 'ref-a', region: refA.regionNorm, imageKey: 'img-a' },
      { id: 'ref-c', region: refC.regionNorm, imageKey: 'img-c' },
    ])
  })

  it('passes through camera progress for a multi-crop film', () => {
    expect(sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 0)?.progress).toBe(0)
    expect(sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 1)?.progress).toBe(1)
    expect(sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 0.5)?.progress).toBe(0.5)
  })

  it('clamps progress outside 0–1', () => {
    expect(sheetScrollFrame([refA, refB], ['img-a', 'img-a'], -0.5)?.progress).toBe(0)
    expect(sheetScrollFrame([refA, refB], ['img-a', 'img-a'], 5)?.progress).toBe(1)
  })
})

describe('filmScrollProgress', () => {
  const one = [{ startMs: 0, endMs: 4000 }]
  const abut = [
    { startMs: 0, endMs: 4000 },
    { startMs: 4000, endMs: 8000 },
  ]
  const gapped = [
    { startMs: 0, endMs: 4000 },
    { startMs: 6000, endMs: 8000 },
  ]

  it('is 0 with no phrases', () => {
    expect(occupiedDurationMs([])).toBe(0)
    expect(ghostToOccupiedMs([], 1000)).toBe(0)
    expect(filmScrollProgress([], 0)).toBe(0)
    expect(filmScrollProgress([], 9000)).toBe(0)
  })

  it('maps one phrase: hold before, linear inside, hold after', () => {
    expect(occupiedDurationMs(one)).toBe(4000)
    expect(ghostToOccupiedMs(one, -100)).toBe(0)
    expect(ghostToOccupiedMs(one, 0)).toBe(0)
    expect(ghostToOccupiedMs(one, 2000)).toBe(2000)
    expect(ghostToOccupiedMs(one, 4000)).toBe(4000)
    expect(ghostToOccupiedMs(one, 9000)).toBe(4000)
    expect(filmScrollProgress(one, -100)).toBe(0)
    expect(filmScrollProgress(one, 0)).toBe(0)
    expect(filmScrollProgress(one, 2000)).toBe(0.5)
    expect(filmScrollProgress(one, 4000)).toBe(1)
    expect(filmScrollProgress(one, 9000)).toBe(1)
  })

  it('splits abutting phrases evenly at the shared boundary', () => {
    expect(occupiedDurationMs(abut)).toBe(8000)
    expect(ghostToOccupiedMs(abut, 4000)).toBe(4000)
    expect(filmScrollProgress(abut, 4000)).toBe(0.5)
  })

  it('holds occupied time across an unmarked gap', () => {
    expect(occupiedDurationMs(gapped)).toBe(6000)
    expect(ghostToOccupiedMs(gapped, 4000)).toBe(4000)
    expect(ghostToOccupiedMs(gapped, 5000)).toBe(4000)
    expect(ghostToOccupiedMs(gapped, 6000)).toBe(4000)
    expect(ghostToOccupiedMs(gapped, 7000)).toBe(5000)
    expect(filmScrollProgress(gapped, 5000)).toBeCloseTo(4000 / 6000, 10)
    expect(filmScrollProgress(gapped, 7000)).toBeCloseTo(5000 / 6000, 10)
  })
})
