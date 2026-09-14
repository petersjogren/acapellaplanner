import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyLatencyCompensation,
  takePlaybackOffsetMs,
  computeLatencyMs,
  detectionThreshold,
  DEVICE_PROFILE_STORAGE_KEY,
  loadDeviceProfile,
  MAX_PEAK_THRESHOLD,
  MIN_PEAK_THRESHOLD,
  measureClapLatency,
  saveDeviceProfile,
  storedLatencyCompMs,
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

  it('accepts the 0ms and 500ms bounds', () => {
    expect(computeLatencyMs(10, 10)).toBe(0)
    expect(computeLatencyMs(10, 510)).toBe(500)
  })

  it('rejects a clap before the beep', () => {
    expect(() => computeLatencyMs(100, 99)).toThrow(/failed measurement/)
  })

  it('rejects a clap more than 500ms after the beep', () => {
    expect(() => computeLatencyMs(0, 501)).toThrow(/failed measurement/)
  })
})

describe('detectionThreshold', () => {
  it('floors at MIN_PEAK_THRESHOLD for a silent/near-silent room', () => {
    expect(detectionThreshold(0)).toBe(MIN_PEAK_THRESHOLD)
    expect(detectionThreshold(0.001)).toBe(MIN_PEAK_THRESHOLD)
  })

  it('scales with the measured noise floor between the floor and ceiling', () => {
    // 0.01 * 4 = 0.04, above the 0.03 floor and below the 0.2 ceiling.
    expect(detectionThreshold(0.01)).toBeCloseTo(0.04)
  })

  it('caps at MAX_PEAK_THRESHOLD for a loud/noisy room', () => {
    expect(detectionThreshold(1)).toBe(MAX_PEAK_THRESHOLD)
  })

  it('sits comfortably below a firm clap, unlike the old fixed 0.2 threshold', () => {
    // Headphone bleed-through commonly peaks well under -20 dBFS (~0.1); a
    // fixed 0.2 (~-14 dBFS) threshold never caught it. A quiet room's
    // adaptive threshold does.
    const quietRoomBleed = 0.08
    expect(quietRoomBleed).toBeGreaterThan(detectionThreshold(0.005))
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

  it('loads profiles on the 0ms and 500ms bounds', () => {
    const { store } = mockLocalStorage()
    const base = {
      updatedAt: '2026-09-12T10:00:00.000Z',
      userAgent: 'TestAgent/1.0',
    }

    store.set(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify({ ...base, latencyCompMs: 0 }))
    expect(loadDeviceProfile()?.latencyCompMs).toBe(0)
    expect(storedLatencyCompMs()).toBe(0)

    store.set(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify({ ...base, latencyCompMs: 500 }))
    expect(loadDeviceProfile()?.latencyCompMs).toBe(500)
    expect(storedLatencyCompMs()).toBe(500)
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
        listenUntilPeak: async () => 1600,
      }),
    ).rejects.toThrow(/failed measurement/)
  })
})
