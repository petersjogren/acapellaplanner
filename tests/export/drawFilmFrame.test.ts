import { describe, expect, it } from 'vitest'
import type { SheetRef } from '../../src/domain/schemas.ts'
import { filmTrackLayout } from '../../src/domain/sheets.ts'
import { drawFilmFrame, FILM_PAPER_FILL } from '../../src/export/drawFilmFrame.ts'
import type { DrawFilmFrameArgs, FilmPageImage } from '../../src/export/drawFilmFrame.ts'

type DrawImageCall = unknown[]

function crop(id: string): SheetRef {
  return { id, sheetDocId: 'd', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 1 } }
}

function pageImage(blobId: string, width: number, height: number): FilmPageImage {
  return { blobId, bitmap: { width, height } }
}

function createRecordingCtx() {
  const fillRects: Array<[number, number, number, number]> = []
  const drawImages: DrawImageCall[] = []
  const clips: unknown[][] = []
  const rects: unknown[][] = []
  const ctx = {
    fillStyle: '' as CanvasRenderingContext2D['fillStyle'],
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push([x, y, w, h])
    },
    drawImage(...args: unknown[]) {
      drawImages.push(args)
    },
    save() {},
    restore() {},
    beginPath() {},
    rect(...args: unknown[]) {
      rects.push(args)
    },
    clip(...args: unknown[]) {
      clips.push(args)
    },
  }
  return { ctx: ctx as DrawFilmFrameArgs['ctx'] & { fillStyle: CanvasRenderingContext2D['fillStyle'] }, fillRects, drawImages, clips, rects }
}

function destOf(call: DrawImageCall) {
  return {
    x: call[5] as number,
    y: call[6] as number,
    width: call[7] as number,
    height: call[8] as number,
  }
}

describe('drawFilmFrame', () => {
  it('fills paper only when crops are empty', () => {
    const rec = createRecordingCtx()
    drawFilmFrame({
      ctx: rec.ctx,
      width: 1920,
      height: 1080,
      crops: [],
      images: [],
      progress: 0,
      center: false,
    })
    expect(rec.ctx.fillStyle).toBe(FILM_PAPER_FILL)
    expect(rec.fillRects).toEqual([[0, 0, 1920, 1080]])
    expect(rec.drawImages).toEqual([])
  })

  it('centres a single square crop on 1920x1080', () => {
    const rec = createRecordingCtx()
    const image = pageImage('b', 100, 100)
    drawFilmFrame({
      ctx: rec.ctx,
      width: 1920,
      height: 1080,
      crops: [crop('a')],
      images: [image],
      progress: 0,
      center: false,
    })
    expect(rec.drawImages).toHaveLength(1)
    const dest = destOf(rec.drawImages[0]!)
    expect(dest).toEqual({ x: 420, y: 0, width: 1080, height: 1080 })
    expect(rec.drawImages[0]![0]).toBe(image.bitmap)
    expect(rec.drawImages[0]!.slice(1, 5)).toEqual([0, 0, 100, 100])
  })

  it('flushes the last slide to the right edge at progress 1 without centering', () => {
    const rec = createRecordingCtx()
    const first = pageImage('b1', 200, 100)
    const second = pageImage('b2', 400, 100)
    drawFilmFrame({
      ctx: rec.ctx,
      width: 800,
      height: 200,
      crops: [crop('a'), crop('b')],
      images: [first, second],
      progress: 1,
      center: false,
    })
    expect(rec.clips.length).toBeGreaterThan(0)
    expect(rec.rects).toContainEqual([0, 0, 800, 200])
    expect(rec.drawImages.length).toBeGreaterThan(0)
    const last = destOf(rec.drawImages[rec.drawImages.length - 1]!)
    expect(last.x + last.width).toBe(800)
  })

  it('matches filmTrackLayout scrollLeft when centering at progress 0.5', () => {
    const rec = createRecordingCtx()
    const first = pageImage('b1', 200, 100)
    const second = pageImage('b2', 400, 100)
    drawFilmFrame({
      ctx: rec.ctx,
      width: 800,
      height: 200,
      crops: [crop('a'), crop('b')],
      images: [first, second],
      progress: 0.5,
      center: true,
    })
    const layout = filmTrackLayout({
      aspects: [2, 4],
      viewportWidthPx: 800,
      viewportHeightPx: 200,
      progress: 0.5,
      center: true,
    })
    expect(layout.scrollLeftPx).toBe(200)
    const firstDest = destOf(rec.drawImages[0]!)
    expect(firstDest.x).toBe(layout.slideBoxes[0]!.x - layout.scrollLeftPx)
    expect(firstDest.x).toBe(-200)
  })
})
