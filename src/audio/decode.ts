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

export async function decodeAudioFile(
  file: File | Blob,
  audioContext?: AudioContext,
): Promise<DecodedAudio> {
  const ctx = audioContext ?? new AudioContext()
  const ownsContext = audioContext === undefined
  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    return {
      buffer,
      durationMs: buffer.duration * 1000,
      sampleRate: buffer.sampleRate,
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message ? error.message : 'Could not decode audio file',
    )
  } finally {
    if (ownsContext) {
      await ctx.close()
    }
  }
}
