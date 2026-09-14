import { getAudioContext, resumeAudioContext } from './context.ts'
import { dbToGain, type PlaybackMix } from './mix.ts'
import {
  computeLoopDeadlines,
  computePlayWindow,
  phraseEnterDelayMs,
  type PhrasePlaySpec,
  type PlayWindow,
} from './schedule.ts'

export type { PhrasePlaySpec, PlayWindow } from './schedule.ts'
export type { PlaybackMix } from './mix.ts'
export { computeLoopDeadlines, computePlayWindow, phraseEnterDelayMs } from './schedule.ts'

/** How far ahead of a loop deadline we create/start the next BufferSource. */
const LOOP_LOOKAHEAD_MS = 100
const CLICK_FREQ_HZ = 1000
const CLICK_DURATION_SEC = 0.02

export type PlaybackListeners = {
  onEnded?: () => void
  onPhraseEnter?: () => void
  /** Play-window start (pre-roll boundary) for each pass. */
  onPassStart?: () => void
  /** Play-window end (phrase end + post-roll) for each pass. */
  onPassComplete?: () => void
}

export type PlaybackEngine = {
  /** Resolves true when playback actually started; false if cancelled during resume. */
  play: (
    spec: PhrasePlaySpec,
    listeners?: PlaybackListeners,
    mix?: PlaybackMix,
  ) => Promise<boolean>
  stop: () => void
}

type ScheduledLayer = {
  buffer: AudioBuffer
  output: GainNode
  offsetMs: number
  /**
   * Ghost clips to the audio that exists (window.durationMs); takes clip to the
   * phrase span that was asked for (window.requestedDurationMs). Clamping a take
   * to a short ghost is what truncated listen-back to the ghost's length.
   */
  limitMs: (window: PlayWindow) => number
  /**
   * Delay (ms) after the overall play `when` before this layer's source
   * starts. Zero for every layer except song-wide playback, where each
   * keeper take sits at its own phrase's position instead of starting with
   * everything else.
   */
  startDelayMs?: number
}

/** Ghost clips to the audio that exists. */
const GHOST_LIMIT = (window: PlayWindow) => window.durationMs
/** The phrase span that was asked for; takes and pass timing follow this. */
const REQUESTED_SPAN = (window: PlayWindow) => window.requestedDurationMs ?? window.durationMs

export type PlaybackEngineOptions = {
  getBuffer: () => AudioBuffer | null
}

