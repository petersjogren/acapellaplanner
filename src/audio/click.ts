import type { Phrase, Section } from '../domain/schemas.ts'

export type ClickTimesInput = {
  startMs: number
  endMs: number
  bpm: number
  audioNow?: number
}

export type ClickPhrase = Pick<Phrase, 'startMs' | 'endMs'> & {
  sectionId?: string
  preRollMs?: number
  postRollMs?: number
}

function overlaps(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs
}

function sectionsForPhrase(phrase: ClickPhrase, sections: Section[]): Section[] {
  if (phrase.sectionId) {
    const found = sections.find((item) => item.id === phrase.sectionId)
    return found ? [found] : []
  }
  return sections.filter((item) => overlaps(phrase, item))
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
 * Click times for a phrase: only inside overlapping (or sectionId) fixed-tempo
 * sections with clickEnabled. Ghost-follow / rubato never clicks.
 */
export function clicksForPhrase(phrase: ClickPhrase, sections: Section[]): number[] {
  const playStart = phrase.startMs - (phrase.preRollMs ?? 0)
  const playEnd = phrase.endMs + (phrase.postRollMs ?? 0)
  const times: number[] = []
  for (const section of sectionsForPhrase(phrase, sections)) {
    if (section.timeMode !== 'fixed-tempo' || !section.clickEnabled) continue
    const bpm = section.fixedBpm
    if (!(bpm && bpm > 0)) continue
    const windowStart = Math.max(section.startMs, playStart)
    const windowEnd = Math.min(section.endMs, playEnd)
    for (const t of clickTimesMs({ startMs: section.startMs, endMs: section.endMs, bpm })) {
      if (t >= windowStart && t < windowEnd) times.push(t)
    }
  }
  return times.sort((a, b) => a - b)
}
