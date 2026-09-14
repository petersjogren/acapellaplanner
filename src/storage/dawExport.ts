import { takePlaybackOffsetMs } from '../audio/latency.ts'
import type { Phrase, Project } from '../domain/schemas.ts'

/** Filesystem-safe path segment. Strips accents so Swedish part names survive. */
export function safeSegment(text: string): string {
  const cleaned = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'part'
}

/** Lane suffix. Letters read better on a DAW track name than numbers do. */
export function laneLetter(laneIndex: number): string {
  if (laneIndex < 0 || laneIndex >= 26) return `L${laneIndex + 1}`
  return String.fromCharCode(65 + laneIndex)
}

export function lanePath(partName: string, laneIndex: number): string {
  const folder = safeSegment(partName)
  return `${folder}/${folder}_${laneLetter(laneIndex)}.wav`
}

export type StemName = {
  partName: string
  shortLabel: string
  phraseIndex: number
  takeIndex: number
}

export function stemPath({ partName, shortLabel, phraseIndex, takeIndex }: StemName): string {
  return `${safeSegment(partName)}/${safeSegment(shortLabel)}_p${phraseIndex}_t${takeIndex}.wav`
}

export type PlannedSegment = {
  takeId: string
  audioBlobId: string
  voicePartId: string
  partName: string
  shortLabel: string
  phraseIndex: number
  phraseName: string
  takeIndex: number
  timelineStartMs: number
  trimLeadingMs: number
  /** take.durationMs minus trim — a planning estimate. Never call assignLanes on it. */
  durationMs: number
}

export type DawExportOptions = {
  keepersOnly: boolean
}

export function segmentStartMs(phrase: Pick<Phrase, 'startMs' | 'preRollMs'>): number {
  return Math.max(0, phrase.startMs - (phrase.preRollMs ?? 0))
}

export function planSegments(project: Project, options: DawExportOptions): PlannedSegment[] {
  const ordered = [...project.phrases].sort((a, b) => a.startMs - b.startMs)
  const phraseIndex = new Map(ordered.map((phrase, i) => [phrase.id, i + 1]))
  const phrasesById = new Map(project.phrases.map((phrase) => [phrase.id, phrase]))
  const partsById = new Map(project.voiceRoster.map((part) => [part.id, part]))

  const segments: PlannedSegment[] = []
  for (const take of project.takes) {
    if (options.keepersOnly && take.rating !== 'keeper') continue
    const phrase = phrasesById.get(take.phraseId)
    const part = partsById.get(take.voicePartId)
    if (!phrase || !part) continue
    const trimLeadingMs = takePlaybackOffsetMs(take.latencyCompMs)
    segments.push({
      takeId: take.id,
      audioBlobId: take.audioBlobId,
      voicePartId: part.id,
      partName: part.name,
      shortLabel: part.shortLabel,
      phraseIndex: phraseIndex.get(phrase.id) ?? 1,
      phraseName: phrase.name,
      takeIndex: take.takeIndex,
      timelineStartMs: segmentStartMs(phrase),
      trimLeadingMs,
      durationMs: Math.max(0, take.durationMs - trimLeadingMs),
    })
  }
  return segments.sort(
    (a, b) =>
      a.timelineStartMs - b.timelineStartMs ||
      a.phraseIndex - b.phraseIndex ||
      a.takeIndex - b.takeIndex,
  )
}

export const LANE_FADE_MS = 5
export const LANE_MIN_GAP_MS = 2 * LANE_FADE_MS

export function bindDecodedDuration(
  segment: PlannedSegment,
  buffer: AudioBuffer,
): PlannedSegment {
  const audibleMs = Math.max(0, buffer.duration * 1000 - segment.trimLeadingMs)
  return { ...segment, durationMs: audibleMs }
}

export type ExportLane = {
  voicePartId: string
  partName: string
  laneIndex: number
  path: string
  segments: PlannedSegment[]
}

export function assignLanes(segments: PlannedSegment[]): ExportLane[] {
  const byPart = new Map<string, PlannedSegment[]>()
  for (const segment of segments) {
    const existing = byPart.get(segment.voicePartId)
    if (existing) existing.push(segment)
    else byPart.set(segment.voicePartId, [segment])
  }

  const partIds = [...byPart.keys()].sort((a, b) => {
    const nameA = byPart.get(a)?.[0]?.partName ?? ''
    const nameB = byPart.get(b)?.[0]?.partName ?? ''
    return nameA.localeCompare(nameB) || a.localeCompare(b)
  })

  const lanes: ExportLane[] = []
  for (const voicePartId of partIds) {
    const ordered = [...(byPart.get(voicePartId) ?? [])].sort(
      (a, b) =>
        a.timelineStartMs - b.timelineStartMs ||
        a.phraseIndex - b.phraseIndex ||
        a.takeIndex - b.takeIndex ||
        a.takeId.localeCompare(b.takeId),
    )
    const partLanes: ExportLane[] = []
    const laneEndMs: number[] = []
    for (const segment of ordered) {
      const segmentEndMs = segment.timelineStartMs + segment.durationMs
      let index = laneEndMs.findIndex(
        (endMs) => endMs + LANE_MIN_GAP_MS <= segment.timelineStartMs,
      )
      if (index === -1) {
        index = laneEndMs.length
        laneEndMs.push(Number.NEGATIVE_INFINITY)
        partLanes.push({
          voicePartId,
          partName: segment.partName,
          laneIndex: index,
          path: lanePath(segment.partName, index),
          segments: [],
        })
      }
      laneEndMs[index] = Math.max(laneEndMs[index] ?? segmentEndMs, segmentEndMs)
      partLanes[index]!.segments.push(segment)
    }
    lanes.push(...partLanes)
  }
  return lanes
}
