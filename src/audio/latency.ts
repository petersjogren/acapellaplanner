import { getAudioContext, resumeAudioContext } from './context.ts'
import { requestMicStream } from './record.ts'

export const DEVICE_PROFILE_STORAGE_KEY = 'acapellaplanner.latency'
export const MAX_LATENCY_MS = 500
export const PEAK_THRESHOLD = 0.2

export type DeviceProfile = {
  latencyCompMs: number
  updatedAt: string
  userAgent: string
}

export type ClapListenIo = {
  playBeep: () => Promise<number>
  listenUntilPeak: (afterTimeMs: number) => Promise<number>
}

export type BrowserClapIo = ClapListenIo & { dispose: () => void }

/**
 * Clap delay in milliseconds. Rejects measurements outside 0–500ms —
 * those are missed claps or clock glitches, not headphone latency.
 */
export function computeLatencyMs(beepTime: number, clapTime: number): number {
  const latencyMs = clapTime - beepTime
  if (latencyMs < 0 || latencyMs > MAX_LATENCY_MS) {
    throw new Error('failed measurement')
  }
  return latencyMs
}

/**
 * Subtract compensation so the take lines up with the ghost.
 * Clamps to >= 0: a take cannot start before the phrase.
 */
export function applyLatencyCompensation(
  recordedAtOffsetMs: number,
  latencyCompMs: number,
): number {
  return Math.max(0, recordedAtOffsetMs - latencyCompMs)
}

export function loadDeviceProfile(): DeviceProfile | null {
  try {
    const raw = localStorage.getItem(DEVICE_PROFILE_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as DeviceProfile).latencyCompMs !== 'number' ||
      !Number.isFinite((parsed as DeviceProfile).latencyCompMs) ||
      typeof (parsed as DeviceProfile).updatedAt !== 'string' ||
      typeof (parsed as DeviceProfile).userAgent !== 'string'
    ) {
      return null
    }
    return parsed as DeviceProfile
  } catch {
    return null
  }
}

export function saveDeviceProfile(profile: DeviceProfile): void {
  localStorage.setItem(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify(profile))
}

export function storedLatencyCompMs(): number {
  return loadDeviceProfile()?.latencyCompMs ?? 0
}

export async function measureClapLatency(io: ClapListenIo): Promise<number> {
  const beepTime = await io.playBeep()
  const clapTime = await io.listenUntilPeak(beepTime)
  return computeLatencyMs(beepTime, clapTime)
}

export function peakAmplitude(timeDomain: Uint8Array): number {
  let peak = 0
  for (const sample of timeDomain) {
    const amp = Math.abs(sample - 128) / 128
    if (amp > peak) peak = amp
  }
  return peak
}

export async function playBeepTone(ctx: AudioContext = getAudioContext()): Promise<number> {
  await resumeAudioContext(ctx)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 880
  const t = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
  osc.connect(gain)
  gain.connect(ctx.destination)
  const beepTime = performance.now()
  osc.start(t)
  osc.stop(t + 0.08)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
  return beepTime
}

export async function createBrowserClapIo(): Promise<BrowserClapIo> {
  const ctx = getAudioContext()
  await resumeAudioContext(ctx)
  const stream = await requestMicStream()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const data = new Uint8Array(analyser.fftSize)

  return {
    playBeep: () => playBeepTone(ctx),
    listenUntilPeak: (afterTimeMs) =>
      new Promise((resolve, reject) => {
        const deadline = afterTimeMs + MAX_LATENCY_MS
        const tick = () => {
          const now = performance.now()
          if (now > deadline) {
            reject(new Error('failed measurement'))
            return
          }
          analyser.getByteTimeDomainData(data)
          if (now >= afterTimeMs && peakAmplitude(data) >= PEAK_THRESHOLD) {
            resolve(now)
            return
          }
          requestAnimationFrame(tick)
        }
        tick()
      }),
    dispose: () => {
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
    },
  }
}
