import {
  validatePhrases,
  validateSections,
  type Phrase,
  type Project,
} from './schemas.ts'
import { retargetSectionsAfterRemovingPhrase } from './sections.ts'

export const MIN_PHRASE_MS = 50
export const DEFAULT_PRE_ROLL_MS = 2000
export const DEFAULT_POST_ROLL_MS = 2000

export type PhraseIntervalMs = {
  startMs: number
  endMs: number
}

export type NewPhraseInput = {
  startMs: number
  endMs: number
  name?: string
  lyricText?: string
}

export type PhrasePatch = {
  startMs?: number
  endMs?: number
  name?: string
  lyricText?: string
  preRollMs?: number
  postRollMs?: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function ghostDurationMs(project: Project, fallback: number): number {
  return project.settings.ghostMeta?.durationMs ?? fallback
}

export function sortPhrases<T extends { startMs: number }>(phrases: T[]): T[] {
  return [...phrases].sort((a, b) => a.startMs - b.startMs)
}

/**
 * Where a phrase's play window starts on the ghost timeline: the phrase's
 * own start minus its head start, clamped to 0. Same formula as
 * `computePlayWindow`'s `offsetMs` (audio/schedule.ts) — kept here, in pure
 * domain code, so every consumer shares one formula: the take-time snapshot
 * (`Take.timelineStartMs`), DAW export's `segmentStartMs`, and the
 * all-keepers mix's per-take `startDelayMs`.
 */
export function phraseTimelineStartMs(phrase: Pick<Phrase, 'startMs' | 'preRollMs'>): number {
  return Math.max(0, phrase.startMs - (phrase.preRollMs ?? 0))
}

export function clampPhrase(startMs: number, endMs: number, durationMs: number): PhraseIntervalMs {
  const duration = Math.max(0, durationMs)
  const minLen = Math.min(MIN_PHRASE_MS, duration)
  let start = clampNumber(startMs, 0, duration)
  let end = clampNumber(endMs, 0, duration)
  if (start > end) {
    const swapped = start
    start = end
    end = swapped
  }
  if (end - start < minLen) {
    end = start + minLen
    if (end > duration) {
      end = duration
      start = Math.max(0, end - minLen)
    }
  }
  return { startMs: start, endMs: end }
}

export function phrasesFromDrag(
  dragStartMs: number,
  dragEndMs: number,
  durationMs: number,
): PhraseIntervalMs {
  return clampPhrase(Math.min(dragStartMs, dragEndMs), Math.max(dragStartMs, dragEndMs), durationMs)
}

export function gapContainingMs(
  phrases: PhraseIntervalMs[],
  ms: number,
  durationMs: number,
): PhraseIntervalMs | null {
  const duration = Math.max(0, durationMs)
  const t = clampNumber(ms, 0, duration)
  const ordered = sortPhrases(phrases)
  for (const phrase of ordered) {
    if (phrase.startMs <= t && t < phrase.endMs) return null
  }
  let startMs = 0
  let endMs = duration
  for (const phrase of ordered) {
    if (phrase.endMs <= t) startMs = Math.max(startMs, phrase.endMs)
    if (phrase.startMs > t) {
      endMs = phrase.startMs
      break
    }
  }
  if (endMs - startMs < MIN_PHRASE_MS) return null
  return { startMs, endMs }
}

export function nextPhraseName(existing: Array<{ name: string }>): string {
  const names = new Set(existing.map((item) => item.name))
  let n = 1
  while (names.has(`Phrase ${n}`)) n += 1
  return `Phrase ${n}`
}

function buildPhrase(input: NewPhraseInput, existing: Phrase[], durationMs: number): Phrase {
  const { startMs, endMs } = clampPhrase(input.startMs, input.endMs, durationMs)
  const name = input.name?.trim() ? input.name.trim() : nextPhraseName(existing)
  return {
    id: crypto.randomUUID(),
    name,
    startMs,
    endMs,
    lyricText: input.lyricText,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    preRollMs: DEFAULT_PRE_ROLL_MS,
    postRollMs: DEFAULT_POST_ROLL_MS,
  }
}

export function addPhrase(project: Project, input: NewPhraseInput): Project {
  const durationMs = ghostDurationMs(project, Math.max(input.startMs, input.endMs, 0))
  const phrase = buildPhrase(input, project.phrases, durationMs)
  const phrases = sortPhrases([...project.phrases, phrase])
  validatePhrases(phrases)
  validateSections(project.sections, phrases)
  return { ...project, phrases }
}

export function updatePhrase(project: Project, id: string, patch: PhrasePatch): Project {
  const current = project.phrases.find((item) => item.id === id)
  if (!current) {
    throw new Error(`Phrase ${id} not found`)
  }
  const durationMs = ghostDurationMs(
    project,
    Math.max(patch.endMs ?? current.endMs, patch.startMs ?? current.startMs, 0),
  )
  const clamped = clampPhrase(
    patch.startMs ?? current.startMs,
    patch.endMs ?? current.endMs,
    durationMs,
  )
  const name = patch.name !== undefined ? patch.name.trim() : current.name
  if (!name) {
    throw new Error('Phrase name is required')
  }
  // Head start / crossfade tail: how far the play window and mic capture
  // extend outside the phrase's own boundaries. Phrases themselves stay
  // non-overlapping (validated below); this is what actually overlaps.
  const preRollMs =
    patch.preRollMs !== undefined
      ? clampNumber(patch.preRollMs, 0, Number.POSITIVE_INFINITY)
      : current.preRollMs
  const postRollMs =
    patch.postRollMs !== undefined
      ? clampNumber(patch.postRollMs, 0, Number.POSITIVE_INFINITY)
      : current.postRollMs
  const next: Phrase = {
    ...current,
    ...patch,
    ...clamped,
    name,
    preRollMs,
    postRollMs,
  }
  const phrases = sortPhrases(project.phrases.map((item) => (item.id === id ? next : item)))
  validatePhrases(phrases)
  validateSections(project.sections, phrases)
  return { ...project, phrases }
}

export function removePhrase(project: Project, id: string): Project {
  const sections = retargetSectionsAfterRemovingPhrase(project, id)
  const phrases = project.phrases.filter((item) => item.id !== id)
  validateSections(sections, phrases)
  return { ...project, phrases, sections }
}
