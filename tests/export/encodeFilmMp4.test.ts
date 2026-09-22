import { describe, expect, it } from 'vitest'
import { Mp4UnsupportedError } from '../../src/export/canEncodeFilmMp4.ts'
import { encodeFilmMp4 } from '../../src/export/encodeFilmMp4.ts'
import type { EncodeFilmMp4Deps } from '../../src/export/encodeFilmMp4.ts'
import type { MixPcm } from '../../src/audio/renderMix.ts'

const AAC_UNSUPPORTED_MESSAGE = 'This browser cannot encode MP4 audio (AAC). Use desktop Chrome.'

function silentMix(sampleRate = 48_000, frames = 1024): MixPcm {
  return {
    sampleRate,
    channels: [new Float32Array(frames), new Float32Array(frames)],
  }
}

function createFakes(options?: { throwOnEncode?: boolean }) {
  const videoFrames: Array<{ timestamp: number; closed: boolean }> = []
  const canvas = {} as HTMLCanvasElement

  class FakeArrayBufferTarget {
    buffer: ArrayBuffer = new ArrayBuffer(0)
  }

  class FakeMuxer {
    target: FakeArrayBufferTarget
    constructor(opts: { target: FakeArrayBufferTarget }) {
      this.target = opts.target
    }
    addVideoChunk(_chunk: unknown, _meta?: unknown) {}
    addAudioChunk(_chunk: unknown, _meta?: unknown) {}
    finalize() {
      this.target.buffer = new Uint8Array([1, 2, 3]).buffer
    }
  }

  class FakeVideoFrame {
    timestamp: number
    closed = false
    constructor(_source: unknown, init: { timestamp: number; duration?: number }) {
      this.timestamp = init.timestamp
      videoFrames.push(this)
    }
    close() {
      this.closed = true
    }
  }

  class FakeVideoEncoder {
    constructor(_init: { output: (chunk: unknown, meta?: unknown) => void; error: (err: unknown) => void }) {}
    configure(_config: unknown) {}
    encode(_frame: unknown, _opts?: unknown) {
      if (options?.throwOnEncode) throw new Error('encode failed')
    }
    async flush() {}
    close() {}
  }

  class FakeAudioEncoder {
    constructor(_init: { output: (chunk: unknown, meta?: unknown) => void; error: (err: unknown) => void }) {}
    configure(_config: unknown) {}
    encode(_data: unknown) {}
    async flush() {}
    close() {}
  }

  class FakeAudioData {
    constructor(_init: unknown) {}
    close() {}
  }

  const deps = {
    VideoEncoder: FakeVideoEncoder,
    AudioEncoder: FakeAudioEncoder,
    VideoFrame: FakeVideoFrame,
    AudioData: FakeAudioData,
    Muxer: FakeMuxer,
    ArrayBufferTarget: FakeArrayBufferTarget,
  } as unknown as EncodeFilmMp4Deps

  return {
    canvas,
    deps,
    videoFrames,
    closeCount: () => videoFrames.filter((frame) => frame.closed).length,
  }
}

describe('encodeFilmMp4', () => {
  it('draws 30 frames for 1000ms with tMs === n * 1000/30', async () => {
    const { canvas, deps } = createFakes()
    const calls: Array<[number, number]> = []
    await encodeFilmMp4(
      {
        drawFrame: (frameIndex, tMs) => {
          calls.push([frameIndex, tMs])
        },
        canvas,
        audio: silentMix(),
        durationMs: 1000,
        audioMode: 'aac',
      },
      deps,
    )
    expect(calls).toHaveLength(30)
    for (let n = 0; n < 30; n++) {
      expect(calls[n]?.[0]).toBe(n)
      expect(calls[n]?.[1]).toBe((n * 1000) / 30)
    }
  })

  it('reports onProgress last call === 1', async () => {
    const { canvas, deps } = createFakes()
    const progress: number[] = []
    await encodeFilmMp4(
      {
        drawFrame: () => {},
        canvas,
        audio: silentMix(),
        durationMs: 1000,
        audioMode: 'aac',
        onProgress: (ratio) => {
          progress.push(ratio)
        },
      },
      deps,
    )
    expect(progress.at(-1)).toBe(1)
  })

  it('returns a video/mp4 blob', async () => {
    const { canvas, deps } = createFakes()
    const blob = await encodeFilmMp4(
      {
        drawFrame: () => {},
        canvas,
        audio: silentMix(),
        durationMs: 1000,
        audioMode: 'aac',
      },
      deps,
    )
    expect(blob.type).toBe('video/mp4')
  })

  it('closes VideoFrame when encode throws', async () => {
    const { canvas, deps, closeCount } = createFakes({ throwOnEncode: true })
    await expect(
      encodeFilmMp4(
        {
          drawFrame: () => {},
          canvas,
          audio: silentMix(),
          durationMs: 1000 / 30,
          audioMode: 'aac',
        },
        deps,
      ),
    ).rejects.toThrow('encode failed')
    expect(closeCount()).toBeGreaterThanOrEqual(1)
  })

  it('throws Mp4UnsupportedError for pcm audioMode', async () => {
    const { canvas, deps } = createFakes()
    const run = encodeFilmMp4(
      {
        drawFrame: () => {},
        canvas,
        audio: silentMix(),
        durationMs: 1000,
        audioMode: 'pcm',
      },
      deps,
    )
    await expect(run).rejects.toBeInstanceOf(Mp4UnsupportedError)
    await expect(
      encodeFilmMp4(
        {
          drawFrame: () => {},
          canvas,
          audio: silentMix(),
          durationMs: 1000,
          audioMode: 'pcm',
        },
        deps,
      ),
    ).rejects.toMatchObject({
      name: 'Mp4UnsupportedError',
      message: AAC_UNSUPPORTED_MESSAGE,
    })
  })
})
