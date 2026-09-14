export const WAV_HEADER_BYTES = 44

/**
 * Clamp before scaling: a float above 1 would wrap to a loud negative click.
 *
 * Scaling is symmetric (32767 both ways) rather than asymmetric (32768 for
 * negatives) so that a full-scale sine keeps its shape — the extra half-LSB
 * of negative headroom is inaudible and costs a DC-offset asymmetry that
 * shows up as a tick on looped material. NaN clamps to 0 via the Math.min
 * chain, which is why a bad sample cannot become a spike.
 */
export function clampPcm16(sample: number): number {
  if (!Number.isFinite(sample)) return 0
  const clamped = Math.max(-1, Math.min(1, sample))
  return Math.round(clamped * 32767)
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) pcm[i] = clampPcm16(samples[i] ?? 0)
  return pcm
}

/** 16-bit PCM WAV. Mono only — the booth records one channel. */
export function wavFromPcm16(pcm: Int16Array, sampleRate: number): Uint8Array {
  const channels = 1
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataBytes = pcm.length * bytesPerSample
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes)
  const dv = new DataView(out.buffer)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  dv.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, channels, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * blockAlign, true)
  dv.setUint16(32, blockAlign, true)
  dv.setUint16(34, 16, true)
  ascii(36, 'data')
  dv.setUint32(40, dataBytes, true)

  for (let i = 0; i < pcm.length; i++) {
    dv.setInt16(WAV_HEADER_BYTES + i * bytesPerSample, pcm[i] ?? 0, true)
  }
  return out
}

export function encodeWav(buffer: AudioBuffer): Uint8Array {
  return wavFromPcm16(floatToPcm16(buffer.getChannelData(0)), buffer.sampleRate)
}
