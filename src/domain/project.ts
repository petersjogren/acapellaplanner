import type { Project } from './schemas.ts'

export function renameProject(project: Project, title: string): Project {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Song name is required')
  return { ...project, title: trimmed }
}

/**
 * Picks a title distinct from every already-used title, by appending
 * "(imported)" (then a counter) to the incoming project's own title. Used
 * when importing a zip fans a song out into a new project instead of
 * overwriting whatever is already on the desk — see `forkProjectForImport`.
 */
export function uniqueImportedTitle(title: string, existingTitles: readonly string[]): string {
  const taken = new Set(existingTitles)
  const base = `${title} (imported)`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${title} (imported ${n})`)) n++
  return `${title} (imported ${n})`
}

/**
 * Turns an imported project into a brand-new one: fresh project id, fresh
 * blob ids for every asset it references (ghost/guide/take/sheet blobs), and
 * the given title. Never reuses the incoming project's id, so importing a
 * zip can never `put`-overwrite an existing project row — each import lands
 * as its own project. This is how singer fan-in works: each singer's
 * returned `.acapella.zip` becomes its own project on the Preparer's device,
 * side by side with the others and the original, instead of clobbering it.
 *
 * Blob ids are also remapped (not reused) because `audioBlobs` rows are
 * exclusively owned by one project (`AudioBlobRecord.projectId`); sharing an
 * id across two projects would make `deleteProject` on one silently orphan
 * the other's audio.
 */
export function forkProjectForImport(
  project: Project,
  options: { title: string },
): { project: Project; blobIdMap: Map<string, string> } {
  const blobIdMap = new Map<string, string>()
  function remap(id: string): string {
    const existing = blobIdMap.get(id)
    if (existing) return existing
    const next = crypto.randomUUID()
    blobIdMap.set(id, next)
    return next
  }

  const ghostTrackId = project.ghostTrackId ? remap(project.ghostTrackId) : project.ghostTrackId
  const guides = project.guides.map((guide) => ({ ...guide, audioBlobId: remap(guide.audioBlobId) }))
  const takes = project.takes.map((take) => ({ ...take, audioBlobId: remap(take.audioBlobId) }))
  const sheetDocs = project.sheetDocs.map((doc) => ({
    ...doc,
    pdfBlobId: doc.pdfBlobId ? remap(doc.pdfBlobId) : doc.pdfBlobId,
    pages: doc.pages.map((page) => ({
      ...page,
      imageBlobId: page.imageBlobId ? remap(page.imageBlobId) : page.imageBlobId,
    })),
  }))
  const now = new Date().toISOString()

  return {
    project: {
      ...project,
      id: crypto.randomUUID(),
      title: options.title,
      createdAt: now,
      updatedAt: now,
      ghostTrackId,
      guides,
      takes,
      sheetDocs,
    },
    blobIdMap,
  }
}

/** Tolerance before stored ghost metadata counts as disagreeing with the audio. */
export const GHOST_DURATION_TOLERANCE_MS = 100

/**
 * Stored ghostMeta.durationMs drives the timeline, phrase clamping and the play
 * window, but it is only a snapshot taken at import. If the real audio is
 * shorter (interrupted decode, replaced ghost, partially restored zip), phrases
 * can be marked over silence that does not exist, and every pass — including
 * recording — is silently truncated to the real audio. Trust the decoded buffer.
 */
export function reconcileGhostDuration(project: Project, decodedDurationMs: number): Project {
  const meta = project.settings.ghostMeta
  if (!meta || !Number.isFinite(decodedDurationMs) || decodedDurationMs <= 0) return project
  if (Math.abs(meta.durationMs - decodedDurationMs) <= GHOST_DURATION_TOLERANCE_MS) return project
  return {
    ...project,
    settings: { ...project.settings, ghostMeta: { ...meta, durationMs: decodedDurationMs } },
  }
}

/** Phrases that run past the real ghost audio, and so cannot be sung in full. */
export function phrasesBeyondGhost(project: Project, ghostDurationMs: number): Project['phrases'] {
  if (!Number.isFinite(ghostDurationMs) || ghostDurationMs <= 0) return []
  return project.phrases.filter((phrase) => phrase.endMs > ghostDurationMs)
}
