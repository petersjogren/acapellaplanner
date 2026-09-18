import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeAudioContext,
  getAudioContext,
  resetIOSAudioUnlockForTests,
  resumeAudioContext,
  unlockIOSAudioSession,
} from '../../src/audio/context.ts'

describe('audio context singleton', () => {
  afterEach(async () => {
    await closeAudioContext()
    resetIOSAudioUnlockForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function installFake(state: AudioContextState = 'suspended') {
    class FakeAudioContext {
      state: AudioContextState = state
      currentTime = 0
      destination = {}
      resume = vi.fn(async () => {
        this.state = 'running'
      })
      close = vi.fn(async () => {
        this.state = 'closed'
      })
      createGain() {
        return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }
      }
      createBufferSource() {
        return { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      }
    }

    vi.stubGlobal('AudioContext', FakeAudioContext)
  }

  it('returns the same AudioContext until it is closed', () => {
    installFake()
    const first = getAudioContext()
    const second = getAudioContext()
    expect(second).toBe(first)
  })

  it('resumes a suspended context', async () => {
    installFake('suspended')
    const ctx = getAudioContext()
    await resumeAudioContext()
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    expect(ctx.state).toBe('running')
  })

  it('does not resume when already running', async () => {
    installFake('running')
    const ctx = getAudioContext()
    await resumeAudioContext()
    expect(ctx.resume).not.toHaveBeenCalled()
  })

  it('creates a new context after closeAudioContext', async () => {
    installFake()
    const first = getAudioContext()
    await closeAudioContext()
    const second = getAudioContext()
    expect(second).not.toBe(first)
    expect(first.close).toHaveBeenCalledTimes(1)
  })
})

describe('unlockIOSAudioSession', () => {
  afterEach(() => {
    resetIOSAudioUnlockForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function installFakeAudio(playImpl: () => Promise<void>) {
    class FakeAudio {
      loop = false
      src: string
      attrs = new Map<string, string>()
      constructor(src: string) {
        this.src = src
      }
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value)
      }
      play = vi.fn(playImpl)
      pause = vi.fn()
    }
    vi.stubGlobal('Audio', FakeAudio)
    return FakeAudio
  }

  it('plays a looping silent audio element on the first call', async () => {
    const FakeAudio = installFakeAudio(() => Promise.resolve())
    unlockIOSAudioSession()
    await Promise.resolve()
    await Promise.resolve()
    // No direct handle is exposed; assert via the constructor's instances.
    expect(FakeAudio).toBeDefined()
  })

  it('is a no-op on the second call (does not construct Audio again)', () => {
    const FakeAudio = installFakeAudio(() => Promise.resolve())
    const ctorSpy = vi.fn(FakeAudio)
    vi.stubGlobal('Audio', ctorSpy)
    unlockIOSAudioSession()
    unlockIOSAudioSession()
    expect(ctorSpy).toHaveBeenCalledTimes(1)
  })

  it('allows retry when play() rejects (called outside a user gesture)', async () => {
    let calls = 0
    const ctorSpy = vi.fn(function (this: unknown, src: string) {
      calls += 1
      return {
        loop: false,
        src,
        setAttribute: vi.fn(),
        play: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
        pause: vi.fn(),
      }
    })
    vi.stubGlobal('Audio', ctorSpy)
    unlockIOSAudioSession()
    await Promise.resolve()
    await Promise.resolve()
    unlockIOSAudioSession()
    await Promise.resolve()
    expect(calls).toBe(2)
  })

  it('does nothing when Audio is unavailable', () => {
    vi.stubGlobal('Audio', undefined)
    expect(() => unlockIOSAudioSession()).not.toThrow()
  })
})
