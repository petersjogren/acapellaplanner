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

describe('createPlaybackEngine', () => {
  let sources: FakeSource[]
  let gains: FakeGain[]
  let destination: { kind: string }
  let fakeCtx: { currentTime: number; state: AudioContextState; resume: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    sources = []
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
})
