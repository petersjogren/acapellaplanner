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
  durationMs: number
}

export function computePlayWindow(spec: PhrasePlaySpec, ghostDurationMs: number): PlayWindow {
  const playStartMs = Math.max(0, spec.startMs - spec.preRollMs)
  const playEndMs = Math.min(ghostDurationMs, spec.endMs + spec.postRollMs)
  const durationMs = playEndMs - playStartMs
  if (!(durationMs > 0)) {
    throw new Error('Play window duration must be greater than 0')
  }
  return { offsetMs: playStartMs, durationMs }
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
  const periodSec = (window.durationMs + gapMs) / 1000
  const starts: number[] = []
  for (let i = 0; i < count; i++) {
    starts.push(audioNow + i * periodSec)
  }
  return starts
}

export function phraseEnterDelayMs(phraseStartMs: number, playStartMs: number): number {
  return Math.max(0, phraseStartMs - playStartMs)
}
