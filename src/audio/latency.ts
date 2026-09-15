import { getAudioContext, resumeAudioContext } from './context.ts'
import { framePeakAbs, smoothLevel } from './micLevel.ts'
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

export const CLAP_CLICK_BPM = 100
export const CLAP_CLICK_COUNT = 40
export const CLAP_CLICK_GAIN = 0.35
export const CLAP_CLICK_FREQ_HZ = 1000
export const CLAP_CLICK_DURATION_S = 0.02
export const CLAP_PRE_ROLL_MS = 400
export const CLAP_POST_ROLL_MS = 600
export const CLAP_MIN_MATCHES = 10
export const CLAP_MIN_CLICKS_BEFORE_STOP = 16
export const CLAP_MAX_PAIR_ERROR_MS = 120
export const CLAP_MAX_PAIR_LATENCY_MS = 400
export const CLAP_PAIR_WAIT_MS = 350
export const CLAP_ONSET_GATE = 0.25
export const CLAP_REFRACTORY_MS = 180
export const CLAP_REPLACE_WINDOW_MS = 160
export const CLAP_STABLE_MAD_MS = 20
export const CLAP_STABLE_IQR_MS = 40
export const CLAP_POSTERIOR_HALF_WIDTH_MS = 15
export const CLAP_OUTLIER_MAD_K = 2.5
export const CLAP_PRIOR_MEAN_MS = 90
export const CLAP_PRIOR_STD_MS = 120
export const CLAP_OBS_STD_FLOOR_MS = 8
export const CLAP_NOISE_MULTIPLIER = 4
export const CLAP_ABS_FLOOR = 0.08
const MAD_TO_STD = 1.4826

export type DeviceProfile = {
  latencyCompMs: number
  updatedAt: string
  userAgent: string
}

export type ClapListenIo = {
  playBeep: () => Promise<number>
  listenUntilPeak: (afterTimeMs: number) => Promise<number>
}

export type ClapClickEstimate = {
  latencyMs: number
  matchCount: number
  madMs: number
  iqrMs: number
  stable: boolean
  nInliers: number
  posteriorStdMs: number
}

export type CalibrationIo = ClapListenIo & {
  captureIsProcessed: boolean
  getLevel: () => number
  runClickClapMeasure: () => Promise<ClapClickEstimate>
  dispose: () => void
}
export type BrowserCalibrationIo = CalibrationIo
export type BrowserClapIo = CalibrationIo

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

/** Empty → NaN. Sorts a copy. Even length → mean of the two middle values. */
export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Median absolute deviation from the median. Empty → NaN. */
export function mad(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const center = median(xs)
  return median(xs.map((x) => Math.abs(x - center)))
}

/** Drop points farther than `k` Gaussian-scaled MADs from the median. */
export function rejectOutliersMad(xs: number[], k = CLAP_OUTLIER_MAD_K): number[] {
  if (xs.length < 3) return [...xs]
  const center = median(xs)
  const spread = mad(xs)
  if (!(spread > 0)) return [...xs]
  const thresh = k * MAD_TO_STD * spread
  return xs.filter((x) => Math.abs(x - center) <= thresh)
}

/**
 * Conjugate Normal–Normal update for unknown mean, known σ.
 * Default σ is max(floor, 1.4826 × MAD) so a tight clap cluster
 * yields a tight posterior and a sloppy one keeps us listening.
 */
export function normalNormalPosterior(
  observations: number[],
  opts?: { priorMeanMs?: number; priorStdMs?: number; obsStdMs?: number },
): { meanMs: number; stdMs: number } {
  const priorMeanMs = opts?.priorMeanMs ?? CLAP_PRIOR_MEAN_MS
  const priorStdMs = opts?.priorStdMs ?? CLAP_PRIOR_STD_MS
  if (observations.length === 0) return { meanMs: priorMeanMs, stdMs: priorStdMs }
  const spread = mad(observations)
  const fromMad = Number.isFinite(spread) ? MAD_TO_STD * spread : CLAP_OBS_STD_FLOOR_MS
  const obsStdMs = opts?.obsStdMs ?? Math.max(CLAP_OBS_STD_FLOOR_MS, fromMad)
  const priorPrec = 1 / (priorStdMs * priorStdMs)
  const dataPrec = observations.length / (obsStdMs * obsStdMs)
  const meanBar = observations.reduce((sum, x) => sum + x, 0) / observations.length
  const postPrec = priorPrec + dataPrec
  return {
    meanMs: (priorMeanMs * priorPrec + meanBar * dataPrec) / postPrec,
    stdMs: Math.sqrt(1 / postPrec),
  }
}

