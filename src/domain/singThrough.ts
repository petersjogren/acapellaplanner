import { phraseTimelineStartMs } from './phrases.ts'
import type { Phrase } from './schemas.ts'

/**
 * Sing-through run math. A run is an unbroken adjacent sequence of phrases
 * (each next phrase starts exactly where the previous ends). Not a section.
 */

export type RunPhrase = Pick<Phrase, 'id' | 'startMs' | 'endMs' | 'preRollMs' | 'postRollMs'> & {
  loopDefault?: Phrase['loopDefault']
}

export function phrasesAreAdjacent(
  previous: Pick<Phrase, 'endMs'>,
  next: Pick<Phrase, 'startMs'>,
): boolean {
  return next.startMs === previous.endMs
}

/** Phrases from `startPhraseId` forward while each pair touches. Always includes the start. */
export function singThroughRun<T extends RunPhrase>(phrases: T[], startPhraseId: string): T[] {
  const ordered = [...phrases].sort((a, b) => a.startMs - b.startMs)
  const start = ordered.findIndex((phrase) => phrase.id === startPhraseId)
  if (start < 0) return []
  const run: T[] = [ordered[start]!]
  for (let i = start + 1; i < ordered.length; i += 1) {
    const previous = run[run.length - 1]!
    const next = ordered[i]!
    if (!phrasesAreAdjacent(previous, next)) break
    run.push(next)
  }
  return run
}

export type SingThroughPlaySpec = {
  startMs: number
  endMs: number
  preRollMs: number
  postRollMs: number
  gapMs: number
  loop: false
  /** Absolute ghost times at which the engine should fire onPhraseEnter, in order. */
  phraseEnterMs: number[]
}

/**
 * One play window for the whole run: first phrase's head start through the
 * last phrase's tail. Middle pre/post-rolls are inside that span — do not
 * chain per-phrase windows (they overlap).
 */
export function singThroughPlaySpec(run: RunPhrase[]): SingThroughPlaySpec {
  if (run.length === 0) {
    throw new Error('Sing-through run must contain at least one phrase')
  }
  const first = run[0]!
  const last = run[run.length - 1]!
  return {
    startMs: first.startMs,
    endMs: last.endMs,
    preRollMs: first.preRollMs ?? 0,
    postRollMs: last.postRollMs ?? 0,
    gapMs: first.loopDefault?.gapMs ?? 0,
    loop: false,
    phraseEnterMs: run.map((phrase) => phrase.startMs),
  }
}

/**
 * Prefix of the run whose sung body is finished. A phrase counts only once
 * the playhead has reached its end. The phrase under the playhead does not.
 */
export function completedRun<T extends Pick<Phrase, 'endMs'>>(run: T[], positionMs: number): T[] {
  const completed: T[] = []
  for (const phrase of run) {
    if (positionMs < phrase.endMs) break
    completed.push(phrase)
  }
  return completed
}

export function takeCoversPhrase(
  take: { phraseId: string; spanPhraseIds?: string[] },
  phraseId: string,
): boolean {
  if (take.phraseId === phraseId) return true
  return take.spanPhraseIds?.includes(phraseId) ?? false
}

/**
 * Extra buffer skip so phrase P of a spanning take lines up with P's own
 * play window. 0 for the anchor phrase, for takes with no span, and when
 * the record-time origin is missing. Added to latency compensation.
 */
export function spanPhraseSkipMs(
  take: { phraseId: string; spanPhraseIds?: string[]; timelineStartMs?: number },
  phrase: Pick<Phrase, 'id' | 'startMs' | 'preRollMs'>,
): number {
  if (phrase.id === take.phraseId) return 0
  if (!take.spanPhraseIds?.includes(phrase.id)) return 0
  if (take.timelineStartMs === undefined) return 0
  return Math.max(0, phraseTimelineStartMs(phrase) - take.timelineStartMs)
}

/** Span ids still present, in span order. Missing phrases are dropped, not repaired. */
export function presentSpanPhrases<T extends { id: string }>(
  phrases: T[],
  spanPhraseIds: string[],
): T[] {
  const byId = new Map(phrases.map((phrase) => [phrase.id, phrase]))
  const present: T[] = []
  for (const id of spanPhraseIds) {
    const phrase = byId.get(id)
    if (phrase) present.push(phrase)
  }
  return present
}
