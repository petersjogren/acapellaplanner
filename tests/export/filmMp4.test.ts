import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAllKeepersMixForSong, STACK_BUILD_PRESET_ID } from '../../src/audio/mix.ts'
import { createEmptyProject, type Project } from '../../src/domain/schemas.ts'
import { FILM_PAPER_FILL } from '../../src/export/drawFilmFrame.ts'
import type { DrawFilmFrameArgs } from '../../src/export/drawFilmFrame.ts'
import { exportFilmMp4 } from '../../src/export/filmMp4.ts'
import { FILM_MP4_HEIGHT, FILM_MP4_WIDTH } from '../../src/export/constants.ts'

vi.mock('../../src/audio/mix.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audio/mix.ts')>()
  return {
    ...actual,
    loadAllKeepersMixForSong: vi.fn(async () => ({
      ghostGainDb: 0,
      ghostMute: true,
      extra: [],
    })),
  }
})

function fakeGhost(duration = 1, sampleRate = 48_000): AudioBuffer {
  const length = Math.round(duration * sampleRate)
  return {
    duration,
    sampleRate,
    length,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

function projectWithCrop(overrides: Partial<Project> = {}): Project {
  return {
    ...createEmptyProject('When I Fall'),
    sheetCrops: [
      { id: 'crop-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 1 } },
    ],
    sheetDocs: [
      {
        id: 'doc-1',
        name: 'lead.pdf',
        source: 'pdf',
        pages: [{ pageIndex: 0, imageBlobId: 'img-1' }],
      },
    ],
    phrases: [
      {
        id: 'p1',
        name: 'A',
        startMs: 0,
        endMs: 1000,
        partPlan: [],
        loopDefault: { mode: 'once', gapMs: 0 },
        postRollMs: 0,
      },
    ],
    ...overrides,
  }
}

function fakeDocument() {
  const ctx = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
  }
  return {
    document: {
      createElement: vi.fn((tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`)
        return canvas as unknown as HTMLCanvasElement
      }),
    },
    canvas,
    ctx,
  }
}

function seams(overrides: Record<string, unknown> = {}) {
  const encode = vi.fn(async (args: { drawFrame: (i: number, tMs: number) => void }) => {
    args.drawFrame(0, 0)
    return new Blob(['mp4'], { type: 'video/mp4' })
  })
  const draw = vi.fn()
  const canEncode = vi.fn(async () => ({ video: true as const, audio: 'aac' as const }))
  const close = vi.fn()
  const createImageBitmapFn = vi.fn(async () => ({ width: 100, height: 100, close }))
  const { document } = fakeDocument()
  const loadBlob = vi.fn(async (id: string) => (id === 'img-1' ? new Blob(['img']) : undefined))
  const loadAudioBuffer = vi.fn(async () => null)
  return {
    encode,
    draw,
    canEncode,
    createImageBitmapFn,
    document,
    loadBlob,
    loadAudioBuffer,
    close,
    ...overrides,
  }
}

describe('exportFilmMp4', () => {
  beforeEach(() => {
    vi.mocked(loadAllKeepersMixForSong).mockClear()
  })

  it('throws before encode when there are no sheet crops', async () => {
    const injected = seams()
    await expect(
      exportFilmMp4({
        project: createEmptyProject('When I Fall'),
        presetId: STACK_BUILD_PRESET_ID,
        ghost: fakeGhost(),
        ...injected,
      }),
    ).rejects.toThrow('Add sheet crops on Prepare first.')
    expect(injected.encode).not.toHaveBeenCalled()
  })

  it('throws before encode when ghost is missing', async () => {
    const injected = seams()
    await expect(
      exportFilmMp4({
        project: projectWithCrop(),
        presetId: STACK_BUILD_PRESET_ID,
        ghost: null,
        ...injected,
      }),
    ).rejects.toThrow('Import a ghost track first.')
    expect(injected.encode).not.toHaveBeenCalled()
  })

  it('throws before encode when ghost duration is 0', async () => {
    const injected = seams()
    await expect(
      exportFilmMp4({
        project: projectWithCrop(),
        presetId: STACK_BUILD_PRESET_ID,
        ghost: fakeGhost(0),
        ...injected,
      }),
    ).rejects.toThrow('Import a ghost track first.')
    expect(injected.encode).not.toHaveBeenCalled()
  })

  it('draws with center true when film pins exist', async () => {
    const injected = seams()
    const blob = await exportFilmMp4({
      project: projectWithCrop({
        filmPins: [{ id: 'pin-1', ghostMs: 0, u: 0 }],
      }),
      presetId: STACK_BUILD_PRESET_ID,
      ghost: fakeGhost(),
      ...injected,
    })
    expect(blob.type).toBe('video/mp4')
    expect(injected.draw).toHaveBeenCalled()
    const args = injected.draw.mock.calls[0]?.[0] as DrawFilmFrameArgs
    expect(args.center).toBe(true)
    expect(args.width).toBe(FILM_MP4_WIDTH)
    expect(args.height).toBe(FILM_MP4_HEIGHT)
    expect(args.paperFill).toBe(FILM_PAPER_FILL)
  })

  it('loads the all-keepers mix with the given preset id', async () => {
    const injected = seams()
    const project = projectWithCrop()
    await exportFilmMp4({
      project,
      presetId: STACK_BUILD_PRESET_ID,
      ghost: fakeGhost(),
      ...injected,
    })
    expect(vi.mocked(loadAllKeepersMixForSong)).toHaveBeenCalledWith(
      project,
      STACK_BUILD_PRESET_ID,
      injected.loadAudioBuffer,
    )
  })
})
