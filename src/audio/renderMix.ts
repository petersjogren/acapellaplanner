import { dbToGain } from './mix.ts'
import type { MixPlaybackLayer, PlaybackMix } from './mix.ts'
import { msToSamples } from './pcm.ts'

export type MixPcm = { sampleRate: number; channels: Float32Array[] }

export function renderPlaybackMix(args: {
  mix: PlaybackMix
  ghost: AudioBuffer | null
  durationMs: number
  sampleRate: number
}): MixPcm {
  const { mix, ghost, durationMs, sampleRate } = args
  const length = msToSamples(durationMs, sampleRate)
  const left = new Float32Array(length)
  const right = new Float32Array(length)

  if (ghost && !mix.ghostMute) {
    addLayer(left, right, ghost, 0, 0, dbToGain(mix.ghostGainDb ?? 0, mix.ghostMute ?? false))
  }

  for (const layer of mix.extra ?? []) {
    mixExtraLayer(left, right, layer, sampleRate)
  }

  return { sampleRate, channels: [left, right] }
}

function mixExtraLayer(
  left: Float32Array,
  right: Float32Array,
  layer: MixPlaybackLayer,
  sampleRate: number,
): void {
  if (layer.mute || !layer.buffer) return
  let dest = msToSamples(layer.startDelayMs ?? 0, sampleRate)
  if (dest < 0) dest = 0
  if (dest >= left.length) return
  const src = msToSamples(layer.offsetMs ?? 0, sampleRate)
  addLayer(left, right, layer.buffer, dest, src, dbToGain(layer.gainDb, layer.mute))
}

function addLayer(
  left: Float32Array,
  right: Float32Array,
  buffer: AudioBuffer,
  dest: number,
  src: number,
  gain: number,
): void {
  if (gain === 0) return
  const srcStart = src < 0 ? 0 : src
  if (srcStart >= buffer.length) return
  const count = Math.min(left.length - dest, buffer.length - srcStart)
  if (count <= 0) return

  const srcL = buffer.getChannelData(0)
  const srcR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : srcL
  for (let i = 0; i < count; i++) {
    left[dest + i] += (srcL[srcStart + i] ?? 0) * gain
    right[dest + i] += (srcR[srcStart + i] ?? 0) * gain
  }
}
