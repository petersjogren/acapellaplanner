export type MicLevelReading = { level: number; living: boolean }

const DEFAULT_ATTACK = 0.35
const DEFAULT_RELEASE = 0.08
const DEFAULT_LIVING_THRESHOLD = 0.02

export function framePeakAbs(timeDomain: Float32Array | Uint8Array): number {
  if (timeDomain.length === 0) return 0
  let peak = 0
  if (timeDomain instanceof Uint8Array) {
    for (const b of timeDomain) {
      const abs = Math.abs(b / 128 - 1)
      if (abs > peak) peak = abs
    }
    return peak
  }
  for (const x of timeDomain) {
    const abs = Math.abs(x)
    if (abs > peak) peak = abs
  }
  return peak
}

export function smoothLevel(
  prev: number,
  sample: number,
  attack = DEFAULT_ATTACK,
  release = DEFAULT_RELEASE,
): number {
  const coeff = sample > prev ? attack : release
  const next = prev + (sample - prev) * coeff
  return Math.min(1, Math.max(0, next))
}

export function classifyMicLevel(
  level: number,
  livingThreshold = DEFAULT_LIVING_THRESHOLD,
): MicLevelReading {
  return { level, living: level >= livingThreshold }
}
