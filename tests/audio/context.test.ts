import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeAudioContext, getAudioContext, resumeAudioContext } from '../../src/audio/context.ts'

describe('audio context singleton', () => {
  afterEach(async () => {
    await closeAudioContext()
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
