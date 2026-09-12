import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLatencyCompensation,
  computeLatencyMs,
  DEVICE_PROFILE_STORAGE_KEY,
  loadDeviceProfile,
  measureClapLatency,
  saveDeviceProfile,
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

describe('applyLatencyCompensation', () => {
  it('subtracts compensation so the take lines up with the ghost', () => {
    expect(applyLatencyCompensation(1000, 120)).toBe(880)
  })

  it('clamps aligned offset at 0', () => {
    expect(applyLatencyCompensation(50, 80)).toBe(0)
    expect(applyLatencyCompensation(80, 80)).toBe(0)
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