/**
 * Median clap−click delay from a click train. Coarse-searches latency
 * (capped below one click period so a late cluster cannot alias to ~600 ms),
 * drops MAD outliers, then a Normal–Normal posterior. Null when too few
 * inliers or the mean is outside 0…maxPairLatencyMs.
 */
export function estimateClapClickLatency(
  clickPerfMs: number[],
  clapPerfMs: number[],
  opts?: {
    minMatches?: number
    maxPairLatencyMs?: number
    stableMadMs?: number
    posteriorHalfWidthMs?: number
    coarseStepMs?: number
    pairGateMs?: number
  },
): ClapClickEstimate | null {
  if (clickPerfMs.length === 0 || clapPerfMs.length === 0) return null

  const minMatches = opts?.minMatches ?? CLAP_MIN_MATCHES
  const maxPairLatencyMs = opts?.maxPairLatencyMs ?? CLAP_MAX_PAIR_LATENCY_MS
  const stableMadMs = opts?.stableMadMs ?? CLAP_STABLE_MAD_MS
  const posteriorHalfWidthMs = opts?.posteriorHalfWidthMs ?? CLAP_POSTERIOR_HALF_WIDTH_MS
  const coarseStepMs = opts?.coarseStepMs ?? 5
  const pairGateMs = opts?.pairGateMs ?? CLAP_MAX_PAIR_ERROR_MS

  const clicks = [...clickPerfMs].sort((a, b) => a - b)
  const claps = [...clapPerfMs].sort((a, b) => a - b)

  const pairResiduals = (latencyMs: number): number[] => {
    const used = claps.map(() => false)
    const residuals: number[] = []
    for (const click of clicks) {
      const target = click + latencyMs
      let bestIdx = -1
      let bestDist = Infinity
      for (let i = 0; i < claps.length; i++) {
        if (used[i]) continue
        const dist = Math.abs(claps[i]! - target)
        if (dist <= pairGateMs && dist < bestDist) {
          bestDist = dist
          bestIdx = i
        }
      }
      if (bestIdx >= 0) {
        used[bestIdx] = true
        residuals.push(claps[bestIdx]! - click)
      }
    }
    return residuals
  }

  let bestScore = 0
  let bestMad = Infinity
  let bestL: number | null = null
  for (let L = 0; L <= maxPairLatencyMs; L += coarseStepMs) {
    const residuals = pairResiduals(L)
    if (residuals.length === 0) continue
    const center = median(residuals)
    const spread = mad(residuals)
    if (residuals.length > bestScore || (residuals.length === bestScore && spread < bestMad)) {
      bestScore = residuals.length
      bestMad = spread
      bestL = Math.round(center)
    }
  }
  if (bestL == null) return null

  const residuals = pairResiduals(bestL)
  const inliers = rejectOutliersMad(residuals)
  if (inliers.length < minMatches) return null

  const belief = normalNormalPosterior(inliers)
  const latencyMs = Math.round(belief.meanMs)
  if (latencyMs < 0 || latencyMs > maxPairLatencyMs) return null

  const madMs = mad(inliers)
  const sorted = [...inliers].sort((a, b) => a - b)
  const n = sorted.length
  const iqrMs = sorted[Math.floor((n - 1) * 0.75)]! - sorted[Math.floor((n - 1) * 0.25)]!
  const halfWidth = 1.96 * belief.stdMs
  const stable = inliers.length >= minMatches && madMs <= stableMadMs && halfWidth <= posteriorHalfWidthMs

  return {
    latencyMs,
    matchCount: residuals.length,
    madMs,
    iqrMs,
    stable,
    nInliers: inliers.length,
    posteriorStdMs: belief.stdMs,
  }
}

