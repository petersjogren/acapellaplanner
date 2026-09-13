export type PhrasePlaySpec = {
  startMs: number
  endMs: number
  preRollMs: number
  postRollMs: number
  gapMs: number
  loop: boolean
}

export type PlayWindow = {
  offsetMs: number
  /** Ghost playback length: the phrase span clipped to the audio that exists. */
  durationMs: number
  /**
   * The phrase span the preparer actually asked for, before the ghost audio
   * clipped it. Takes, loop period and pass completion follow this: a short or
   * truncated ghost must not cut a performance short. Optional so hand-built
   * windows (tests, callers) fall back to durationMs.
   */
  requestedDurationMs?: number
}

export function computePlayWindow(spec: PhrasePlaySpec, ghostDurationMs: number): PlayWindow {
  const playStartMs = Math.max(0, spec.startMs - spec.preRollMs)
  const requestedEndMs = spec.endMs + spec.postRollMs
  const playEndMs = Math.min(ghostDurationMs, requestedEndMs)
  const durationMs = playEndMs - playStartMs
  if (!(durationMs > 0)) {
    throw new Error('Play window duration must be greater than 0')
  }
  return {
    offsetMs: playStartMs,
    durationMs,
    requestedDurationMs: Math.max(durationMs, requestedEndMs - playStartMs),
  }
}

export function computeLoopDeadlines(
  window: PlayWindow,
  gapMs: number,
  audioNow: number,
  count: number,
): number[] {
  if (count < 0) {
    throw new Error('count must be non-negative')
  }
  if (gapMs < 0) {
    throw new Error('gap must be non-negative')
  }
  // Loop on the span the phrase asked for: a ghost that runs out early must not
  // shorten the period the singer is looping against.
  const spanMs = window.requestedDurationMs ?? window.durationMs
  const periodSec = (spanMs + gapMs) / 1000
  const starts: number[] = []
  for (let i = 0; i < count; i++) {
    starts.push(audioNow + i * periodSec)
  }
  return starts
}

export function phraseEnterDelayMs(phraseStartMs: number, playStartMs: number): number {
  return Math.max(0, phraseStartMs - playStartMs)
}
