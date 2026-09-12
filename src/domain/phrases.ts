import {
  validatePhrases,
  type Phrase,
  type Project,
} from './schemas.ts'

export const MIN_PHRASE_MS = 50

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
    postRollMs: 0,
  }
}

export function addPhrase(project: Project, input: NewPhraseInput): Project {
  const durationMs = ghostDurationMs(project, Math.max(input.startMs, input.endMs, 0))
  const phrase = buildPhrase(input, project.phrases, durationMs)
  const phrases = sortPhrases([...project.phrases, phrase])
  validatePhrases(phrases)
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
  const next: Phrase = {
    ...current,
    ...patch,
    ...clamped,
    name,
  }
  const phrases = sortPhrases(project.phrases.map((item) => (item.id === id ? next : item)))
  validatePhrases(phrases)
  return { ...project, phrases }
}

export function removePhrase(project: Project, id: string): Project {
  return { ...project, phrases: project.phrases.filter((item) => item.id !== id) }
}
