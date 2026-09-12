import { getAudioContext, resumeAudioContext } from './context.ts'
import {
  computeLoopDeadlines,
  computePlayWindow,
  phraseEnterDelayMs,
  type PhrasePlaySpec,
} from './schedule.ts'

export type { PhrasePlaySpec, PlayWindow } from './schedule.ts'
export { computeLoopDeadlines, computePlayWindow, phraseEnterDelayMs } from './schedule.ts'

/** How far ahead of a loop deadline we create/start the next BufferSource. */
const LOOP_LOOKAHEAD_MS = 100

export type PlaybackListeners = {
  onEnded?: () => void
  onPhraseEnter?: () => void
}

export type PlaybackEngine = {
  /** Resolves true when playback actually started; false if cancelled during resume. */
  play: (spec: PhrasePlaySpec, listeners?: PlaybackListeners) => Promise<boolean>
  stop: () => void
}

export type PlaybackEngineOptions = {
  getBuffer: () => AudioBuffer | null
}

export function createPlaybackEngine({ getBuffer }: PlaybackEngineOptions): PlaybackEngine {
  let generation = 0
  const sources = new Set<AudioBufferSourceNode>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let gain: GainNode | null = null

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

  function stop() {
    generation += 1
    clearTimers()
    for (const source of sources) {
      disconnectSource(source)
    }
    sources.clear()
    if (gain) {
      try {
        gain.disconnect()
      } catch {
        // already disconnected
      }
      gain = null
    }
  }

  function armTimer(delayMs: number, gen: number, fn: () => void) {
    const id = setTimeout(() => {
      timers.delete(id)
      if (gen !== generation) return
      fn()
    }, Math.max(0, delayMs))
    timers.add(id)
  }

  function startIteration(
    ctx: AudioContext,
    buffer: AudioBuffer,
    spec: PhrasePlaySpec,
    listeners: PlaybackListeners | undefined,
    output: GainNode,
    window: { offsetMs: number; durationMs: number },
    when: number,
    gen: number,
  ) {
    if (gen !== generation) return

    const offsetSec = window.offsetMs / 1000
    const durationSec = window.durationMs / 1000
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(output)
    // `when` must be in the future (or now for the first shot) on the audio clock.
    source.start(when, offsetSec, durationSec)
    sources.add(source)
    source.onended = () => {
      sources.delete(source)
      try {
        source.disconnect()
      } catch {
        // already disconnected by stop()
      }
      if (gen !== generation) return
      if (!spec.loop) listeners?.onEnded?.()
    }

    if (listeners?.onPhraseEnter) {
      armTimer(phraseEnterDelayMs(spec.startMs, window.offsetMs), gen, () => {
        listeners.onPhraseEnter?.()
      })
    }

    if (spec.loop) {
      const [, nextWhen] = computeLoopDeadlines(window, spec.gapMs, when, 2)
      if (nextWhen === undefined) return
      // Fire early enough that start() still sees a future audio-clock `when`.
      const delayMs = (nextWhen - ctx.currentTime) * 1000 - LOOP_LOOKAHEAD_MS
      armTimer(delayMs, gen, () => {
        startIteration(ctx, buffer, spec, listeners, output, window, nextWhen, gen)
      })
    }
  }

  async function play(spec: PhrasePlaySpec, listeners?: PlaybackListeners): Promise<boolean> {
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

    const output = ctx.createGain()
    output.connect(ctx.destination)
    gain = output
    startIteration(ctx, buffer, spec, listeners, output, window, ctx.currentTime, gen)
    return true
  }

  return { play, stop }
}
