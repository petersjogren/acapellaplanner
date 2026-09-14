import { sectionForPhrase, sectionWindowMs } from '../domain/sections.ts'
import type { Phrase, Section } from '../domain/schemas.ts'

export type ClickTimesInput = {
  startMs: number
  endMs: number
  bpm: number
  audioNow?: number
}

export type ClickPhrase = Pick<Phrase, 'id' | 'startMs' | 'endMs'> & {
  preRollMs?: number
  postRollMs?: number
}

/** Quarter-note click grid in the section window. Exclusive end: t < endMs. */
export function clickTimesMs({ startMs, endMs, bpm }: ClickTimesInput): number[] {
  if (!Number.isFinite(bpm) || !(bpm > 0) || !(endMs > startMs)) return []
  const intervalMs = 60000 / bpm
  if (!Number.isFinite(intervalMs) || !(intervalMs > 0)) return []
  const times: number[] = []
  for (let i = 0, t = startMs; t < endMs; i += 1, t = startMs + i * intervalMs) {
    times.push(t)
  }
  return times
}

/**
 * Click times for a phrase: only if that phrase belongs to a fixed-tempo
 * section with click on. Grid origin is the section window (first phrase's
 * head start through last phrase's tail), then clipped to this phrase's
 * play window. Ghost-follow / unassigned phrases never click.
 */
export function clicksForPhrase(
  phrase: ClickPhrase,
  sections: Section[],
  phrases: Array<Pick<Phrase, 'id' | 'startMs' | 'endMs' | 'preRollMs' | 'postRollMs'>>,
): number[] {
  const section = sectionForPhrase(phrase.id, sections, phrases)
  if (!section || section.timeMode !== 'fixed-tempo' || !section.clickEnabled) return []
  const bpm = section.fixedBpm
  if (!(bpm && bpm > 0)) return []
  const window = sectionWindowMs(section, phrases)
  if (!window) return []

  const playStart = phrase.startMs - (phrase.preRollMs ?? 0)
  const playEnd = phrase.endMs + (phrase.postRollMs ?? 0)
  const clipStart = Math.max(window.startMs, playStart)
  const clipEnd = Math.min(window.endMs, playEnd)
  return clickTimesMs({ startMs: window.startMs, endMs: window.endMs, bpm }).filter(
    (time) => time >= clipStart && time < clipEnd,
  )
}
