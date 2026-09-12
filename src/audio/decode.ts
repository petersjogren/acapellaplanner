import { getAudioContext } from './context.ts'

export type DecodedAudio = {
  buffer: AudioBuffer
  durationMs: number
  sampleRate: number
}

export function formatDuration(ms: number): string {
  const totalTenths = Math.round(Math.max(0, ms) / 100)
  const tenths = totalTenths % 10
  const totalSeconds = Math.floor(totalTenths / 10)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

/**
 * Decode audio on the playback AudioContext (singleton by default).
 * Do not decode on a throwaway context that is then closed — Safari can reject
 * buffers originating from closed contexts.
 */
export async function decodeAudioFile(
  file: File | Blob,
  audioContext: AudioContext = getAudioContext(),
): Promise<DecodedAudio> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    return {
      buffer,
      durationMs: buffer.duration * 1000,
      sampleRate: buffer.sampleRate,
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message ? error.message : 'Could not decode audio file',
    )
  }
}
