import { MIN_PHRASE_MS, type PhraseIntervalMs } from './phrases.ts'

export type TapMarkAlongResult =
  | { kind: 'open'; startMs: number }
  | { kind: 'ignore' }
  | { kind: 'commit'; startMs: number; endMs: number; nextOpenMs: number | null }

export type StopMarkAlongResult =
  | { kind: 'none' }
  | { kind: 'commit'; startMs: number; endMs: number }

function clampMs(value: number, durationMs: number): number {
  return Math.min(Math.max(value, 0), durationMs)
}

export function isInsidePhrase(phrases: PhraseIntervalMs[], t: number): boolean {
  return phrases.some((phrase) => phrase.startMs <= t && t < phrase.endMs)
}

export function nextObstacleMs(
  phrases: PhraseIntervalMs[],
  openStartMs: number,
  durationMs: number,
): number {
  let next = durationMs
  for (const phrase of phrases) {
    if (phrase.startMs >= openStartMs && phrase.startMs < next) {
      next = phrase.startMs
    }
  }
  return next
}

export function tapMarkAlong(
  phrases: PhraseIntervalMs[],
  openStartMs: number | null,
  tapMs: number,
  durationMs: number,
): TapMarkAlongResult {
  const tap = clampMs(tapMs, durationMs)
  if (openStartMs === null) {
    if (isInsidePhrase(phrases, tap)) {
      return { kind: 'ignore' }
    }
    return { kind: 'open', startMs: tap }
  }

  const end = Math.min(tap, nextObstacleMs(phrases, openStartMs, durationMs))
  if (end - openStartMs < MIN_PHRASE_MS) {
    return { kind: 'ignore' }
  }
  return {
    kind: 'commit',
    startMs: openStartMs,
    endMs: end,
    nextOpenMs: isInsidePhrase(phrases, end) ? null : end,
  }
}

export function stopMarkAlong(
  phrases: PhraseIntervalMs[],
  openStartMs: number | null,
  nowMs: number,
  durationMs: number,
): StopMarkAlongResult {
  if (openStartMs === null) {
    return { kind: 'none' }
  }
  const end = Math.min(clampMs(nowMs, durationMs), nextObstacleMs(phrases, openStartMs, durationMs))
  if (end - openStartMs < MIN_PHRASE_MS) {
    return { kind: 'none' }
  }
  return { kind: 'commit', startMs: openStartMs, endMs: end }
}
