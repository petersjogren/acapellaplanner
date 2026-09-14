import {
  orderedPhraseIds,
  validateSections,
  type Phrase,
  type Project,
  type Section,
} from './schemas.ts'

export type NewSectionInput = {
  name: string
  timeMode: Section['timeMode']
  fixedBpm?: number
  fromPhraseId: string
  toPhraseId: string
  clickEnabled: boolean
}

export type SectionPatch = Partial<NewSectionInput>

export type PhraseTime = Pick<Phrase, 'id' | 'startMs' | 'endMs' | 'preRollMs' | 'postRollMs'>

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Section name is required')
  return trimmed
}

function resolvedBpm(timeMode: Section['timeMode'], bpm: number | undefined): number | undefined {
  if (timeMode !== 'fixed-tempo') return undefined
  if (!(typeof bpm === 'number' && bpm > 0)) {
    throw new Error('BPM is required for in-time sections')
  }
  return bpm
}

function buildSection(id: string, input: NewSectionInput): Section {
  const name = requireName(input.name)
  const timeMode = input.timeMode
  const fixedBpm = resolvedBpm(timeMode, input.fixedBpm)
  return {
    id,
    name,
    timeMode,
    ...(fixedBpm !== undefined ? { fixedBpm } : {}),
    fromPhraseId: input.fromPhraseId,
    toPhraseId: input.toPhraseId,
    clickEnabled: timeMode === 'fixed-tempo' && input.clickEnabled,
  }
}

export function sortSections(sections: Section[], phrases: PhraseTime[]): Section[] {
  const order = new Map(orderedPhraseIds(phrases).map((id, index) => [id, index]))
  return [...sections].sort(
    (a, b) => (order.get(a.fromPhraseId) ?? 0) - (order.get(b.fromPhraseId) ?? 0),
  )
}

/** Phrases in this section, in timeline order. Empty if the span is invalid. */
export function phrasesInSection<T extends { id: string; startMs: number }>(
  section: Pick<Section, 'fromPhraseId' | 'toPhraseId'>,
  phrases: T[],
): T[] {
  const ordered = [...phrases].sort((a, b) => a.startMs - b.startMs)
  const from = ordered.findIndex((phrase) => phrase.id === section.fromPhraseId)
  const to = ordered.findIndex((phrase) => phrase.id === section.toPhraseId)
  if (from < 0 || to < 0 || from > to) return []
  return ordered.slice(from, to + 1)
}

export function sectionForPhrase(
  phraseId: string,
  sections: Section[],
  phrases: Array<{ id: string; startMs: number }>,
): Section | undefined {
  return sections.find((section) => phrasesInSection(section, phrases).some((item) => item.id === phraseId))
}

/**
 * Play window covering the section's phrases, including the first head start
 * and the last crossfade tail. Null when the span is empty.
 */
export function sectionWindowMs(
  section: Pick<Section, 'fromPhraseId' | 'toPhraseId'>,
  phrases: PhraseTime[],
): { startMs: number; endMs: number } | null {
  const members = phrasesInSection(section, phrases)
  const first = members[0]
  const last = members[members.length - 1]
  if (!first || !last) return null
  return {
    startMs: Math.max(0, first.startMs - (first.preRollMs ?? 0)),
    endMs: last.endMs + (last.postRollMs ?? 0),
  }
}

export function addSection(project: Project, input: NewSectionInput): Project {
  const section = buildSection(crypto.randomUUID(), input)
  const sections = sortSections([...project.sections, section], project.phrases)
  validateSections(sections, project.phrases)
  return { ...project, sections }
}

export function updateSection(project: Project, id: string, patch: SectionPatch): Project {
  const current = project.sections.find((item) => item.id === id)
  if (!current) throw new Error(`Section ${id} not found`)
  const next = buildSection(id, {
    name: patch.name ?? current.name,
    timeMode: patch.timeMode ?? current.timeMode,
    fixedBpm: patch.fixedBpm ?? current.fixedBpm,
    fromPhraseId: patch.fromPhraseId ?? current.fromPhraseId,
    toPhraseId: patch.toPhraseId ?? current.toPhraseId,
    clickEnabled: patch.clickEnabled ?? current.clickEnabled,
  })
  const sections = sortSections(
    project.sections.map((item) => (item.id === id ? next : item)),
    project.phrases,
  )
  validateSections(sections, project.phrases)
  return { ...project, sections }
}

export function removeSection(project: Project, id: string): Project {
  return { ...project, sections: project.sections.filter((item) => item.id !== id) }
}

/**
 * After deleting a phrase: drop a section that has no phrases left; otherwise
 * slide from/to onto the remaining members of the old span.
 */
export function retargetSectionsAfterRemovingPhrase(project: Project, phraseId: string): Section[] {
  return project.sections.flatMap((section) => {
    const remaining = phrasesInSection(section, project.phrases).filter((item) => item.id !== phraseId)
    if (remaining.length === 0) return []
    if (section.fromPhraseId !== phraseId && section.toPhraseId !== phraseId) return [section]
    return [
      {
        ...section,
        fromPhraseId: remaining[0]!.id,
        toPhraseId: remaining[remaining.length - 1]!.id,
      },
    ]
  })
}