export function createPlaybackEngine({ getBuffer }: PlaybackEngineOptions): PlaybackEngine {
  let generation = 0
  const sources = new Set<AudioBufferSourceNode>()
  const oscillators = new Set<OscillatorNode>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const outputGains = new Set<GainNode>()

  function clearTimers() {
    for (const id of timers) clearTimeout(id)
    timers.clear()
  }

  function disconnectSource(source: AudioBufferSourceNode) {
    try {
      source.stop()
    } catch {
      // already stopped or not started
    }
    try {
      source.disconnect()
    } catch {
      // already disconnected
    }
  }

  function disconnectGain(node: GainNode) {
    try {
      node.disconnect()
    } catch {
      // already disconnected
    }
  }

  function disconnectOscillator(osc: OscillatorNode) {
    try {
      osc.stop()
    } catch {
      // already stopped or not started
    }
    try {
      osc.disconnect()
    } catch {
      // already disconnected
    }
  }

  function stop() {
    generation += 1
    clearTimers()
    for (const source of sources) {
      disconnectSource(source)
    }
    sources.clear()
    for (const osc of oscillators) {
      disconnectOscillator(osc)
    }
    oscillators.clear()
    for (const node of outputGains) {
      disconnectGain(node)
    }
    outputGains.clear()
  }

  function armTimer(delayMs: number, gen: number, fn: () => void) {
    const id = setTimeout(() => {
      timers.delete(id)
      if (gen !== generation) return
      fn()
    }, Math.max(0, delayMs))
    timers.add(id)
  }

  /** Returns the scheduled duration in seconds, or 0 when nothing was started. */
  function startLayer(
    ctx: AudioContext,
    layer: ScheduledLayer,
    window: PlayWindow,
    when: number,
    gen: number,
    onEnded?: () => void,
  ): number {
    const offsetSec = layer.offsetMs / 1000
    const remainingSec = layer.buffer.duration - offsetSec
    const durationSec = Math.min(layer.limitMs(window) / 1000, remainingSec)
    if (!(durationSec > 0)) return 0

    const source = ctx.createBufferSource()
    source.buffer = layer.buffer
    source.connect(layer.output)
    const layerWhen = when + (layer.startDelayMs ?? 0) / 1000
    // `when` must be in the future (or now for the first shot) on the audio clock.
    source.start(layerWhen, offsetSec, durationSec)
    sources.add(source)
    source.onended = () => {
      sources.delete(source)
      try {
        source.disconnect()
      } catch {
        // already disconnected by stop()
      }
      if (gen !== generation) return
      onEnded?.()
    }
    return durationSec
  }

  function startClick(ctx: AudioContext, output: GainNode, when: number) {
    const osc = ctx.createOscillator()
    osc.frequency.value = CLICK_FREQ_HZ
    osc.connect(output)
    osc.start(when)
    osc.stop(when + CLICK_DURATION_SEC)
    oscillators.add(osc)
    osc.onended = () => {
      oscillators.delete(osc)
      try {
        osc.disconnect()
      } catch {
        // already disconnected by stop()
      }
    }
  }

  function scheduleClicks(
    ctx: AudioContext,
    output: GainNode | null,
    timesMs: number[],
    window: { offsetMs: number; durationMs: number },
    when: number,
  ) {
    if (!output || timesMs.length === 0) return
    for (const t of timesMs) {
      const relMs = t - window.offsetMs
      if (relMs < 0 || relMs >= window.durationMs) continue
      startClick(ctx, output, when + relMs / 1000)
    }
  }

  function startIteration(
    ctx: AudioContext,
    ghost: ScheduledLayer,
    extras: ScheduledLayer[],
    clickOutput: GainNode | null,
    clickTimesMs: number[],
    spec: PhrasePlaySpec,
    listeners: PlaybackListeners | undefined,
    window: PlayWindow,
    when: number,
    gen: number,
  ) {
    if (gen !== generation) return

    // A one-shot pass is over when every layer has ended AND the phrase span the
    // preparer asked for has elapsed. Ending on the ghost alone cut both the
    // recording and listen-back short whenever the ghost audio ran out early.
    const spanMs = REQUESTED_SPAN(window)
    let pendingLayers = 0
    let endedFired = false
    // Untruncated passes end with their audio, so timing is unchanged there.
    let spanElapsed = spanMs <= window.durationMs

    function maybeEnded() {
      if (endedFired || pendingLayers > 0 || !spanElapsed) return
      endedFired = true
      if (!spec.loop) listeners?.onEnded?.()
    }

    function layerEnded() {
      pendingLayers -= 1
      maybeEnded()
    }

    if (startLayer(ctx, ghost, window, when, gen, layerEnded) > 0) pendingLayers += 1
    for (const extra of extras) {
      if (startLayer(ctx, extra, window, when, gen, layerEnded) > 0) pendingLayers += 1
    }
    scheduleClicks(ctx, clickOutput, clickTimesMs, window, when)

    const startDelayMs = Math.max(0, (when - ctx.currentTime) * 1000)

    function armOffset(offsetMs: number, fn: () => void) {
      const delayMs = startDelayMs + offsetMs
      if (delayMs <= 0) {
        fn()
        return
      }
      armTimer(delayMs, gen, fn)
    }

    if (listeners?.onPassStart) {
      armOffset(0, () => listeners.onPassStart?.())
    }
    // The pass lasts as long as the phrase asked for, even when the ghost audio
    // ran out early — otherwise recording stops mid-performance.
    if (!spanElapsed) {
      armOffset(spanMs, () => {
        spanElapsed = true
        maybeEnded()
      })
    }
    if (listeners?.onPassComplete) {
      armOffset(spanMs, () => listeners.onPassComplete?.())
    }
    if (listeners?.onPhraseEnter) {
      armOffset(phraseEnterDelayMs(spec.startMs, window.offsetMs), () => {
        listeners.onPhraseEnter?.()
      })
    }

    if (spec.loop) {
      const [, nextWhen] = computeLoopDeadlines(window, spec.gapMs, when, 2)
      if (nextWhen === undefined) return
      // Fire early enough that start() still sees a future audio-clock `when`.
      const delayMs = (nextWhen - ctx.currentTime) * 1000 - LOOP_LOOKAHEAD_MS
      armTimer(delayMs, gen, () => {
        startIteration(
          ctx,
          ghost,
          extras,
          clickOutput,
          clickTimesMs,
          spec,
          listeners,
          window,
          nextWhen,
          gen,
        )
      })
    }
  }

  async function play(
    spec: PhrasePlaySpec,
    listeners?: PlaybackListeners,
    mix?: PlaybackMix,
  ): Promise<boolean> {
    stop()
    const gen = generation
    const buffer = getBuffer()
    if (!buffer) {
      throw new Error('No audio buffer')
    }
    const window = computePlayWindow(spec, buffer.duration * 1000)
    const ctx = getAudioContext()
    await resumeAudioContext(ctx)
    if (gen !== generation) return false

    const ghostOutput = ctx.createGain()
    ghostOutput.gain.value = mix
      ? dbToGain(mix.ghostGainDb ?? 0, mix.ghostMute ?? false)
      : 1
    ghostOutput.connect(ctx.destination)
    outputGains.add(ghostOutput)

    const extras: ScheduledLayer[] = []
    for (const layer of mix?.extra ?? []) {
      if (!layer.buffer) continue
      const output = ctx.createGain()
      output.gain.value = dbToGain(layer.gainDb, layer.mute ?? false)
      output.connect(ctx.destination)
      outputGains.add(output)
      extras.push({
        buffer: layer.buffer,
        output,
        offsetMs: layer.offsetMs ?? 0,
        limitMs: REQUESTED_SPAN,
        startDelayMs: layer.startDelayMs ?? 0,
      })
    }

    const clickTimesMs =
      mix?.click && mix.clickTimesMs && mix.clickTimesMs.length > 0 ? mix.clickTimesMs : []
    let clickOutput: GainNode | null = null
    if (clickTimesMs.length > 0) {
      clickOutput = ctx.createGain()
      clickOutput.gain.value = 0.25
      clickOutput.connect(ctx.destination)
      outputGains.add(clickOutput)
    }

    startIteration(
      ctx,
      { buffer, output: ghostOutput, offsetMs: window.offsetMs, limitMs: GHOST_LIMIT },
      extras,
      clickOutput,
      clickTimesMs,
      spec,
      listeners,
      window,
      ctx.currentTime,
      gen,
    )
    return true
  }

  return { play, stop }
}
