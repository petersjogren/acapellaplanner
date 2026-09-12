import type { Project, VoicePart } from './schemas.ts'

export const DEFAULT_TARGET_TAKES = 4

export type NewVoicePartInput = {
  name: string
  shortLabel: string
  color: string
  targetTakes?: number
  singerHint?: string
  isGhost?: boolean
}

export type VoicePartPatch = {
  name?: string
  shortLabel?: string
  color?: string
  targetTakes?: number
  singerHint?: string
  isGhost?: boolean
}

export function shortLabelKey(label: string): string {
  return label.trim().toLowerCase()
}

export function isDuplicateShortLabel(
  parts: Array<{ id: string; shortLabel: string }>,
  shortLabel: string,
  exceptId?: string,
): boolean {
  const key = shortLabelKey(shortLabel)
  if (!key) return false
  return parts.some((part) => part.id !== exceptId && shortLabelKey(part.shortLabel) === key)
}

export function duplicateShortLabelMessage(shortLabel: string): string {
  return `Short label "${shortLabel.trim()}" is already used`
}

export function assertUniqueShortLabel(
  parts: Array<{ id: string; shortLabel: string }>,
  shortLabel: string,
  exceptId?: string,
): void {
  if (isDuplicateShortLabel(parts, shortLabel, exceptId)) {
    throw new Error(duplicateShortLabelMessage(shortLabel))
  }
}

function requireTrimmed(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

function resolvedTargetTakes(value: number | undefined, fallback = DEFAULT_TARGET_TAKES): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Target doubles must be a positive integer')
  }
  return value
}

function requireColor(color: string): string {
  const trimmed = color.trim()
  if (!trimmed) {
    throw new Error('Color is required')
  }
  return trimmed
}

export function addPart(project: Project, input: NewVoicePartInput): Project {
  const name = requireTrimmed(input.name, 'Part name')
  const shortLabel = requireTrimmed(input.shortLabel, 'Short label')
  assertUniqueShortLabel(project.voiceRoster, shortLabel)
  const part: VoicePart = {
    id: crypto.randomUUID(),
    name,
    shortLabel,
    color: requireColor(input.color),
    targetTakes: resolvedTargetTakes(input.targetTakes),
  }
  if (input.singerHint !== undefined) part.singerHint = input.singerHint
  if (input.isGhost !== undefined) part.isGhost = input.isGhost
  return { ...project, voiceRoster: [...project.voiceRoster, part] }
}

export function updatePart(project: Project, id: string, patch: VoicePartPatch): Project {
  const current = project.voiceRoster.find((item) => item.id === id)
  if (!current) {
    throw new Error(`Voice part ${id} not found`)
  }
  const name = patch.name !== undefined ? requireTrimmed(patch.name, 'Part name') : current.name
  const shortLabel =
    patch.shortLabel !== undefined ? requireTrimmed(patch.shortLabel, 'Short label') : current.shortLabel
  if (patch.shortLabel !== undefined) {
    assertUniqueShortLabel(project.voiceRoster, shortLabel, id)
  }
  const next: VoicePart = {
    ...current,
    name,
    shortLabel,
    color: patch.color !== undefined ? requireColor(patch.color) : current.color,
    targetTakes:
      patch.targetTakes !== undefined
        ? resolvedTargetTakes(patch.targetTakes)
        : current.targetTakes,
  }
  if (patch.singerHint !== undefined) next.singerHint = patch.singerHint
  if (patch.isGhost !== undefined) next.isGhost = patch.isGhost
  return {
    ...project,
    voiceRoster: project.voiceRoster.map((item) => (item.id === id ? next : item)),
  }
}

export function removePart(project: Project, id: string): Project {
  if (!project.voiceRoster.some((item) => item.id === id)) {
    return project
  }
  return {
    ...project,
    voiceRoster: project.voiceRoster.filter((item) => item.id !== id),
    takes: project.takes.filter((item) => item.voicePartId !== id),
    phrases: project.phrases.map((phrase) => ({
      ...phrase,
      partPlan: phrase.partPlan.filter((row) => row.voicePartId !== id),
    })),
  }
}
