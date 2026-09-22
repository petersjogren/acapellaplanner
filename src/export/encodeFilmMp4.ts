import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { MixPcm } from '../audio/renderMix.ts'
import { Mp4UnsupportedError } from './canEncodeFilmMp4.ts'
import {
  FILM_AAC_CODEC,
  FILM_AVC_CODEC,
  FILM_MP4_AUDIO_BITRATE,
  FILM_MP4_FPS,
  FILM_MP4_HEIGHT,
  FILM_MP4_VIDEO_BITRATE,
  FILM_MP4_WIDTH,
} from './constants.ts'

const AAC_UNSUPPORTED_MESSAGE = 'This browser cannot encode MP4 audio (AAC). Use desktop Chrome.'
const AUDIO_CHUNK_FRAMES = 1024

export type EncodeFilmMp4Deps = {
  VideoEncoder: typeof VideoEncoder
  AudioEncoder: typeof AudioEncoder
  VideoFrame: typeof VideoFrame
  AudioData: typeof AudioData
  Muxer: typeof Muxer
  ArrayBufferTarget: typeof ArrayBufferTarget
}

export async function encodeFilmMp4(
  args: {
    drawFrame: (frameIndex: number, tMs: number) => void
    canvas: HTMLCanvasElement | OffscreenCanvas
    audio: MixPcm
    durationMs: number
    audioMode: 'aac' | 'pcm'
    onProgress?: (ratio: number) => void
  },
  deps?: Partial<EncodeFilmMp4Deps>,
): Promise<Blob> {
  if (args.audioMode !== 'aac') {
    throw new Mp4UnsupportedError(AAC_UNSUPPORTED_MESSAGE)
  }

  const VideoEncoderCtor = deps?.VideoEncoder ?? globalThis.VideoEncoder
  const AudioEncoderCtor = deps?.AudioEncoder ?? globalThis.AudioEncoder
  const VideoFrameCtor = deps?.VideoFrame ?? globalThis.VideoFrame
  const AudioDataCtor = deps?.AudioData ?? globalThis.AudioData
  const MuxerCtor = deps?.Muxer ?? Muxer
  const ArrayBufferTargetCtor = deps?.ArrayBufferTarget ?? ArrayBufferTarget

  const { drawFrame, canvas, audio, durationMs, onProgress } = args
  const target = new ArrayBufferTargetCtor()
  const muxer = new MuxerCtor({
    target,
    video: { codec: 'avc', width: FILM_MP4_WIDTH, height: FILM_MP4_HEIGHT },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate: audio.sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })

  let video: VideoEncoder | undefined
  let audioEncoder: AudioEncoder | undefined
  try {
    video = new VideoEncoderCtor({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta)
      },
      error: () => {},
    })
    audioEncoder = new AudioEncoderCtor({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta)
      },
      error: () => {},
    })

    video.configure({
      codec: FILM_AVC_CODEC,
      width: FILM_MP4_WIDTH,
      height: FILM_MP4_HEIGHT,
      bitrate: FILM_MP4_VIDEO_BITRATE,
      framerate: FILM_MP4_FPS,
    })
    audioEncoder.configure({
      codec: FILM_AAC_CODEC,
      numberOfChannels: 2,
      sampleRate: audio.sampleRate,
      bitrate: FILM_MP4_AUDIO_BITRATE,
    })

    const frameCount = Math.ceil((durationMs / 1000) * FILM_MP4_FPS)
    for (let i = 0; i < frameCount; i++) {
      const tMs = (i * 1000) / FILM_MP4_FPS
      drawFrame(i, tMs)
      const timestamp = Math.round((i * 1e6) / FILM_MP4_FPS)
      const duration = Math.round(1e6 / FILM_MP4_FPS)
      const frame = new VideoFrameCtor(canvas, { timestamp, duration })
      try {
        video.encode(frame, { keyFrame: i % 30 === 0 })
      } finally {
        frame.close()
      }
      if ((i + 1) % 15 === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
        onProgress?.((i + 1) / frameCount)
      }
    }

    encodeAudioChunks(audio, audioEncoder, AudioDataCtor)

    await video.flush()
    await audioEncoder.flush()
    muxer.finalize()
    return new Blob([target.buffer], { type: 'video/mp4' })
  } finally {
    video?.close()
    audioEncoder?.close()
  }
}

function encodeAudioChunks(
  audio: MixPcm,
  audioEncoder: AudioEncoder,
  AudioDataCtor: typeof AudioData,
): void {
  const left = audio.channels[0] ?? new Float32Array(0)
  const right = audio.channels[1] ?? new Float32Array(left.length)
  const totalFrames = left.length
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += AUDIO_CHUNK_FRAMES) {
    const frames = Math.min(AUDIO_CHUNK_FRAMES, totalFrames - frameIndex)
    const planar = new Float32Array(frames * 2)
    planar.set(left.subarray(frameIndex, frameIndex + frames), 0)
    planar.set(right.subarray(frameIndex, frameIndex + frames), frames)
    const data = new AudioDataCtor({
      format: 'f32-planar',
      sampleRate: audio.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: 2,
      timestamp: Math.round((frameIndex * 1e6) / audio.sampleRate),
      data: planar,
    })
    try {
      audioEncoder.encode(data)
    } finally {
      data.close()
    }
  }
}
