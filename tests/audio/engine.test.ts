import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAudioContext, getAudioContext } from '../../src/audio/context.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../../src/audio/engine.ts'
import type { PhrasePlaySpec } from '../../src/audio/schedule.ts'

type FakeSource = {
  buffer: AudioBuffer | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onended: ((this: AudioBufferSourceNode, ev: Event) => void) | null
}

type FakeGain = {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  gain: { value: number }
}

function spec(overrides: Partial<PhrasePlaySpec> = {}): PhrasePlaySpec {
  return {
    startMs: 0,
    endMs: 2000,
    preRollMs: 0,
    postRollMs: 0,
    gapMs: 400,
    loop: false,
    ...overrides,
  }
}

type FakeOscillator = {
  frequency: { value: number }
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onended: ((this: OscillatorNode, ev: Event) => void) | null
}

describe('createPlaybackEngine', () => {
  let sources: FakeSource[]
  let oscillators: FakeOscillator[]
  let gains: FakeGain[]
  let destination: { kind: string }
  let fakeCtx: { currentTime: number; state: AudioContextState; resume: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    sources = []
    oscillators = []
    gains = []
    destination = { kind: 'destination' }

    class FakeAudioContext {
      state: AudioContextState = 'suspended'
      currentTime = 1
      destination = destination
      resume = vi.fn(async () => {
        this.state = 'running'
      })
      close = vi.fn(async () => {
        this.state = 'closed'
      })
      createGain() {
        const gain: FakeGain = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: { value: 1 },
        }
        gains.push(gain)
        return gain
      }
      createBufferSource() {
        const source: FakeSource = {
          buffer: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null,
        }
        sources.push(source)
        return source
      }
      createOscillator() {
        const osc: FakeOscillator = {
          frequency: { value: 440 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null,
        }
        oscillators.push(osc)
        return osc
      }
    }

    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.useFakeTimers()
    fakeCtx = getAudioContext() as unknown as typeof fakeCtx
  })

  afterEach(async () => {
    vi.useRealTimers()
    await closeAudioContext()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function buffer(durationSec = 10): AudioBuffer {
    return { duration: durationSec, sampleRate: 44100, length: durationSec * 44100 } as AudioBuffer
  }

  function engineWith(audio: AudioBuffer | null): PlaybackEngine {
    return createPlaybackEngine({ getBuffer: () => audio })
  }

  it('starts a BufferSource once with offset and duration in seconds', async () => {
    const engine = engineWith(buffer())
    const started = await engine.play(
      spec({ startMs: 1000, endMs: 3000, preRollMs: 250, postRollMs: 100, loop: false }),
    )

    expect(started).toBe(true)
    expect(sources).toHaveLength(1)
    expect(gains).toHaveLength(1)
    expect(gains[0]?.connect).toHaveBeenCalledWith(destination)
    expect(sources[0]?.connect).toHaveBeenCalledWith(gains[0])
    expect(sources[0]?.buffer).toEqual(expect.objectContaining({ duration: 10 }))
    // offset 750ms, duration 2350ms
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0.75, 2.35)
  })

  it('resumes a suspended AudioContext on play', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec())
    const ctx = getAudioContext()
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    expect(ctx.state).toBe('running')
  })

  it('throws when no buffer is available', async () => {
    const engine = engineWith(null)
    await expect(engine.play(spec())).rejects.toThrow(/no audio buffer/i)
    expect(sources).toHaveLength(0)
  })

  it('schedules loop iterations at duration plus gap', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec({ loop: true, gapMs: 400 }))

    expect(sources).toHaveLength(1)
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0, 2)

    // period = 2400ms; first lookahead fires ~100ms early (wall +2300ms)
    fakeCtx.currentTime = 3.3
    await vi.advanceTimersByTimeAsync(2300)
    expect(sources).toHaveLength(2)
    expect(sources[1]?.start).toHaveBeenCalledWith(3.4, 0, 2)
    const secondWhen = sources[1]?.start.mock.calls[0]?.[0] as number
    expect(secondWhen).toBeGreaterThan(fakeCtx.currentTime)

    // Second iteration arms next delay from live currentTime (3.3 → next 5.8 → 2400ms)
    fakeCtx.currentTime = 5.7
    await vi.advanceTimersByTimeAsync(2400)
    expect(sources).toHaveLength(3)
    expect(sources[2]?.start).toHaveBeenCalledWith(5.8, 0, 2)
    const thirdWhen = sources[2]?.start.mock.calls[0]?.[0] as number
    expect(thirdWhen).toBeGreaterThan(fakeCtx.currentTime)
  })

  it('invokes loop start() with when > currentTime (lookahead on audio clock)', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec({ loop: true, gapMs: 400, endMs: 2000 }))

    // First start at audioNow=1; next deadline = 1 + 2.4 = 3.4
    // Lookahead fires 100ms early. Advance wall clock almost to fire, then set audio clock.
    fakeCtx.currentTime = 3.3 // still before when=3.4
    await vi.advanceTimersByTimeAsync(2300)

    expect(sources).toHaveLength(2)
    const whenAtCall = sources[1]?.start.mock.calls[0]?.[0] as number
    expect(whenAtCall).toBe(3.4)
    expect(whenAtCall).toBeGreaterThan(fakeCtx.currentTime)
  })

  it('stop() cancels further loop iterations via a generation token', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec({ loop: true, gapMs: 400 }))
    expect(sources).toHaveLength(1)

    engine.stop()
    expect(sources[0]?.stop).toHaveBeenCalled()
    expect(sources[0]?.disconnect).toHaveBeenCalled()
    expect(gains[0]?.disconnect).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(sources).toHaveLength(1)
  })

  it('returns false and does not start audio when stop() cancels during resume', async () => {
    const engine = engineWith(buffer())
    const ctx = getAudioContext() as unknown as {
      resume: ReturnType<typeof vi.fn>
      state: AudioContextState
    }

    let resolveResume: (() => void) | undefined
    ctx.resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = () => {
            ctx.state = 'running'
            resolve()
          }
        }),
    )

    const playPromise = engine.play(spec())
    // Allow play() to reach the pending resume
    await Promise.resolve()
    engine.stop()
    resolveResume?.()

    await expect(playPromise).resolves.toBe(false)
    expect(sources).toHaveLength(0)
    expect(gains).toHaveLength(0)
  })

  it('stop() is idempotent', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec())
    engine.stop()
    expect(() => {
      engine.stop()
      engine.stop()
    }).not.toThrow()
  })

  it('does not fire onEnded after stop', async () => {
    const onEnded = vi.fn()
    const engine = engineWith(buffer())
    await engine.play(spec({ loop: false }), { onEnded })
    engine.stop()
    sources[0]?.onended?.call(sources[0] as unknown as AudioBufferSourceNode, new Event('ended'))
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('fires onEnded when a one-shot source ends', async () => {
    const onEnded = vi.fn()
    const engine = engineWith(buffer())
    await engine.play(spec({ loop: false }), { onEnded })
    sources[0]?.onended?.call(sources[0] as unknown as AudioBufferSourceNode, new Event('ended'))
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('fires onPhraseEnter after the pre-roll delay', async () => {
    const onPhraseEnter = vi.fn()
    const engine = engineWith(buffer())
    await engine.play(
      spec({ startMs: 1000, endMs: 3000, preRollMs: 250, postRollMs: 0, loop: false }),
      { onPhraseEnter },
    )
    expect(onPhraseEnter).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(249)
    expect(onPhraseEnter).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onPhraseEnter).toHaveBeenCalledTimes(1)
  })

  it('fires onPassStart at play window start and onPassComplete at play window end', async () => {
    const onPassStart = vi.fn()
    const onPassComplete = vi.fn()
    const engine = engineWith(buffer())
    await engine.play(spec({ startMs: 0, endMs: 2000, loop: false }), { onPassStart, onPassComplete })

    expect(onPassStart).toHaveBeenCalledTimes(1)
    expect(onPassComplete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1999)
    expect(onPassComplete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onPassComplete).toHaveBeenCalledTimes(1)
  })

  it('does not fire onPassComplete after stop', async () => {
    const onPassStart = vi.fn()
    const onPassComplete = vi.fn()
    const engine = engineWith(buffer())
    await engine.play(spec({ startMs: 0, endMs: 2000, loop: false }), { onPassStart, onPassComplete })
    expect(onPassStart).toHaveBeenCalledTimes(1)
    engine.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onPassComplete).not.toHaveBeenCalled()
  })

  it('fires onPassStart for a looped pass at the audio-clock when', async () => {
    const onPassStart = vi.fn()
    const onPassComplete = vi.fn()
    const engine = engineWith(buffer())
    await engine.play(spec({ loop: true, gapMs: 400, endMs: 2000 }), { onPassStart, onPassComplete })
    expect(onPassStart).toHaveBeenCalledTimes(1)

    fakeCtx.currentTime = 3.3
    await vi.advanceTimersByTimeAsync(2300)
    expect(onPassStart).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(onPassStart).toHaveBeenCalledTimes(2)
  })

  it('schedules ghost and keeper layers with per-layer gains', async () => {
    const engine = engineWith(buffer())
    const keeper = buffer()
    await engine.play(spec(), undefined, {
      ghostGainDb: 0,
      ghostMute: false,
      extra: [{ buffer: keeper, gainDb: -6, mute: false }],
    })

    expect(sources).toHaveLength(2)
    expect(gains).toHaveLength(2)
    expect(gains[0]?.gain.value).toBe(1)
    expect(gains[1]?.gain.value).toBeCloseTo(10 ** (-6 / 20))
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0, 2)
    expect(sources[1]?.start).toHaveBeenCalledWith(1, 0, 2)
    expect(sources[0]?.connect).toHaveBeenCalledWith(gains[0])
    expect(sources[1]?.connect).toHaveBeenCalledWith(gains[1])
  })

  it('starts keeper extras at their buffer offset so latency-compensated takes line up', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec(), undefined, {
      extra: [{ buffer: buffer(), gainDb: 0, mute: false, offsetMs: 120 }],
    })

    expect(sources).toHaveLength(2)
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0, 2)
    expect(sources[1]?.start).toHaveBeenCalledWith(1, 0.12, 2)
  })

  it('delays an extra layer\'s start by startDelayMs, for song-wide keeper playback', async () => {
    const engine = engineWith(buffer(20))
    await engine.play(spec({ startMs: 0, endMs: 20_000 }), undefined, {
      extra: [
        { buffer: buffer(2), gainDb: 0, mute: false, startDelayMs: 0 },
        { buffer: buffer(2), gainDb: 0, mute: false, startDelayMs: 5000 },
      ],
    })

    expect(sources).toHaveLength(3)
    // Ghost and the first (undelayed) extra both start at `when` = 1.
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0, 20)
    expect(sources[1]?.start).toHaveBeenCalledWith(1, 0, 2)
    // The second extra sits 5s later on the timeline, at its own phrase's spot.
    expect(sources[2]?.start).toHaveBeenCalledWith(6, 0, 2)
  })

  it('skips extra layers whose buffers are missing', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec(), undefined, {
      extra: [{ buffer: null, gainDb: 0, mute: false }],
    })
    expect(sources).toHaveLength(1)
    expect(gains).toHaveLength(1)
  })

  it('applies mute as zero gain on the ghost layer', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec(), undefined, { ghostGainDb: 0, ghostMute: true })
    expect(sources).toHaveLength(1)
    expect(gains[0]?.gain.value).toBe(0)
  })

  it('stop() stops keeper sources as well as ghost', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec(), undefined, {
      extra: [{ buffer: buffer(), gainDb: -24, mute: true }],
    })
    engine.stop()
    expect(sources[0]?.stop).toHaveBeenCalled()
    expect(sources[1]?.stop).toHaveBeenCalled()
    expect(gains[0]?.disconnect).toHaveBeenCalled()
    expect(gains[1]?.disconnect).toHaveBeenCalled()
  })

  it('schedules oscillator ticks at click times on the audio clock', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec({ startMs: 0, endMs: 2000 }), undefined, {
      click: true,
      clickTimesMs: [0, 1000],
    })

    expect(oscillators).toHaveLength(2)
    expect(oscillators[0]?.start).toHaveBeenCalledWith(1)
    expect(oscillators[0]?.stop).toHaveBeenCalledWith(1.02)
    expect(oscillators[1]?.start).toHaveBeenCalledWith(2)
    expect(oscillators[1]?.stop).toHaveBeenCalledWith(2.02)
    expect(oscillators[0]?.connect).toHaveBeenCalledWith(gains[1])
    expect(gains[1]?.connect).toHaveBeenCalledWith(destination)
  })

  it('does not schedule clicks unless mix requests click with times', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec(), undefined, { clickTimesMs: [0, 1000] })
    expect(oscillators).toHaveLength(0)

    await engine.play(spec(), undefined, { click: true, clickTimesMs: [] })
    expect(oscillators).toHaveLength(0)
  })

  it('stop() cancels scheduled click oscillators', async () => {
    const engine = engineWith(buffer())
    await engine.play(spec(), undefined, { click: true, clickTimesMs: [0, 1000] })
    expect(oscillators).toHaveLength(2)
    engine.stop()
    expect(oscillators[0]?.stop).toHaveBeenCalled()
    expect(oscillators[1]?.stop).toHaveBeenCalled()
    expect(oscillators[0]?.disconnect).toHaveBeenCalled()
    expect(gains[1]?.disconnect).toHaveBeenCalled()
  })

  // Regression: a 10s phrase over a ghost whose audio is only 2.5s used to clamp
  // the take to the ghost, so listen-back played ~2s of a 10s performance.
  it('plays a take in full when the ghost audio is shorter than the phrase', async () => {
    const shortGhost = buffer(2.5)
    const take = buffer(9.96)
    const engine = engineWith(shortGhost)

    await engine.play(
      spec({ startMs: 0, endMs: 10_000, preRollMs: 0, postRollMs: 0, loop: false }),
      undefined,
      { extra: [{ buffer: take, gainDb: 0, mute: false }] },
    )

    expect(sources).toHaveLength(2)
    // Ghost still clamps to the audio it actually has.
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0, 2.5)
    // The take plays its whole length regardless of the ghost.
    expect(sources[1]?.start).toHaveBeenCalledWith(1, 0, 9.96)
  })

  it('honours the take offset while still playing the rest of the take in full', async () => {
    const engine = engineWith(buffer(2.5))
    await engine.play(
      spec({ startMs: 0, endMs: 10_000, preRollMs: 0, postRollMs: 0, loop: false }),
      undefined,
      { extra: [{ buffer: buffer(9.96), gainDb: 0, mute: false, offsetMs: 120 }] },
    )

    const [, offsetArg, durationArg] = sources[1]!.start.mock.calls[0] as number[]
    expect(offsetArg).toBeCloseTo(0.12)
    expect(durationArg).toBeCloseTo(9.84)
  })

  it('fires onEnded only after the longest layer ends, not the short ghost', async () => {
    const onEnded = vi.fn()
    const engine = engineWith(buffer(2.5))
    await engine.play(
      spec({ startMs: 0, endMs: 10_000, preRollMs: 0, postRollMs: 0, loop: false }),
      { onEnded },
      { extra: [{ buffer: buffer(9.96), gainDb: 0, mute: false }] },
    )

    const ghostSource = sources[0]!
    const takeSource = sources[1]!

    // Ghost runs out first — listen-back must keep going.
    ghostSource.onended?.call(ghostSource as unknown as AudioBufferSourceNode, new Event('ended'))
    expect(onEnded).not.toHaveBeenCalled()

    takeSource.onended?.call(takeSource as unknown as AudioBufferSourceNode, new Event('ended'))
    // The requested 10s span has not elapsed yet.
    expect(onEnded).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  // Regression: recording stopped when the short ghost ended, so the mic was cut
  // off long before the phrase span the singer was actually singing.
  it('keeps a truncated-ghost pass open for the full phrase span', async () => {
    const onEnded = vi.fn()
    const onPassComplete = vi.fn()
    const engine = engineWith(buffer(2.5))
    await engine.play(
      spec({ startMs: 0, endMs: 10_000, preRollMs: 0, postRollMs: 0, loop: false }),
      { onEnded, onPassComplete },
    )

    // Ghost audio ends at 2.5s; the pass must not.
    sources[0]?.onended?.call(sources[0] as unknown as AudioBufferSourceNode, new Event('ended'))
    await vi.advanceTimersByTimeAsync(2_500)
    expect(onPassComplete).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(7_500)
    expect(onPassComplete).toHaveBeenCalledTimes(1)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('still fires onEnded once when only the ghost is scheduled', async () => {
    const onEnded = vi.fn()
    const engine = engineWith(buffer())
    await engine.play(spec({ loop: false }), { onEnded }, { extra: [{ buffer: null, gainDb: 0 }] })

    expect(sources).toHaveLength(1)
    sources[0]?.onended?.call(sources[0] as unknown as AudioBufferSourceNode, new Event('ended'))
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('reports ghost position from the audio clock and null when stopped', async () => {
    const engine = engineWith(buffer())
    expect(engine.getPositionMs()).toBe(null)

    await engine.play(spec({ startMs: 0, endMs: 2000, preRollMs: 0, postRollMs: 0, loop: false }))
    expect(engine.getPositionMs()).toBe(0)

    fakeCtx.currentTime = 1.5
    expect(engine.getPositionMs()).toBe(500)

    engine.stop()
    expect(engine.getPositionMs()).toBe(null)
  })

  it('offsets position by the play window start', async () => {
    const engine = engineWith(buffer())
    await engine.play(
      spec({ startMs: 1000, endMs: 3000, preRollMs: 250, postRollMs: 100, loop: false }),
    )

    fakeCtx.currentTime = 1.2
    expect(engine.getPositionMs()).toBe(950)
  })

  it('wraps position across loop passes and freezes during the gap', async () => {
    const engine = engineWith(buffer())
    await engine.play(
      spec({ startMs: 0, endMs: 2000, preRollMs: 0, postRollMs: 0, gapMs: 400, loop: true }),
    )

    // origin is currentTime=1. Span 2000 + gap 400 = period 2400.
    fakeCtx.currentTime = 3.2 // elapsed 2200, in the gap
    expect(engine.getPositionMs()).toBe(2000)

    fakeCtx.currentTime = 3.5 // elapsed 2500 → 100 into the next pass
    expect(engine.getPositionMs()).toBe(100)
  })

  it('stays null when Stop cancels during resume', async () => {
    const engine = engineWith(buffer())
    fakeCtx.resume = vi.fn(async () => {
      engine.stop()
      fakeCtx.state = 'running'
    })

    const started = await engine.play(spec())
    expect(started).toBe(false)
    expect(engine.getPositionMs()).toBe(null)
  })
})
