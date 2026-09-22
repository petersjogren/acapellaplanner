import {
  FILM_AAC_CODEC,
  FILM_AVC_CODEC,
  FILM_MP4_AUDIO_BITRATE,
  FILM_MP4_FPS,
  FILM_MP4_HEIGHT,
  FILM_MP4_VIDEO_BITRATE,
  FILM_MP4_WIDTH,
} from './constants.ts'

export class Mp4UnsupportedError extends Error {
  constructor(message = 'This browser cannot encode MP4 (H.264). Use desktop Chrome.') {
    super(message)
    this.name = 'Mp4UnsupportedError'
  }
}

type VideoEncoderLike = Pick<typeof VideoEncoder, 'isConfigSupported'> | undefined
type AudioEncoderLike = Pick<typeof AudioEncoder, 'isConfigSupported'> | undefined

export async function canEncodeFilmMp4(
  videoEncoder: VideoEncoderLike = globalThis.VideoEncoder,
  audioEncoder: AudioEncoderLike = globalThis.AudioEncoder,
): Promise<{ video: true; audio: 'aac' }> {
  if (!videoEncoder?.isConfigSupported) {
    throw new Mp4UnsupportedError()
  }

  const videoSupport = await videoEncoder.isConfigSupported({
    codec: FILM_AVC_CODEC,
    width: FILM_MP4_WIDTH,
    height: FILM_MP4_HEIGHT,
    framerate: FILM_MP4_FPS,
    bitrate: FILM_MP4_VIDEO_BITRATE,
  })
  if (!videoSupport.supported) {
    throw new Mp4UnsupportedError()
  }

  if (!audioEncoder?.isConfigSupported) {
    throw new Mp4UnsupportedError('This browser cannot encode MP4 audio (AAC). Use desktop Chrome.')
  }

  const audioSupport = await audioEncoder.isConfigSupported({
    codec: FILM_AAC_CODEC,
    numberOfChannels: 2,
    sampleRate: 48_000,
    bitrate: FILM_MP4_AUDIO_BITRATE,
  })
  if (!audioSupport.supported) {
    throw new Mp4UnsupportedError('This browser cannot encode MP4 audio (AAC). Use desktop Chrome.')
  }

  return { video: true, audio: 'aac' }
}
