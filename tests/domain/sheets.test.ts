import { describe, expect, it } from 'vitest'
import {
  addFilmPin,
  appendSheetCrop,
  appendSheetCrops,
  clearFilmPins,
  containCropBox,
  cropAspect,
  filmScrollProgress,
  filmTrackLayout,
  ghostToOccupiedMs,
  MIN_REGION_NORM,
  occupiedDurationMs,
  regionFromDrag,
  resizeRegionNorm,
  removeSheetCrop,
  replaceSheetCrops,
  sheetPageBlobIdsForCrops,
  sheetScrollFrame,
  sourceCropPx,
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

describe('resizeRegionNorm', () => {
  const box = { x: 0.1, y: 0.2, w: 0.4, h: 0.3 }

  it('moves the top edge down without moving the bottom', () => {
    expect(resizeRegionNorm(box, 'n', 0, 0.05)).toEqual({ x: 0.1, y: 0.25, w: 0.4, h: 0.25 })
  })

  it('does not shrink past the minimum or off the page', () => {
    expect(resizeRegionNorm(box, 'n', 0, 1).h).toBeGreaterThanOrEqual(0.02)
    expect(resizeRegionNorm({ x: 0, y: 0, w: 0.5, h: 0.5 }, 'w', -1, 0).x).toBe(0)
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

  it('appends many crops and clears film pins', () => {
    const project: Project = {
      ...createEmptyProject('When I Fall'),
      sheetCrops: [refA],
      filmPins: [{ id: 'pin-1', ghostMs: 10, u: 0.2 }],
    }
    const next = appendSheetCrops(project, [refB])
    expect(next.sheetCrops).toEqual([refA, refB])
    expect(next.filmPins).toEqual([])
    expect(project.sheetCrops).toEqual([refA])
  })

  it('replaces the film and clears film pins', () => {
    const project: Project = {
      ...createEmptyProject('When I Fall'),
      sheetCrops: [refA],
      filmPins: [{ id: 'pin-1', ghostMs: 10, u: 0.2 }],
    }
    const next = replaceSheetCrops(project, [refB])
    expect(next.sheetCrops).toEqual([refB])
    expect(next.filmPins).toEqual([])
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

  it('lerps in ghost time between click pins', () => {
    const phrases = [
      { startMs: 0, endMs: 4000 },
      { startMs: 4000, endMs: 8000 },
    ]
    const pins = [{ id: 'pin', ghostMs: 4000, u: 0.25 }]
    expect(filmScrollProgress(phrases, 0, pins)).toBe(0)
    expect(filmScrollProgress(phrases, 4000, pins)).toBe(0.25)
    expect(filmScrollProgress(phrases, 8000, pins)).toBe(1)
    expect(filmScrollProgress(phrases, 2000, pins)).toBeCloseTo(0.125, 10)
  })

  it('does not rewind when a later pin is further left on the film', () => {
    const phrases = [{ startMs: 0, endMs: 8000 }]
    const pins = [
      { id: 'a', ghostMs: 2000, u: 0.6 },
      { id: 'b', ghostMs: 4000, u: 0.2 },
    ]
    expect(filmScrollProgress(phrases, 2000, pins)).toBe(0.6)
    expect(filmScrollProgress(phrases, 4000, pins)).toBe(0.6)
  })

  it('holds outside the phrase span', () => {
    const phrases = [{ startMs: 1000, endMs: 5000 }]
    const pins = [{ id: 'pin', ghostMs: 3000, u: 0.4 }]
    expect(filmScrollProgress(phrases, 0, pins)).toBe(0)
    expect(filmScrollProgress(phrases, 9000, pins)).toBe(1)
  })
})

describe('addFilmPin / clearFilmPins', () => {
  it('appends a pin sorted by ghost time', () => {
    const project = createEmptyProject('When I Fall')
    const next = addFilmPin(addFilmPin(project, 4000, 0.5), 1000, 0.2)
    expect(next.filmPins?.map((pin) => pin.ghostMs)).toEqual([1000, 4000])
    expect(next.filmPins?.[0]?.u).toBe(0.2)
  })

  it('replaces a pin at nearly the same ghost time', () => {
    const project = addFilmPin(createEmptyProject('When I Fall'), 1000, 0.2)
    const next = addFilmPin(project, 1040, 0.8)
    expect(next.filmPins).toHaveLength(1)
    expect(next.filmPins?.[0]?.u).toBe(0.8)
    expect(next.filmPins?.[0]?.id).toBe(project.filmPins?.[0]?.id)
  })

  it('clears all pins', () => {
    const project = addFilmPin(createEmptyProject('When I Fall'), 1000, 0.2)
    const next = clearFilmPins(project)
    expect(next.filmPins).toEqual([])
  })
})

describe('cropAspect', () => {
  it('is region width over height', () => {
    expect(cropAspect({ x: 0, y: 0, w: 0.5, h: 0.25 })).toBe(2)
  })

  it('scales by natural image size when given', () => {
    expect(cropAspect({ x: 0, y: 0, w: 0.5, h: 0.5 }, { w: 2000, h: 1000 })).toBe(2)
  })
})

describe('containCropBox', () => {
  it('never lets a square crop become window-tall', () => {
    expect(containCropBox(1, 800, 400)).toEqual({ width: 400, height: 400 })
    expect(containCropBox(1, 400, 800)).toEqual({ width: 400, height: 400 })
    expect(containCropBox(4, 800, 400)).toEqual({ width: 800, height: 200 })
  })
})

describe('filmTrackLayout', () => {
  it('scrolls edge-flush when not centering', () => {
    const layout = filmTrackLayout({
      aspects: [2, 4],
      viewportWidthPx: 800,
      viewportHeightPx: 200,
      progress: 1,
      center: false,
    })
    expect(layout.totalWidthPx).toBe(1200)
    expect(layout.scrollLeftPx).toBe(400)
    expect(layout.translateXPx).toBe(-400)
  })

  it('keeps progress as a content fraction in the viewport middle', () => {
    const layout = filmTrackLayout({
      aspects: [2, 4],
      viewportWidthPx: 800,
      viewportHeightPx: 200,
      progress: 0.5,
      center: true,
    })
    expect(layout.scrollLeftPx).toBe(200)
  })

  it('does not scroll when the film is narrower than the viewport', () => {
    const layout = filmTrackLayout({
      aspects: [1],
      viewportWidthPx: 800,
      viewportHeightPx: 200,
      progress: 1,
      center: false,
    })
    expect(layout.scrollLeftPx).toBe(0)
  })
})

describe('sourceCropPx', () => {
  it('maps a normalized region onto image pixels', () => {
    expect(sourceCropPx({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1000, 800)).toEqual({
      sx: 100,
      sy: 160,
      sw: 500,
      sh: 200,
    })
  })
})
