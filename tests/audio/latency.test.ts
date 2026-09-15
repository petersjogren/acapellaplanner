import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyLatencyCompensation,
  audioTimesToPerfMs,
  BEEP_DURATION_S,
  BEEP_GAIN,
  binForFreq,
  takePlaybackOffsetMs,
  CLAP_MIN_CLICKS_BEFORE_STOP,
  CLAP_PAIR_WAIT_MS,
  CLAP_REFRACTORY_MS,
  CLAP_REPLACE_WINDOW_MS,
  CLAP_STABLE_MAD_MS,
  clapMeasureShouldStop,
  clickTrainAudioTimes,
  computeLatencyMs,
  DEVICE_PROFILE_STORAGE_KEY,
  estimateClapClickLatency,
  findToneOnset,
  isTonePresent,
  loadDeviceProfile,
  mad,
  MAX_LATENCY_MS,
  measureClapLatency,
  median,
  normalNormalPosterior,
  rejectOutliersMad,
  saveDeviceProfile,
  shouldRecordClapOnset,
  shouldReplaceClapOnset,
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

describe('median', () => {
  it('is NaN for an empty list', () => {
    expect(median([])).toBeNaN()
  })

  it('is the middle value of an odd-length list', () => {
    expect(median([1, 3, 2])).toBe(2)
  })

  it('is the mean of the two middle values of an even-length list', () => {
    expect(median([1, 4, 2, 3])).toBe(2.5)
  })

  it('does not mutate the input', () => {
    const xs = [3, 1]
    median(xs)
    expect(xs).toEqual([3, 1])
  })
})

describe('mad and rejectOutliersMad', () => {
  it('is NaN for an empty list', () => {
    expect(mad([])).toBeNaN()
  })

  it('is zero when every value is the same', () => {
    expect(mad([90, 90, 90])).toBe(0)
  })

  it('drops far residuals and keeps the tight cluster', () => {
    const xs = [88, 90, 91, 89, 92, 87, 90, 88, 91, 89, 400, 12]
    const kept = rejectOutliersMad(xs)
    expect(kept.every((x) => x > 80 && x < 100)).toBe(true)
    expect(kept).toHaveLength(10)
  })

  it('keeps short lists intact', () => {
    expect(rejectOutliersMad([90, 400])).toEqual([90, 400])
  })
})

describe('normalNormalPosterior', () => {
  it('returns the prior when there are no observations', () => {
    expect(normalNormalPosterior([])).toEqual({ meanMs: 90, stdMs: 120 })
  })

  it('hardly moves a tight 90ms cluster toward the prior', () => {
    const obs = Array.from({ length: 16 }, () => 90)
    const post = normalNormalPosterior(obs)
    expect(post.meanMs).toBeCloseTo(90, 0)
    expect(1.96 * post.stdMs).toBeLessThan(15)
  })

  it('keeps a consistent 19ms wired cluster near 19ms', () => {
    const obs = Array.from({ length: 16 }, () => 19)
    const post = normalNormalPosterior(obs)
    expect(post.meanMs).toBeCloseTo(19, 0)
  })
})

describe('estimateClapClickLatency', () => {
  const clicks = Array.from({ length: 16 }, (_, i) => 1000 + i * 600)
  const claps = clicks.map((t, i) => t + 87 + (i % 2 === 0 ? 3 : -2))

  it('estimates posterior mean near 87ms and marks stable', () => {
    const est = estimateClapClickLatency(clicks, claps)!
    expect(est.latencyMs).toBeGreaterThanOrEqual(85)
    expect(est.latencyMs).toBeLessThanOrEqual(90)
    expect(est.stable).toBe(true)
    expect(est.nInliers).toBeGreaterThanOrEqual(10)
    expect(est.matchCount).toBeGreaterThanOrEqual(10)
    expect(1.96 * est.posteriorStdMs).toBeLessThanOrEqual(15)
  })

  it('returns null when only 2 claps land', () => {
    expect(estimateClapClickLatency(clicks, claps.slice(0, 2))).toBeNull()
  })

  it('pairs high-jitter claps but marks the estimate unstable when MAD exceeds the threshold', () => {
    const jitterClicks = Array.from({ length: 16 }, (_, i) => i * 600)
    const jitter = [80, -70, 90, -85, 75, -60, 95, -50, 70, -65, 85, -55, 78, -72, 88, -48]
    const jitterClaps = jitterClicks.map((t, i) => t + 87 + jitter[i]!)
    const est = estimateClapClickLatency(jitterClicks, jitterClaps)
    expect(est).not.toBeNull()
    expect(est!.matchCount).toBeGreaterThanOrEqual(10)
    expect(est!.stable).toBe(false)
    expect(est!.madMs).toBeGreaterThan(CLAP_STABLE_MAD_MS)
  })

  it('ignores a double-clap outlier via MAD rejection', () => {
    const withOutlier = claps.map((c, i) => (i === 3 ? c + 90 : c))
    const est = estimateClapClickLatency(clicks, withOutlier)!
    expect(est.latencyMs).toBeGreaterThanOrEqual(85)
    expect(est.latencyMs).toBeLessThanOrEqual(90)
    expect(est.nInliers).toBeLessThan(est.matchCount)
  })

  it('does not lock onto a one-beat (~600ms) alias', () => {
    const lateClaps = clicks.map((t) => t + 650)
    const est = estimateClapClickLatency(clicks, lateClaps)
    if (est) {
      expect(est.latencyMs).toBeLessThan(400)
      expect(est.latencyMs).not.toBeGreaterThanOrEqual(600)
    }
  })

  it('refuses to save a bimodal bleed-vs-clap mix', () => {
    const mixed = clicks.map((t, i) => t + (i % 2 === 0 ? 19 : 90))
    const est = estimateClapClickLatency(clicks, mixed)
    expect(est == null || est.stable === false).toBe(true)
  })

  it('rejects a negative median latency', () => {
    const earlyClaps = clicks.map((t) => t - 50)
    expect(estimateClapClickLatency(clicks, earlyClaps)).toBeNull()
  })

  it('rejects a cluster above the pair-latency cap', () => {
    const lateClaps = clicks.map((t) => t + 450)
    expect(estimateClapClickLatency(clicks, lateClaps)).toBeNull()
  })
})

