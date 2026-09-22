import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { migrateAndParseProject } from '../domain/migrations.ts'
import { ProjectSchema, type Project } from '../domain/schemas.ts'
import type { AudioBlobKind } from './db.ts'

export type ImportedProjectBlob = {
  id: string
  blob: Blob
  kind: AudioBlobKind
  mimeType: string
}

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
}

const EXT_TO_MIME: Record<string, string> = {
  webm: 'audio/webm',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bin: 'application/octet-stream',
}

function baseMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase()
}

export function extensionForMime(mimeType: string): string {
  return MIME_TO_EXT[baseMime(mimeType)] ?? 'bin'
}

export function mimeForExtension(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

export function collectProjectBlobIds(project: Project): string[] {
  const ids = new Set<string>()
  if (project.ghostTrackId) ids.add(project.ghostTrackId)
  for (const guide of project.guides) ids.add(guide.audioBlobId)
  for (const take of project.takes) ids.add(take.audioBlobId)
  for (const doc of project.sheetDocs) {
    if (doc.pdfBlobId) ids.add(doc.pdfBlobId)
    for (const page of doc.pages) {
      if (page.imageBlobId) ids.add(page.imageBlobId)
    }
  }
  return [...ids]
}

export async function resolveExportBlob(
  getRecord: (id: string) => Promise<{ blob: Blob; mimeType: string } | undefined>,
  id: string,
): Promise<Blob | undefined> {
  const record = await getRecord(id)
  if (!record) return undefined
  return record.blob.type ? record.blob : new Blob([record.blob], { type: record.mimeType })
}

export function kindForBlobId(project: Project, id: string): AudioBlobKind {
  if (project.ghostTrackId === id) return 'ghost'
  const guide = project.guides.find((item) => item.audioBlobId === id)
  if (guide) return guide.kind
  if (project.takes.some((take) => take.audioBlobId === id)) return 'take'
  for (const doc of project.sheetDocs) {
    if (doc.pdfBlobId === id) return 'sheet'
    if (doc.pages.some((page) => page.imageBlobId === id)) return 'sheet'
  }
  return 'other'
}

export function projectTitleSlug(title: string): string {
  return title
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function projectZipFilename(title: string): string {
  return `${projectTitleSlug(title) || 'song'}.acapella.zip`
}

export function stemsZipFilename(title: string): string {
  return `${projectTitleSlug(title) || 'song'}.stems.zip`
}

export function filmMp4Filename(title: string): string {
  return `${projectTitleSlug(title) || 'song'}.film.mp4`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Safari/Firefox may not start the download if the object URL is revoked
  // in the same turn as click().
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}

/** Zip audio entry id, or null when the path is nested, zip-slip, or not audio/*. */
export function audioBlobIdFromZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized.startsWith('audio/')) return null
  const filename = normalized.slice('audio/'.length)
  if (!filename || filename.includes('/') || filename.includes('..')) return null
  const dot = filename.lastIndexOf('.')
  const id = dot > 0 ? filename.slice(0, dot) : filename
  return id || null
}

function findProjectJson(files: Record<string, Uint8Array>): Uint8Array | undefined {
  if (files['project.json']) return files['project.json']
  const key = Object.keys(files).find((name) => name.replace(/\\/g, '/').endsWith('project.json'))
  return key ? files[key] : undefined
}

export async function exportProjectZip(
  project: Project,
  getBlob: (id: string) => Promise<Blob | undefined>,
): Promise<Blob> {
  const parsed = ProjectSchema.parse(project)
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(parsed)),
  }
  for (const id of collectProjectBlobIds(parsed)) {
    const blob = await getBlob(id)
    if (!blob) continue
    const mime = blob.type || 'application/octet-stream'
    const ext = extensionForMime(mime)
    files[`audio/${id}.${ext}`] = new Uint8Array(await blob.arrayBuffer())
  }
  return new Blob([copyBytes(zipSync(files))], { type: 'application/zip' })
}

function copyBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

export async function importProjectZip(
  zipBlob: Blob,
): Promise<{ project: Project; blobs: ImportedProjectBlob[] }> {
  const files = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()))
  const projectBytes = findProjectJson(files)
  if (!projectBytes) {
    throw new Error('Missing project.json')
  }
  const project = migrateAndParseProject(JSON.parse(strFromU8(projectBytes)))
  const allowed = new Set(collectProjectBlobIds(project))
  const blobs: ImportedProjectBlob[] = []
  for (const [path, data] of Object.entries(files)) {
    const id = audioBlobIdFromZipPath(path)
    if (!id || !allowed.has(id)) continue
    const normalized = path.replace(/\\/g, '/')
    const filename = normalized.slice('audio/'.length)
    const dot = filename.lastIndexOf('.')
    const ext = dot > 0 ? filename.slice(dot + 1) : 'bin'
    const mimeType = mimeForExtension(ext)
    blobs.push({
      id,
      blob: new Blob([copyBytes(data)], { type: mimeType }),
      kind: kindForBlobId(project, id),
      mimeType,
    })
  }
  return { project, blobs }
}
