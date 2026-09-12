import { useEffect, useRef, useState } from 'react'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import { decodeAudioFile } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import { SingerShell } from '../ui/shell/SingerShell.tsx'
import { RecordControl } from '../ui/singer/RecordControl.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

export function SingPage() {
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)

  bufferRef.current = buffer

  useEffect(() => {
    return () => {
      engineRef.current?.stop()
    }
  }, [])

  const ghostTrackId = project && typeof project === 'object' ? project.ghostTrackId : null

  useEffect(() => {
    let cancelled = false
    setBuffer(null)
    if (!ghostTrackId) return
    void repo
      .getAudioBlob(ghostTrackId)
      .then(async (record) => {
        if (!record || cancelled) return
        try {
          const decoded = await decodeAudioFile(record.blob)
          if (!cancelled) setBuffer(decoded.buffer)
        } catch {
          if (!cancelled) setBuffer(null)
        }
      })
      .catch(() => {
        if (!cancelled) setBuffer(null)
      })
    return () => {
      cancelled = true
    }
  }, [ghostTrackId, repo])

  if (error) {
    return <StorageError message={error} />
  }
  if (project === undefined) {
    return <p className="px-10 py-8 font-ui text-ink-muted">Loading…</p>
  }
  if (project === null) {
    return <ProjectNotFound />
  }

  function getEngine(): PlaybackEngine {
    if (!engineRef.current) {
      engineRef.current = createPlaybackEngine({
        getBuffer: () => bufferRef.current,
      })
    }
    return engineRef.current
  }

  const phrase = project.phrases[0]
  const part =
    project.voiceRoster.find((item) => !item.isGhost) ?? project.voiceRoster[0]

  return (
    <SingerShell songTitle={project.title} partLabel={part?.name}>
      <p className="font-display text-lyric leading-snug">The booth is quiet.</p>
      <p className="mt-3 max-w-md text-ink/70">Headphones carry the ghost. Sing the line when it comes.</p>
      {phrase && part ? (
        <RecordControl
          phrase={phrase}
          voicePart={part}
          project={project}
          onProjectChange={(next) => setProject(next)}
          engine={getEngine()}
        />
      ) : null}
    </SingerShell>
  )
}
