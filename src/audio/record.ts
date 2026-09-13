import type { Take } from '../domain/schemas.ts'

export const EMPTY_TAKE_MAX_BYTES = 1024
export const EMPTY_TAKE_MIN_DURATION_MS = 200

export function nextTakeIndex(takes: Take[], phraseId: string, voicePartId: string): number {
  let max = 0
  for (const take of takes) {
    if (take.phraseId === phraseId && take.voicePartId === voicePartId && take.takeIndex > max) {
      max = take.takeIndex
    }
  }
  return max + 1
}

export function isEmptyTake(input: { byteSize: number; durationMs: number }): boolean {
  return input.byteSize < EMPTY_TAKE_MAX_BYTES || input.durationMs < EMPTY_TAKE_MIN_DURATION_MS
}

export function takeLabel(shortLabel: string, phraseIndex: number, takeIndex: number): string {
  return `${shortLabel}_p${phraseIndex}_t${takeIndex}`
}

export function pickRecorderMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  return ''
}

export type RecordingResult = {
  blob: Blob
  mimeType: string
  durationMs: number
  byteSize: number
}

export type StartedRecording = {
  stop: () => Promise<RecordingResult>
}

export function startRecording(stream: MediaStream): StartedRecording {
  const mimeType = pickRecorderMimeType()
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  const startedAt = Date.now()
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }
  recorder.start()
  let stopPromise: Promise<RecordingResult> | null = null

  function resultFromChunks(): RecordingResult {
    const type = recorder.mimeType || mimeType || 'audio/webm'
    const blob = new Blob(chunks, { type })
    return {
      blob,
      mimeType: type,
      durationMs: Math.max(0, Date.now() - startedAt),
      byteSize: blob.size,
    }
  }

  return {
    stop: () => {
      if (stopPromise) return stopPromise
      stopPromise = new Promise((resolve, reject) => {
        recorder.onstop = () => {
          resolve(resultFromChunks())
        }
        recorder.onerror = () => {
          reject(new Error('Recording failed'))
        }
        if (recorder.state === 'recording' || recorder.state === 'paused') {
          recorder.stop()
        } else {
          resolve(resultFromChunks())
        }
      })
      return stopPromise
    },
  }
}

/**
 * Raw capture for singing. `{ audio: true }` silently opts into Chrome's
 * voice-call DSP — echo cancellation, noise suppression and auto gain. On a
 * ghost-track overdub that is actively harmful:
 *
 * - echoCancellation treats the ghost bleeding from headphones (and any
 *   correlated voice) as echo and ducks the take, so a loudly sung phrase can
 *   come back near-silent while the ghost stays audible;
 * - noiseSuppression gates sustained vowels it mistakes for steady noise;
 * - autoGainControl rides the level, wrecking the dynamics a stack depends on.
 *
 * The booth wants the microphone signal as-is.
 */
export const RAW_CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

export async function requestMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone is not available')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: RAW_CAPTURE_CONSTRAINTS })
  } catch (error) {
    // Older/locked-down devices may reject the explicit constraints outright.
    // A processed take still beats no take at all.
    if (error instanceof Error && error.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ audio: true })
    }
    throw error
  }
}

/** Processing that mangles a sung take; reported so the booth can warn. */
export type MicProcessingFlags = {
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

/**
 * What the browser actually applied — asking for raw capture does not guarantee
 * it, and a stream still running AEC is the difference between a usable take
 * and a ducked one.
 */
export function micProcessingFlags(stream: MediaStream): MicProcessingFlags | null {
  if (typeof stream?.getAudioTracks !== 'function') return null
  const track = stream.getAudioTracks()[0]
  if (!track || typeof track.getSettings !== 'function') return null
  const settings = track.getSettings()
  return {
    echoCancellation: settings.echoCancellation === true,
    noiseSuppression: settings.noiseSuppression === true,
    autoGainControl: settings.autoGainControl === true,
  }
}

export function isProcessedCapture(flags: MicProcessingFlags | null): boolean {
  if (!flags) return false
  return flags.echoCancellation || flags.noiseSuppression || flags.autoGainControl
}
