export function msToSamples(ms: number, sampleRate: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 1000) * sampleRate)
}
