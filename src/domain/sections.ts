import type { Project, Section } from './schemas.ts'

export type NewSectionInput = {
  name: string
  timeMode: Section['timeMode']
  fixedBpm?: number
  startMs: number
  endMs: number
  clickEnabled: boolean
}

export type SectionPatch = Partial<NewSectionInput>

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Section name is required')
  return trimmed
}

function requireWindow(startMs: number, endMs: number): { startMs: number; endMs: number } {
  if (!(endMs > startMs)) {
    throw new Error('Section start must be before end')
  }
  return { startMs, endMs }
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
  const { startMs, endMs } = requireWindow(input.startMs, input.endMs)
  const timeMode = input.timeMode
  const fixedBpm = resolvedBpm(timeMode, input.fixedBpm)
  return {
    id,
    name,
    timeMode,
    ...(fixedBpm !== undefined ? { fixedBpm } : {}),
    startMs,
    endMs,
    clickEnabled: timeMode === 'fixed-tempo' && input.clickEnabled,
  }
}

export function sortSections<T extends { startMs: number }>(sections: T[]): T[] {
  return [...sections].sort((a, b) => a.startMs - b.startMs)
}

export function addSection(project: Project, input: NewSectionInput): Project {
  const section = buildSection(crypto.randomUUID(), input)
  return { ...project, sections: sortSections([...project.sections, section]) }
}

export function updateSection(project: Project, id: string, patch: SectionPatch): Project {
  const current = project.sections.find((item) => item.id === id)
  if (!current) throw new Error(`Section ${id} not found`)
  const next = buildSection(id, {
    name: patch.name ?? current.name,
    timeMode: patch.timeMode ?? current.timeMode,
    fixedBpm: patch.fixedBpm ?? current.fixedBpm,
    startMs: patch.startMs ?? current.startMs,
    endMs: patch.endMs ?? current.endMs,
    clickEnabled: patch.clickEnabled ?? current.clickEnabled,
  })
  return {
    ...project,
    sections: sortSections(project.sections.map((item) => (item.id === id ? next : item))),
  }
}

export function removeSection(project: Project, id: string): Project {
  return { ...project, sections: project.sections.filter((item) => item.id !== id) }
}
