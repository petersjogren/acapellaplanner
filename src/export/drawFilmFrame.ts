import type { RegionNorm, SheetRef } from '../domain/schemas.ts'
import { containCropBox, cropAspect, filmTrackLayout, sourceCropPx } from '../domain/sheets.ts'

export const FILM_PAPER_FILL = '#f6f1e8'

const FULL_REGION: RegionNorm = { x: 0, y: 0, w: 1, h: 1 }

export type FilmPageImage = {
  blobId: string
  bitmap: { width: number; height: number } // ImageBitmap | HTMLImageElement duck type; drawImage accepts it
}

export type DrawFilmFrameArgs = {
  ctx: Pick<
    CanvasRenderingContext2D,
    'fillStyle' | 'fillRect' | 'drawImage' | 'save' | 'restore' | 'beginPath' | 'rect' | 'clip'
  >
  width: number
  height: number
  crops: SheetRef[]
  images: Array<FilmPageImage | null | undefined>
  progress: number
  center: boolean
  paperFill?: string
}

function regionOf(crop: SheetRef): RegionNorm {
  return crop.regionNorm ?? FULL_REGION
}

function drawCropped(
  ctx: DrawFilmFrameArgs['ctx'],
  bitmap: { width: number; height: number },
  crop: SheetRef,
  dest: { x: number; y: number; width: number; height: number },
): void {
  const src = sourceCropPx(regionOf(crop), bitmap.width, bitmap.height)
  ctx.drawImage(
    bitmap as CanvasImageSource,
    src.sx,
    src.sy,
    src.sw,
    src.sh,
    dest.x,
    dest.y,
    dest.width,
    dest.height,
  )
}

export function drawFilmFrame(args: DrawFilmFrameArgs): void {
  const { ctx, width, height, crops, images, progress, center } = args
  ctx.fillStyle = args.paperFill ?? FILM_PAPER_FILL
  ctx.fillRect(0, 0, width, height)
  if (crops.length === 0) return

  const aspects = crops.map((crop, index) => {
    const bitmap = images[index]?.bitmap
    return cropAspect(regionOf(crop), bitmap ? { w: bitmap.width, h: bitmap.height } : undefined)
  })

  if (crops.length === 1) {
    const crop = crops[0]!
    const box = containCropBox(aspects[0]!, width, height)
    const dest = {
      x: (width - box.width) / 2,
      y: (height - box.height) / 2,
      width: box.width,
      height: box.height,
    }
    const bitmap = images[0]?.bitmap
    if (bitmap) drawCropped(ctx, bitmap, crop, dest)
    return
  }

  const layout = filmTrackLayout({
    aspects,
    viewportWidthPx: width,
    viewportHeightPx: height,
    progress,
    center,
  })
  const scrollLeft = layout.scrollLeftPx
  for (let i = 0; i < crops.length; i++) {
    const box = layout.slideBoxes[i]!
    if (!(box.x < scrollLeft + width && box.x + box.width > scrollLeft)) continue
    const dest = {
      x: box.x - scrollLeft,
      y: 0,
      width: box.width,
      height: box.height,
    }
    const bitmap = images[i]?.bitmap
    if (!bitmap) continue
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.clip()
    drawCropped(ctx, bitmap, crops[i]!, dest)
    ctx.restore()
  }
}