describe('clapMeasureShouldStop', () => {
  const clicks = Array.from({ length: 20 }, (_, i) => 1000 + i * 600)
  const claps = clicks.map((t, i) => t + 88 + (i % 2 === 0 ? 2 : -1))

  it('does not stop before 16 clicks have closed their pair window', () => {
    const now = clicks[CLAP_MIN_CLICKS_BEFORE_STOP - 2]! + CLAP_PAIR_WAIT_MS
    expect(clapMeasureShouldStop(now, clicks, claps)).toBeNull()
  })

  it('stops once 16 tight claps have closed', () => {
    const now = clicks[CLAP_MIN_CLICKS_BEFORE_STOP - 1]! + CLAP_PAIR_WAIT_MS
    const est = clapMeasureShouldStop(now, clicks, claps)
    expect(est).not.toBeNull()
    expect(est!.stable).toBe(true)
    expect(est!.latencyMs).toBeGreaterThanOrEqual(85)
    expect(est!.latencyMs).toBeLessThanOrEqual(91)
  })

  it('keeps going when closed clicks are still sloppy', () => {
    const sloppy = clicks.map((t, i) => t + (i % 2 === 0 ? 20 : 180))
    const now = clicks[19]! + CLAP_PAIR_WAIT_MS
    expect(clapMeasureShouldStop(now, clicks, sloppy)).toBeNull()
  })
})

describe('clickTrainAudioTimes', () => {
  it('schedules 12 clicks at 100 BPM starting at 1.0', () => {
    const times = clickTrainAudioTimes(1.0, 12, 100)
    expect(times).toHaveLength(12)
    expect(times[0]).toBe(1.0)
    expect(times[1]! - times[0]!).toBeCloseTo(0.6)
    expect(times[11]).toBeCloseTo(1 + 11 * 0.6)
  })
})

describe('audioTimesToPerfMs', () => {
  it('maps audio-clock times linearly onto the performance timeline', () => {
    expect(audioTimesToPerfMs([1, 1.6, 2.2], 1, 1000)).toEqual([1000, 1600, 2200])
  })
})

describe('shouldRecordClapOnset', () => {
  it('rejects a peak below the noise floor threshold', () => {
    expect(shouldRecordClapOnset(0.05, 0.02, 1000, Number.NEGATIVE_INFINITY)).toBe(false)
  })

  it('accepts a peak above the noise floor threshold', () => {
    expect(shouldRecordClapOnset(0.2, 0.02, 1000, Number.NEGATIVE_INFINITY)).toBe(true)
  })

  it('blocks a second peak inside the refractory window', () => {
    expect(shouldRecordClapOnset(0.2, 0.02, 1000 + 100, 1000)).toBe(false)
  })

  it('accepts a peak again after the refractory window', () => {
    expect(shouldRecordClapOnset(0.2, 0.02, 1000 + CLAP_REFRACTORY_MS, 1000)).toBe(true)
  })
})

describe('shouldReplaceClapOnset', () => {
  it('replaces a quieter click-leak with a louder clap in the same window', () => {
    expect(shouldReplaceClapOnset(0.5, 0.12, 1090, 1015)).toBe(true)
  })

  it('does not replace after the replace window', () => {
    expect(shouldReplaceClapOnset(0.5, 0.12, 1015 + CLAP_REPLACE_WINDOW_MS, 1015)).toBe(false)
  })

  it('does not replace a quieter later peak', () => {
    expect(shouldReplaceClapOnset(0.1, 0.4, 1090, 1015)).toBe(false)
  })
})
