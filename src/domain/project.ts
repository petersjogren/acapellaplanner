import type { Project } from './schemas.ts'

export function renameProject(project: Project, title: string): Project {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Song name is required')
  return { ...project, title: trimmed }
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
