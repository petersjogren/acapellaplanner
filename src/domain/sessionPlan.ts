import { DEFAULT_TARGET_TAKES } from './roster.ts'
import { deriveCompletion } from './completion.ts'
import type {
  Phrase,
  PhrasePartPlan,
  PhrasePartStatus,
  Project,
  VoicePart,
} from './schemas.ts'

export type SessionSuggestion = {
  voicePartId: string
  phraseId: string
}

export type SuggestNextOptions = {
  voicePartId?: string
}

type WorkKind = 'done' | 'in-progress' | 'not-started' | 'double' | 'not-enough'

const WORK_ORDER: WorkKind[] = ['in-progress', 'not-started', 'double', 'not-enough']

function liveParts(project: Project): VoicePart[] {
  return project.voiceRoster.filter((item) => !item.isGhost)
}

function planRow(phrase: Phrase, voicePartId: string): PhrasePartPlan | undefined {
  return phrase.partPlan.find((item) => item.voicePartId === voicePartId)
}

function targetTakesFor(phrase: Phrase, part: VoicePart): number {
  return planRow(phrase, part.id)?.targetTakes ?? part.targetTakes
}

function workKind(project: Project, phrase: Phrase, part: VoicePart): WorkKind {
  const plan = planRow(phrase, part.id)
  if (plan?.status === 'enough' || plan?.status === 'final') return 'done'

  const takes = project.takes.filter(
    (item) => item.phraseId === phrase.id && item.voicePartId === part.id,
  )
  const takeCount = takes.length
  const keeperCount = takes.filter((item) => item.rating === 'keeper').length
  const target = targetTakesFor(phrase, part)
  if (plan?.status === 'in-progress') return 'in-progress'
  if (takeCount === 0) return 'not-started'
  if (takeCount >= target) return 'not-enough'
  if (keeperCount >= 1) return 'double'
  return 'not-enough'
}

function phraseRank(phrase: Phrase, voicePartId: string): [number, number] {
  const priority = planRow(phrase, voicePartId)?.priority
  return [priority ?? Number.POSITIVE_INFINITY, phrase.startMs]
}

function comparePhrases(voicePartId: string) {
  return (a: Phrase, b: Phrase): number => {
    const [pa, sa] = phraseRank(a, voicePartId)
    const [pb, sb] = phraseRank(b, voicePartId)
    if (pa !== pb) return pa - pb
    return sa - sb
  }
}

function partById(project: Project, voicePartId: string): VoicePart | undefined {
  return project.voiceRoster.find((item) => item.id === voicePartId)
}

function pickForPart(project: Project, part: VoicePart): SessionSuggestion | null {
  const ordered = [...project.phrases].sort(comparePhrases(part.id))
  for (const kind of WORK_ORDER) {
    const match = ordered.find((item) => workKind(project, item, part) === kind)
    if (match) return { voicePartId: part.id, phraseId: match.id }
  }
  return null
}

export function suggestNext(
  project: Project,
  options: SuggestNextOptions = {},
): SessionSuggestion | null {
  const parts = liveParts(project)
  if (parts.length === 0 || project.phrases.length === 0) return null

  if (options.voicePartId) {
    const selected = partById(project, options.voicePartId)
    if (!selected || selected.isGhost) return null
    return pickForPart(project, selected)
  }

  for (const part of parts) {
    const ordered = [...project.phrases].sort(comparePhrases(part.id))
    const inProgress = ordered.find((item) => workKind(project, item, part) === 'in-progress')
    if (inProgress) return { voicePartId: part.id, phraseId: inProgress.id }
  }

  for (const part of parts) {
    const next = pickForPart(project, part)
    if (next) return next
  }

  return null
}

function defaultPlan(voicePartId: string, targetTakes: number, status: PhrasePartStatus): PhrasePartPlan {
  return {
    voicePartId,
    priority: 0,
    targetTakes,
    requiredGuide: ['ghost'],
    status,
  }
}

function upsertPlanStatus(
  project: Project,
  phraseId: string,
  voicePartId: string,
  status: PhrasePartStatus,
): Project {
  const part = partById(project, voicePartId)
  const targetTakes = part?.targetTakes ?? DEFAULT_TARGET_TAKES
  let found = false
  const phrases = project.phrases.map((phrase) => {
    if (phrase.id !== phraseId) return phrase
    found = true
    const existing = planRow(phrase, voicePartId)
    if (existing) {
      return {
        ...phrase,
        partPlan: phrase.partPlan.map((row) =>
          row.voicePartId === voicePartId ? { ...row, status } : row,
        ),
      }
    }
    return {
      ...phrase,
      partPlan: [...phrase.partPlan, defaultPlan(voicePartId, targetTakes, status)],
    }
  })
  if (!found) return project
  const next: Project = { ...project, phrases }
  return { ...next, completion: deriveCompletion(next) }
}

export function markEnough(project: Project, phraseId: string, voicePartId: string): Project {
  return upsertPlanStatus(project, phraseId, voicePartId, 'enough')
}

/** Clear enough on this part so the booth will take more. Leaves final cells alone. */
export function reopenEnough(project: Project, voicePartId: string): Project {
  let changed = false
  const phrases = project.phrases.map((phrase) => {
    const existing = planRow(phrase, voicePartId)
    if (!existing || existing.status !== 'enough') return phrase
    changed = true
    const takeCount = project.takes.filter(
      (item) => item.phraseId === phrase.id && item.voicePartId === voicePartId,
    ).length
    return {
      ...phrase,
      partPlan: phrase.partPlan.map((row) =>
        row.voicePartId === voicePartId
          ? {
              ...row,
              status: 'in-progress' as const,
              targetTakes: Math.max(row.targetTakes, takeCount + 1),
            }
          : row,
      ),
    }
  })
  if (!changed) return project
  const next: Project = { ...project, phrases }
  return { ...next, completion: deriveCompletion(next) }
}

export function markInProgress(project: Project, phraseId: string, voicePartId: string): Project {
  const phrase = project.phrases.find((item) => item.id === phraseId)
  const status = phrase ? planRow(phrase, voicePartId)?.status : undefined
  if (status === 'enough' || status === 'final' || status === 'in-progress') return project
  return upsertPlanStatus(project, phraseId, voicePartId, 'in-progress')
}
