import { describe, expect, it } from 'vitest'
import { renderPlaybackMix } from '../../src/audio/renderMix.ts'
import type { MixPlaybackLayer } from '../../src/audio/mix.ts'

function fakeBuffer(samples: Float32Array, sampleRate = 48000, channels = 1): AudioBuffer {
  const chans = Array.from({ length: channels }, (_, i) =>
    i === 0 ? samples : new Float32Array(samples.length),
  )
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: channels,
    getChannelData: (ch: number) => chans[ch] ?? new Float32Array(samples.length),
  } as unknown as AudioBuffer
}

describe('renderPlaybackMix', () => {
  it('Ghost Focus: unmuted ghost at 0 dB equals ghost samples on both channels', () => {
    const samples = Float32Array.from([0.5, -0.25, 0.125, 1])
    const extra: MixPlaybackLayer = {
      buffer: fakeBuffer(Float32Array.from([0.9, 0.9, 0.9, 0.9])),
      gainDb: 0,
      mute: true,
      pan: 1,
    }
    const pcm = renderPlaybackMix({
      mix: { ghostGainDb: 0, ghostMute: false, extra: [extra] },
      ghost: fakeBuffer(samples),
      durationMs: 1,
      sampleRate: 48000,
    })

    expect(pcm.sampleRate).toBe(48000)
    expect(pcm.channels).toHaveLength(2)
    expect(pcm.channels[0]!.length).toBe(48)
    expect(pcm.channels[1]!.length).toBe(48)
    expect(Array.from(pcm.channels[0]!.subarray(0, 4))).toEqual(Array.from(samples))
    expect(Array.from(pcm.channels[1]!.subarray(0, 4))).toEqual(Array.from(samples))
    expect(pcm.channels[0]![4]).toBe(0)
    expect(pcm.channels[1]![4]).toBe(0)
  })

  it('Blend Check: muted ghost is absent; keeper at startDelayMs 2000 sits at sample 96000', () => {
    const rate = 48000
    const ghostSamples = new Float32Array(8)
    ghostSamples.fill(0.8)
    const keeper = Float32Array.from([0.5, 0.25, -0.5])
    const pcm = renderPlaybackMix({
      mix: {
        ghostGainDb: 0,
        ghostMute: true,
        extra: [
          {
            buffer: fakeBuffer(keeper, rate),
            gainDb: 0,
            mute: false,
            startDelayMs: 2000,
          },
        ],
      },
      ghost: fakeBuffer(ghostSamples, rate),
      durationMs: 2001,
      sampleRate: rate,
    })

    const dest = 96000
    expect(pcm.channels[0]!.length).toBe(Math.round((2001 / 1000) * rate))
    expect(pcm.channels[0]![0]).toBe(0)
    expect(pcm.channels[0]![dest - 1]).toBe(0)
    expect(pcm.channels[0]![dest]).toBe(0.5)
    expect(pcm.channels[0]![dest + 1]).toBe(0.25)
    expect(pcm.channels[0]![dest + 2]).toBe(-0.5)
    expect(pcm.channels[1]![dest]).toBe(0.5)
    expect(pcm.channels[1]![dest + 1]).toBe(0.25)
  })

  it('latency: offsetMs 1000 at 48 kHz skips 48000 samples of the take', () => {
    const rate = 48000
    const take = new Float32Array(48000 + 3)
    take[0] = 0.75
    take[48000] = 0.5
    take[48001] = 0.25
    const pcm = renderPlaybackMix({
      mix: {
        ghostMute: true,
        extra: [
          {
            buffer: fakeBuffer(take, rate),
            gainDb: 0,
            mute: false,
            offsetMs: 1000,
          },
        ],
      },
      ghost: null,
      durationMs: 1,
      sampleRate: rate,
    })

    expect(pcm.channels[0]![0]).toBe(0.5)
    expect(pcm.channels[0]![1]).toBe(0.25)
    expect(pcm.channels[1]![0]).toBe(0.5)
  })

  it('timelineStartMs as startDelayMs 2000 starts the keeper at sample 96000', () => {
    const rate = 48000
    const keeper = Float32Array.from([1, 0.5])
    const pcm = renderPlaybackMix({
      mix: {
        ghostMute: true,
        extra: [
          {
            buffer: fakeBuffer(keeper, rate),
            gainDb: 0,
            mute: false,
            pan: -1,
            startDelayMs: 2000,
          },
        ],
      },
      ghost: null,
      durationMs: 2001,
      sampleRate: rate,
    })

    expect(pcm.channels[0]![95999]).toBe(0)
    expect(pcm.channels[0]![96000]).toBe(1)
    expect(pcm.channels[0]![96001]).toBe(0.5)
    expect(pcm.channels[1]![96000]).toBe(1)
    expect(pcm.channels[1]![96001]).toBe(0.5)
  })
})