/** True when enough closed clicks have a tight posterior — stop the train. */
export function clapMeasureShouldStop(
  nowMs: number,
  clickPerfMs: number[],
  clapPerfMs: number[],
): ClapClickEstimate | null {
  const closed = clickPerfMs.filter((t) => nowMs >= t + CLAP_PAIR_WAIT_MS)
  if (closed.length < CLAP_MIN_CLICKS_BEFORE_STOP) return null
  const estimate = estimateClapClickLatency(closed, clapPerfMs)
  return estimate?.stable ? estimate : null
}

export function clickTrainAudioTimes(tFirst: number, count: number, bpm: number): number[] {
  const intervalS = 60 / bpm
  return Array.from({ length: count }, (_, i) => tFirst + i * intervalS)
}

export function audioTimesToPerfMs(
  audioTimes: number[],
  audioOrigin: number,
  perfOrigin: number,
): number[] {
  return audioTimes.map((when) => perfOrigin + (when - audioOrigin) * 1000)
}

export function shouldRecordClapOnset(
  peak: number,
  noiseFloor: number,
  nowMs: number,
  lastClapMs: number,
  opts?: { refractoryMs?: number; gate?: number; floorMul?: number; absFloor?: number },
): boolean {
  const refractoryMs = opts?.refractoryMs ?? CLAP_REFRACTORY_MS
  const floorMul = opts?.floorMul ?? CLAP_NOISE_MULTIPLIER
  const absFloor = opts?.absFloor ?? CLAP_ABS_FLOOR
  if (nowMs - lastClapMs < refractoryMs) return false
  return peak >= Math.max(noiseFloor * floorMul, absFloor)
}

/**
 * Headphone click leak often fires first; the real clap is louder a moment later.
 * Replace the last onset when a higher peak arrives inside the window.
 */
export function shouldReplaceClapOnset(
  peak: number,
  lastPeak: number,
  nowMs: number,
  lastClapMs: number,
  opts?: { replaceWindowMs?: number },
): boolean {
  const replaceWindowMs = opts?.replaceWindowMs ?? CLAP_REPLACE_WINDOW_MS
  if (nowMs <= lastClapMs) return false
  if (nowMs - lastClapMs >= replaceWindowMs) return false
  return peak > lastPeak
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

export async function playClickTrain(
  ctx: AudioContext,
  opts?: { count?: number; bpm?: number; preRollMs?: number; gain?: number },
): Promise<{ clickPerfMs: number[]; done: Promise<void>; stop: () => void }> {
  await resumeAudioContext(ctx)
  const count = opts?.count ?? CLAP_CLICK_COUNT
  const bpm = opts?.bpm ?? CLAP_CLICK_BPM
  const preRollMs = opts?.preRollMs ?? CLAP_PRE_ROLL_MS
  const gainValue = opts?.gain ?? CLAP_CLICK_GAIN
  const audioOrigin = ctx.currentTime
  const perfOrigin = performance.now()
  const tFirst = audioOrigin + preRollMs / 1000
  const clickAudio = clickTrainAudioTimes(tFirst, count, bpm)
  const clickPerfMs = audioTimesToPerfMs(clickAudio, audioOrigin, perfOrigin)
  const nodes: Array<{ osc: OscillatorNode; when: number }> = []
  for (const when of clickAudio) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = CLAP_CLICK_FREQ_HZ
    gain.gain.value = gainValue
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(when)
    osc.stop(when + CLAP_CLICK_DURATION_S)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    nodes.push({ osc, when })
  }
  const lastEnd = (clickAudio[clickAudio.length - 1] ?? tFirst) + CLAP_CLICK_DURATION_S
  let finished = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let resolveDone: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    resolveDone = () => {
      if (finished) return
      finished = true
      resolve()
    }
  })
  const armTimer = (waitMs: number) => {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    timeoutId = setTimeout(resolveDone, Math.max(0, waitMs))
  }
  armTimer((lastEnd - ctx.currentTime) * 1000 + CLAP_POST_ROLL_MS)
  const stop = () => {
    const now = ctx.currentTime
    for (const { osc, when } of nodes) {
      if (when > now) {
        try {
          osc.stop(now)
        } catch {
          // already stopped
        }
      }
    }
    armTimer(CLAP_POST_ROLL_MS)
  }
  return { clickPerfMs, done, stop }
}

