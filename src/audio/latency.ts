import { getAudioContext, resumeAudioContext } from './context.ts'
import { isProcessedCapture, micProcessingFlags, requestMicStream } from './record.ts'

export const DEVICE_PROFILE_STORAGE_KEY = 'acapellaplanner.latency'
export const MAX_LATENCY_MS = 800

export const TONE_FREQ_HZ = 880
export const TONE_SNR_DB = 8
export const TONE_CONSECUTIVE_FRAMES = 2
export const ANALYSER_FFT_SIZE = 2048
export const BEEP_DURATION_S = 0.5
export const BEEP_GAIN = 0.9
export const BEEP_FADE_S = 0.012
export const WARMUP_MS = 300

export type DeviceProfile = {
  latencyCompMs: number
  updatedAt: string
  userAgent: string
}

export type ClapListenIo = {
  playBeep: () => Promise<number>
  listenUntilPeak: (afterTimeMs: number) => Promise<number>
}

export type BrowserClapIo = ClapListenIo & {
  dispose: () => void
  captureIsProcessed: boolean
}

export type BeepProbe = {
  durationS: number
  gain: number
}

export type DetectionFrame = { tMs: number; present: boolean }

export function binForFreq(freqHz: number, sampleRate: number, fftSize: number): number {
  return Math.round(freqHz / (sampleRate / fftSize))
}

/** Median dB of bins ±3..±10 around the tone bin. Empty → -Infinity. */
export function neighborMedianDb(spectrum: Float32Array, toneBin: number): number {
  const values: number[] = []
  for (const delta of [-10, -9, -8, -7, -6, -5, -4, -3, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const v = spectrum[toneBin + delta]
    if (v != null && Number.isFinite(v)) values.push(v)
  }
  if (values.length === 0) return Number.NEGATIVE_INFINITY
  values.sort((a, b) => a - b)
  const mid = Math.floor(values.length / 2)
  return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2
}

export function toneSnrDb(spectrum: Float32Array, toneBin: number): number {
  const tone = spectrum[toneBin]
  if (tone == null || !Number.isFinite(tone)) return Number.NEGATIVE_INFINITY
  const noise = neighborMedianDb(spectrum, toneBin)
  if (!Number.isFinite(noise)) return Number.NEGATIVE_INFINITY
  return tone - noise
}

export function isTonePresent(
  spectrum: Float32Array,
  toneBin: number,
  snrDb = TONE_SNR_DB,
): boolean {
  return toneSnrDb(spectrum, toneBin) >= snrDb
}

/** First timestamp of `consecutive` present frames at/after playStartMs. */
export function findToneOnset(
  frames: DetectionFrame[],
  playStartMs: number,
  consecutive = TONE_CONSECUTIVE_FRAMES,
): number | null {
  let run = 0
  let runStart: number | null = null
  for (const frame of frames) {
    if (frame.tMs < playStartMs || !frame.present) {
      run = 0
      runStart = null
      continue
    }
    if (run === 0) runStart = frame.tMs
    run += 1
    if (run >= consecutive) return runStart
  }
  return null
}

/**
 * Bleed-through delay in milliseconds. Rejects measurements outside 0–800ms —
 * those are a missed bleed-through or clock glitches, not headphone latency.
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

/**
 * Skip this many milliseconds at the start of a take buffer so the
 * performance lines up with the ghost. Round-trip latency shows up as
 * leading delay in the recording; skipping it is what Hear-it / keepers use.
 */
export function takePlaybackOffsetMs(latencyCompMs: number | undefined): number {
  if (latencyCompMs == null || !Number.isFinite(latencyCompMs)) return 0
  return Math.max(0, latencyCompMs)
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
    const profile = parsed as DeviceProfile
    if (profile.latencyCompMs < 0 || profile.latencyCompMs > MAX_LATENCY_MS) {
      return null
    }
    return profile
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

export async function playBeepTone(
  ctx: AudioContext = getAudioContext(),
  probe: BeepProbe = { durationS: BEEP_DURATION_S, gain: BEEP_GAIN },
): Promise<number> {
  await resumeAudioContext(ctx)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = TONE_FREQ_HZ
  const peak = Math.max(probe.gain, 0.0001)
  const fade = Math.min(BEEP_FADE_S, probe.durationS / 2)
  const t = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + fade)
  gain.gain.setValueAtTime(peak, t + probe.durationS - fade)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + probe.durationS)
  osc.connect(gain)
  gain.connect(ctx.destination)
  const beepTime = performance.now()
  osc.start(t)
  osc.stop(t + probe.durationS)
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
  analyser.fftSize = ANALYSER_FFT_SIZE
  analyser.smoothingTimeConstant = 0
  analyser.minDecibels = -90
  analyser.maxDecibels = -20
  source.connect(analyser)
  const freq = new Float32Array(analyser.frequencyBinCount)
  const toneBin = binForFreq(TONE_FREQ_HZ, ctx.sampleRate, analyser.fftSize)
  const captureIsProcessed = isProcessedCapture(micProcessingFlags(stream))

  return {
    captureIsProcessed,
    playBeep: () => playBeepTone(ctx),
    listenUntilPeak: (afterTimeMs) =>
      new Promise((resolve, reject) => {
        const deadline = afterTimeMs + MAX_LATENCY_MS
        let run = 0
        let runStart: number | null = null
        const tick = () => {
          const now = performance.now()
          if (now > deadline) {
            reject(new Error('failed measurement'))
            return
          }
          analyser.getFloatFrequencyData(freq)
          const present = now >= afterTimeMs && isTonePresent(freq, toneBin)
          if (!present) {
            run = 0
            runStart = null
          } else {
            if (run === 0) runStart = now
            run += 1
            if (run >= TONE_CONSECUTIVE_FRAMES) {
              resolve(runStart ?? now)
              return
            }
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
