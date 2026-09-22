import { loadAllKeepersMixForSong } from '../audio/mix.ts'
import { renderPlaybackMix } from '../audio/renderMix.ts'
import { filmScrollProgress, sheetPageBlobIdsForCrops } from '../domain/sheets.ts'
import type { Project } from '../domain/schemas.ts'
import { canEncodeFilmMp4 } from './canEncodeFilmMp4.ts'
import { FILM_MP4_HEIGHT, FILM_MP4_WIDTH } from './constants.ts'
import { drawFilmFrame, FILM_PAPER_FILL } from './drawFilmFrame.ts'
import type { FilmPageImage } from './drawFilmFrame.ts'
import { encodeFilmMp4 } from './encodeFilmMp4.ts'

export async function exportFilmMp4(args: {
  project: Project
  presetId: string
  ghost: AudioBuffer | null
  loadBlob: (id: string) => Promise<Blob | undefined>
  loadAudioBuffer: (id: string) => Promise<AudioBuffer | null>
  onProgress?: (ratio: number) => void
  encode?: typeof encodeFilmMp4
  draw?: typeof drawFilmFrame
  canEncode?: typeof canEncodeFilmMp4
  createImageBitmapFn?: typeof createImageBitmap
  document?: Pick<Document, 'createElement'>
}): Promise<Blob> {
  const {
    project,
    presetId,
    ghost,
    loadBlob,
    loadAudioBuffer,
    onProgress,
  } = args
  const encode = args.encode ?? encodeFilmMp4
  const draw = args.draw ?? drawFilmFrame
  const canEncode = args.canEncode ?? canEncodeFilmMp4
  const createBitmap = args.createImageBitmapFn ?? createImageBitmap
  const doc = args.document ?? document

  await canEncode()

  if (project.sheetCrops.length === 0) {
    throw new Error('Add sheet crops on Prepare first.')
  }

  if (!ghost) {
    throw new Error('Import a ghost track first.')
  }
  const durationMs = ghost.duration * 1000
  if (!(durationMs > 0)) {
    throw new Error('Import a ghost track first.')
  }

  const mix = await loadAllKeepersMixForSong(project, presetId, loadAudioBuffer)
  const pcm = renderPlaybackMix({
    mix,
    ghost,
    durationMs,
    sampleRate: ghost.sampleRate,
  })

  const pageBlobIds = sheetPageBlobIdsForCrops(project, project.sheetCrops)
  const uniqueIds = [...new Set(pageBlobIds.filter((id): id is string => Boolean(id)))]
  const bitmapById = new Map<string, ImageBitmap>()
  try {
    for (const id of uniqueIds) {
      const blob = await loadBlob(id)
      if (!blob) continue
      bitmapById.set(id, await createBitmap(blob))
    }

    const images: Array<FilmPageImage | null> = pageBlobIds.map((id) => {
      if (!id) return null
      const bitmap = bitmapById.get(id)
      if (!bitmap) return null
      return { blobId: id, bitmap }
    })

    const canvas = doc.createElement('canvas') as HTMLCanvasElement
    canvas.width = FILM_MP4_WIDTH
    canvas.height = FILM_MP4_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Could not create film canvas.')
    }

    const center = (project.filmPins?.length ?? 0) > 0

    const drawFrame = (_frameIndex: number, tMs: number) => {
      draw({
        ctx,
        width: FILM_MP4_WIDTH,
        height: FILM_MP4_HEIGHT,
        crops: project.sheetCrops,
        images,
        progress: filmScrollProgress(project.phrases, tMs, project.filmPins ?? []),
        center,
        paperFill: FILM_PAPER_FILL,
      })
    }

    return await encode({
      drawFrame,
      canvas,
      audio: pcm,
      durationMs,
      audioMode: 'aac',
      onProgress,
    })
  } finally {
    for (const bitmap of bitmapById.values()) {
      bitmap.close()
    }
  }
}