export async function createBrowserCalibrationIo(): Promise<BrowserCalibrationIo> {
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
  const timeDomain = new Float32Array(analyser.fftSize)
  const toneBin = binForFreq(TONE_FREQ_HZ, ctx.sampleRate, analyser.fftSize)
  const captureIsProcessed = isProcessedCapture(micProcessingFlags(stream))

  let currentLevel = 0
  let rafId = 0
  let disposed = false
  let measuring = false
  let noiseEma = 0
  let noiseFloor = 0.01
  let firstClickPerfMs: number | null = null
  let lastClapMs = Number.NEGATIVE_INFINITY
  let lastClapPeak = 0
  let clapOnsets: number[] = []

  const tickLevel = () => {
    if (disposed) return
    analyser.getFloatTimeDomainData(timeDomain)
    const peak = framePeakAbs(timeDomain)
    currentLevel = smoothLevel(currentLevel, peak)
    if (measuring) {
      const now = performance.now()
      if (firstClickPerfMs == null || now < firstClickPerfMs) {
        noiseEma = smoothLevel(noiseEma, peak)
        noiseFloor = Math.max(noiseEma, 0.01)
      } else if (clapOnsets.length > 0 && shouldReplaceClapOnset(peak, lastClapPeak, now, lastClapMs)) {
        clapOnsets[clapOnsets.length - 1] = now
        lastClapMs = now
        lastClapPeak = peak
      } else if (shouldRecordClapOnset(peak, noiseFloor, now, lastClapMs)) {
        lastClapMs = now
        lastClapPeak = peak
        clapOnsets.push(now)
      }
    }
    rafId = requestAnimationFrame(tickLevel)
  }
  rafId = requestAnimationFrame(tickLevel)

  return {
    captureIsProcessed,
    getLevel: () => currentLevel,
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
    runClickClapMeasure: async () => {
      clapOnsets = []
      lastClapMs = Number.NEGATIVE_INFINITY
      lastClapPeak = 0
      noiseEma = 0
      noiseFloor = 0.01
      firstClickPerfMs = null
      measuring = true
      let stoppedEarly = false
      const { clickPerfMs, done, stop } = await playClickTrain(ctx)
      firstClickPerfMs = clickPerfMs[0] ?? null
      let watchId = 0
      const watch = () => {
        if (!measuring || stoppedEarly) return
        if (clapMeasureShouldStop(performance.now(), clickPerfMs, clapOnsets)) {
          stoppedEarly = true
          stop()
          return
        }
        watchId = requestAnimationFrame(watch)
      }
      watchId = requestAnimationFrame(watch)
      try {
        await done
      } finally {
        measuring = false
        cancelAnimationFrame(watchId)
      }
      const now = performance.now()
      const closed = clickPerfMs.filter((t) => now >= t + CLAP_PAIR_WAIT_MS)
      const estimate = estimateClapClickLatency(
        closed.length >= CLAP_MIN_CLICKS_BEFORE_STOP ? closed : clickPerfMs,
        clapOnsets,
      )
      if (!estimate?.stable) throw new Error('failed measurement')
      return estimate
    },
    dispose: () => {
      disposed = true
      measuring = false
      cancelAnimationFrame(rafId)
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
    },
  }
}

export async function createBrowserClapIo(): Promise<BrowserClapIo> {
  return createBrowserCalibrationIo()
}
