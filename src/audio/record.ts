import type { HeadphoneMixSnapshot, Project, Take } from '../domain/schemas.ts'

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

export function ghostHeadphoneMixSnapshot(project: Project): HeadphoneMixSnapshot {
  const ghost = project.guides.find((guide) => guide.kind === 'ghost')
  return {
    layers: [
      {
        guideOrTakeRef: ghost?.id ?? 'ghost',
        gainDb: 0,
        pan: 0,
        mute: false,
      },
    ],
  }
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

export async function requestMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone is not available')
  }
  return navigator.mediaDevices.getUserMedia({ audio: true })
}
