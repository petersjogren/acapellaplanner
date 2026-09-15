import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyLatencyCompensation,
  BEEP_DURATION_S,
  BEEP_GAIN,
  binForFreq,
  takePlaybackOffsetMs,
  computeLatencyMs,
  DEVICE_PROFILE_STORAGE_KEY,
  findToneOnset,
  isTonePresent,
  loadDeviceProfile,
  MAX_LATENCY_MS,
  measureClapLatency,
  saveDeviceProfile,
  storedLatencyCompMs,
  toneSnrDb,
  type DeviceProfile,
} from '../../src/audio/latency.ts'

function mockLocalStorage() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(() => {
      store.clear()
    }),
  }
  vi.stubGlobal('localStorage', localStorage)
  return { store, localStorage }
}

describe('computeLatencyMs', () => {
  it('is clapTime minus beepTime', () => {
    expect(computeLatencyMs(1000, 1080)).toBe(80)
  })

  it('accepts the 0ms and 800ms bounds', () => {
    expect(computeLatencyMs(10, 10)).toBe(0)
    expect(computeLatencyMs(10, 810)).toBe(800)
  })

  it('rejects a clap before the beep', () => {
    expect(() => computeLatencyMs(100, 99)).toThrow(/failed measurement/)
  })

  it('rejects a clap more than 800ms after the beep', () => {
    expect(() => computeLatencyMs(0, 801)).toThrow(/failed measurement/)
  })
})

describe('tone detection', () => {
  it('maps 880 Hz to the expected bin at 48 kHz / 2048', () => {
    expect(binForFreq(880, 48000, 2048)).toBe(Math.round(880 / (48000 / 2048)))
  })

  it('reports high SNR when the tone bin is well above neighbours', () => {
    const toneBin = 38
    const spectrum = new Float32Array(128).fill(-70)
    spectrum[toneBin] = -40
    expect(toneSnrDb(spectrum, toneBin)).toBeCloseTo(30)
    expect(isTonePresent(spectrum, toneBin)).toBe(true)
  })

  it('does not fire on flat noise', () => {
    expect(isTonePresent(new Float32Array(128).fill(-60), 38)).toBe(false)
  })

  it('does not fire on a loud clap (energy everywhere)', () => {
    expect(isTonePresent(new Float32Array(128).fill(-25), 38)).toBe(false)
  })

  it('returns the first frame of a 2-frame run after playStart', () => {
    expect(
      findToneOnset(
        [
          { tMs: 1000, present: true },
          { tMs: 1010, present: false },
          { tMs: 1020, present: true },
          { tMs: 1036, present: true },
        ],
        1010,
      ),
    ).toBe(1020)
  })

  it('returns null when the tone never holds for two frames', () => {
    expect(
      findToneOnset(
        [
          { tMs: 1010, present: true },
          { tMs: 1026, present: false },
          { tMs: 1042, present: true },
        ],
        1000,
      ),
    ).toBeNull()
  })

  it('plays a half-second probe near full scale', () => {
    expect(BEEP_DURATION_S).toBe(0.5)
    expect(BEEP_GAIN).toBe(0.9)
  })
})

describe('applyLatencyCompensation', () => {
  it('subtracts compensation so the take lines up with the ghost', () => {
    expect(applyLatencyCompensation(1000, 120)).toBe(880)
  })

  it('clamps aligned offset at 0', () => {
    expect(applyLatencyCompensation(50, 80)).toBe(0)
    expect(applyLatencyCompensation(80, 80)).toBe(0)
  })
})

describe('takePlaybackOffsetMs', () => {
  it('skips the measured latency at the start of the take buffer', () => {
    expect(takePlaybackOffsetMs(120)).toBe(120)
  })

  it('treats missing or non-finite compensation as 0', () => {
    expect(takePlaybackOffsetMs(undefined)).toBe(0)
    expect(takePlaybackOffsetMs(Number.NaN)).toBe(0)
  })

  it('clamps negative compensation at 0', () => {
    expect(takePlaybackOffsetMs(-12)).toBe(0)
  })
})

describe('device profile storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('saves and loads a per-browser profile under acapellaplanner.latency', () => {
    const { store, localStorage } = mockLocalStorage()
    const profile: DeviceProfile = {
      latencyCompMs: 87,
      updatedAt: '2026-09-12T10:00:00.000Z',
      userAgent: 'TestAgent/1.0',
    }

    saveDeviceProfile(profile)

    expect(localStorage.setItem).toHaveBeenCalledWith(
      DEVICE_PROFILE_STORAGE_KEY,
      JSON.stringify(profile),
    )
    expect(DEVICE_PROFILE_STORAGE_KEY).toBe('acapellaplanner.latency')
    expect(store.get(DEVICE_PROFILE_STORAGE_KEY)).toBe(JSON.stringify(profile))
    expect(loadDeviceProfile()).toEqual(profile)
  })

  it('returns null when nothing is stored', () => {
    mockLocalStorage()
    expect(loadDeviceProfile()).toBeNull()
  })

  it('returns null when stored JSON is corrupt', () => {
    const { store } = mockLocalStorage()
    store.set(DEVICE_PROFILE_STORAGE_KEY, '{not-json')
    expect(loadDeviceProfile()).toBeNull()
  })

  it('returns null when the stored object is missing fields', () => {
    const { store } = mockLocalStorage()
    store.set(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify({ latencyCompMs: 12 }))
    expect(loadDeviceProfile()).toBeNull()
  })

  it('treats shaped JSON with out-of-range latencyCompMs as no profile', () => {
    const { store } = mockLocalStorage()
    const base = {
      updatedAt: '2026-09-12T10:00:00.000Z',
      userAgent: 'TestAgent/1.0',
    }

    store.set(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify({ ...base, latencyCompMs: -1 }))
    expect(loadDeviceProfile()).toBeNull()
    expect(storedLatencyCompMs()).toBe(0)

    store.set(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify({ ...base, latencyCompMs: 1e9 }))
    expect(loadDeviceProfile()).toBeNull()
    expect(storedLatencyCompMs()).toBe(0)
  })

  it('loads profiles on the 0ms and 800ms bounds', () => {
    const { store } = mockLocalStorage()
    const base = {
      updatedAt: '2026-09-12T10:00:00.000Z',
      userAgent: 'TestAgent/1.0',
    }

    store.set(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify({ ...base, latencyCompMs: 0 }))
    expect(loadDeviceProfile()?.latencyCompMs).toBe(0)
    expect(storedLatencyCompMs()).toBe(0)

    store.set(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify({ ...base, latencyCompMs: MAX_LATENCY_MS }))
    expect(loadDeviceProfile()?.latencyCompMs).toBe(MAX_LATENCY_MS)
    expect(storedLatencyCompMs()).toBe(MAX_LATENCY_MS)
  })
})

describe('measureClapLatency', () => {
  it('plays a beep then listens for the clap peak', async () => {
    const playBeep = vi.fn().mockResolvedValue(1000)
    const listenUntilPeak = vi.fn().mockResolvedValue(1042)

    await expect(measureClapLatency({ playBeep, listenUntilPeak })).resolves.toBe(42)
    expect(playBeep).toHaveBeenCalledTimes(1)
    expect(listenUntilPeak).toHaveBeenCalledWith(1000)
  })

  it('rejects an out-of-range clap as a failed measurement', async () => {
    await expect(
      measureClapLatency({
        playBeep: async () => 1000,
        listenUntilPeak: async () => 1900,
      }),
    ).rejects.toThrow(/failed measurement/)
  })
})
