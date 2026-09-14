import { strToU8, zipSync } from 'fflate'
import { takePlaybackOffsetMs } from '../audio/latency.ts'
import type { Phrase, Project } from '../domain/schemas.ts'
import { encodeWavPadded, floatToPcm16, msToSamples, WAV_HEADER_BYTES, wavFromPcm16 } from './wav.ts'

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
  mode?: 'lanes' | 'per-take'
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

export type RenderLaneOptions = {
  sampleRate: number
  totalMs: number
  buffers: Map<string, AudioBuffer>
}

export function renderLanePcm(lane: ExportLane, options: RenderLaneOptions): Int16Array {
  const { sampleRate, totalMs, buffers } = options
  const acc = new Float32Array(msToSamples(totalMs, sampleRate))
  const fade = Math.max(1, msToSamples(LANE_FADE_MS, sampleRate))

  for (const segment of lane.segments) {
    const buffer = buffers.get(segment.takeId)
    if (!buffer) continue
    const source = buffer.getChannelData(0)
    const trim = Math.min(msToSamples(segment.trimLeadingMs, sampleRate), source.length)
    const kept = source.subarray(trim)

    const writeAt = msToSamples(segment.timelineStartMs, sampleRate)
    const room = acc.length - writeAt
    if (room <= 0) continue
    const count = Math.min(kept.length, room)
    const edge = Math.min(fade, Math.floor(count / 2)) || 1

    for (let i = 0; i < count; i++) {
      const fromEnd = count - 1 - i
      const gain = Math.min(i < edge ? i / edge : 1, fromEnd < edge ? fromEnd / edge : 1)
      acc[writeAt + i] += (kept[i] ?? 0) * gain
    }
  }
  return floatToPcm16(acc)
}

/** Lane length: the ghost track, or the last take, whichever runs longer.
 *  Call this on bindDecodedDuration output so an overrun take extends the file. */
export function songDurationMs(project: Project, segments: PlannedSegment[]): number {
  const ghostMs = project.settings.ghostMeta?.durationMs ?? 0
  const lastSegmentEndMs = segments.reduce(
    (max, segment) => Math.max(max, segment.timelineStartMs + segment.durationMs),
    0,
  )
  return Math.max(ghostMs, lastSegmentEndMs)
}

/** Pre-decode size guess. Lane count may differ after bindDecodedDuration. */
export const ESTIMATE_SAMPLE_RATE = 48000

export type StemByteEstimate = {
  fileCount: number
  unzippedBytes: number
}

export function estimateStemBytes(project: Project, options: DawExportOptions): StemByteEstimate {
  const segments = planSegments(project, options)
  const mode = options.mode ?? 'lanes'
  const rate = ESTIMATE_SAMPLE_RATE
  if (mode === 'lanes') {
    const laneCount = assignLanes(segments).length
    const totalMs = songDurationMs(project, segments)
    const unzippedBytes = laneCount * (totalMs / 1000) * rate * 2 + laneCount * WAV_HEADER_BYTES
    return { fileCount: laneCount, unzippedBytes }
  }
  const unzippedBytes = segments.reduce(
    (sum, segment) => sum + ((segment.timelineStartMs + segment.durationMs) / 1000) * rate * 2,
    0,
  )
  return { fileCount: segments.length, unzippedBytes }
}

function copyBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

function formatTimecode(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function uniqueWavPath(files: Record<string, Uint8Array>, path: string): string {
  if (!files[path]) return path
  let n = 2
  while (files[path.replace(/\.wav$/, `-${n}.wav`)]) n++
  return path.replace(/\.wav$/, `-${n}.wav`)
}

function readmeText(
  project: Project,
  lanes: ExportLane[] | undefined,
  fileKeys: string[],
): string {
  const lines: string[] = [
    project.title,
    '',
    'Drop these files at 0:00 in your DAW. Snap them to the start of the session.',
    'Silence at the start of each file is intentional padding so takes land on the timeline.',
    'Sample rate matches the source recordings (16-bit PCM WAV).',
    '',
    'Overlapping takes are split across lanes on purpose.',
    "Stacking all of a part's lanes reproduces the Review mix.",
    '',
  ]

  if (lanes) {
    const listed = new Set<string>()
    for (const lane of lanes) {
      if (!fileKeys.includes(lane.path)) continue
      listed.add(lane.path)
      for (const segment of lane.segments) {
        lines.push(
          `${lane.path} — ${segment.phraseName} take ${segment.takeIndex} at ${formatTimecode(segment.timelineStartMs)}`,
        )
      }
    }
    for (const key of fileKeys) {
      if (key.endsWith('.wav') && !listed.has(key)) lines.push(key)
    }
  } else {
    for (const key of fileKeys) {
      if (key.endsWith('.wav')) lines.push(key)
    }
  }

  return lines.join('\n')
}

export async function exportDawStemsZip(
  project: Project,
  options: DawExportOptions,
  loadBuffer: (audioBlobId: string) => Promise<AudioBuffer | null>,
): Promise<Blob> {
  const segments = planSegments(project, options)
  if (segments.length === 0) throw new Error('No takes to export')
  const mode = options.mode ?? 'lanes'
  let files: Record<string, Uint8Array>
  let lanes: ExportLane[] | undefined
  if (mode === 'lanes') {
    const written = await writeLaneFiles(project, segments, loadBuffer)
    files = written.files
    lanes = written.lanes
  } else {
    files = await writeTakeFiles(segments, loadBuffer)
  }
  files['README.txt'] = strToU8(readmeText(project, lanes, Object.keys(files)))
  return new Blob([copyBytes(zipSync(files))], { type: 'application/zip' })
}

async function writeLaneFiles(
  project: Project,
  segments: PlannedSegment[],
  loadBuffer: (audioBlobId: string) => Promise<AudioBuffer | null>,
): Promise<{ files: Record<string, Uint8Array>; lanes: ExportLane[] }> {
  const buffers = new Map<string, AudioBuffer>()
  const resolved: PlannedSegment[] = []
  for (const segment of segments) {
    const buffer = await loadBuffer(segment.audioBlobId)
    if (!buffer) continue
    buffers.set(segment.takeId, buffer)
    resolved.push(bindDecodedDuration(segment, buffer))
  }
  const assigned = assignLanes(resolved)
  const totalMs = songDurationMs(project, resolved)
  const rate = buffers.values().next().value?.sampleRate ?? 48000
  const files: Record<string, Uint8Array> = {}
  const lanes: ExportLane[] = []
  for (const lane of assigned) {
    if (lane.segments.every((s) => !buffers.has(s.takeId))) continue
    const path = uniqueWavPath(files, lane.path)
    files[path] = wavFromPcm16(renderLanePcm(lane, { sampleRate: rate, totalMs, buffers }), rate)
    lanes.push(path === lane.path ? lane : { ...lane, path })
  }
  return { files, lanes }
}

async function writeTakeFiles(
  segments: PlannedSegment[],
  loadBuffer: (audioBlobId: string) => Promise<AudioBuffer | null>,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  const seen = new Map<string, number>()
  for (const segment of segments) {
    const buffer = await loadBuffer(segment.audioBlobId)
    if (!buffer) continue
    let path = stemPath(segment)
    const n = (seen.get(path) ?? 0) + 1
    seen.set(path, n)
    if (n > 1) path = path.replace(/\.wav$/, `-${n}.wav`)
    files[path] = encodeWavPadded(buffer, segment.timelineStartMs, segment.trimLeadingMs)
  }
  return files
}
