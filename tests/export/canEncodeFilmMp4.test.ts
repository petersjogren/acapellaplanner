import { describe, expect, it } from 'vitest'
import { canEncodeFilmMp4, Mp4UnsupportedError } from '../../src/export/canEncodeFilmMp4.ts'
import { FILM_AAC_CODEC, FILM_AVC_CODEC } from '../../src/export/constants.ts'

const MP4_UNSUPPORTED_MESSAGE = 'This browser cannot encode MP4 (H.264). Use desktop Chrome.'
const AAC_UNSUPPORTED_MESSAGE = 'This browser cannot encode MP4 audio (AAC). Use desktop Chrome.'

type SupportResult = { supported: boolean }

function stubEncoder(supported: boolean) {
  return {
    isConfigSupported: async () => ({ supported }),
  }
}

async function expectMp4Unsupported(run: () => Promise<unknown>, message = MP4_UNSUPPORTED_MESSAGE) {
  await expect(run()).rejects.toMatchObject({
    name: 'Mp4UnsupportedError',
    message,
  })
  await expect(run()).rejects.toBeInstanceOf(Mp4UnsupportedError)
}

describe('canEncodeFilmMp4', () => {
  it('throws Mp4UnsupportedError when VideoEncoder is missing', async () => {
    await expectMp4Unsupported(() => canEncodeFilmMp4(undefined))
  })

  it('throws Mp4UnsupportedError when avc1 is not supported', async () => {
    await expectMp4Unsupported(() => canEncodeFilmMp4(stubEncoder(false), stubEncoder(true)))
  })

  it('throws Mp4UnsupportedError when aac is not supported', async () => {
    await expectMp4Unsupported(
      () => canEncodeFilmMp4(stubEncoder(true), stubEncoder(false)),
      AAC_UNSUPPORTED_MESSAGE,
    )
  })

  it('throws Mp4UnsupportedError when AudioEncoder is missing', async () => {
    await expectMp4Unsupported(() => canEncodeFilmMp4(stubEncoder(true), undefined), AAC_UNSUPPORTED_MESSAGE)
  })

  it('returns aac audio when avc1 and aac are both supported', async () => {
    const result = await canEncodeFilmMp4(stubEncoder(true), stubEncoder(true))
    expect(result).toEqual({ video: true, audio: 'aac' })
    expect(result.audio).not.toBe('webm')
  })

  it('queries H.264 and AAC, never WebM', async () => {
    const videoCodecs: string[] = []
    const audioCodecs: string[] = []
    const video = {
      isConfigSupported: async (config: { codec: string }): Promise<SupportResult> => {
        videoCodecs.push(config.codec)
        return { supported: true }
      },
    }
    const audio = {
      isConfigSupported: async (config: { codec: string }): Promise<SupportResult> => {
        audioCodecs.push(config.codec)
        return { supported: true }
      },
    }
    await canEncodeFilmMp4(video, audio)
    expect(videoCodecs).toEqual([FILM_AVC_CODEC])
    expect(audioCodecs).toEqual([FILM_AAC_CODEC])
    expect(videoCodecs.join()).not.toMatch(/webm/i)
    expect(audioCodecs.join()).not.toMatch(/webm/i)
  })
})
