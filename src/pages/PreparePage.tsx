import { useEffect, useRef, useState } from 'react'
import { PreparerShell } from '../ui/shell/PreparerShell.tsx'
import { decodeAudioFile, formatDuration } from '../audio/decode.ts'
import { createPlaybackEngine, type PlaybackEngine } from '../audio/engine.ts'
import { clicksForPhrase } from '../audio/click.ts'
import {
  createAudioBlobLoader,
  GHOST_FOCUS_PRESET_ID,
  loadPlaybackMixForPhrase,
} from '../audio/mix.ts'
import { useProjectRepository } from '../app/projectRepositoryContext.tsx'
import {
  GhostImporter,
  type GhostImportResult,
} from '../ui/preparer/GhostImporter.tsx'
import { GhostTimeline } from '../ui/preparer/GhostTimeline.tsx'
import { SheetCropper } from '../ui/preparer/SheetCropper.tsx'
import { SheetUploader, type SheetUploadResult } from '../ui/preparer/SheetUploader.tsx'
import { deriveCompletion } from '../domain/completion.ts'
import { tapMarkAlong, stopMarkAlong } from '../domain/markAlong.ts'
import { addPhrase, removePhrase, updatePhrase, type PhrasePatch } from '../domain/phrases.ts'
import {
  addSection,
  removeSection,
  type NewSectionInput,
} from '../domain/sections.ts'
import {
  addPart,
  removePart,
  updatePart,
  type NewVoicePartInput,
  type VoicePartPatch,
} from '../domain/roster.ts'
import { addSheetRefToPhrase, bindSheetRefToPhrase, removeSheetRefFromPhrase } from '../domain/sheets.ts'
import { renameProject, phrasesBeyondGhost, reconcileGhostDuration } from '../domain/project.ts'
import type { Phrase, Project, RegionNorm, SheetDocument } from '../domain/schemas.ts'
import { renderPageToCanvas } from '../pdf/renderPage.ts'
import { CompletionMatrix } from '../ui/preparer/CompletionMatrix.tsx'
import { SectionEditor } from '../ui/preparer/SectionEditor.tsx'
import { VoiceRosterEditor } from '../ui/preparer/VoiceRosterEditor.tsx'
import { MixPresetSelect } from '../ui/shared/MixPresetSelect.tsx'
import { ProjectNotFound } from './ProjectNotFound.tsx'
import { StorageError } from './StorageError.tsx'
import { useLoadedProject } from './useLoadedProject.ts'

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function PreparePage() {
  const { project, error, setProject } = useLoadedProject()
  const repo = useProjectRepository()
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)
  const [mixPresetId, setMixPresetId] = useState(GHOST_FOCUS_PRESET_ID)
  const [sheetPageIndex, setSheetPageIndex] = useState(0)
  const [sheetPageUrl, setSheetPageUrl] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [markAlongPlaying, setMarkAlongPlaying] = useState(false)
  const [openStartMs, setOpenStartMs] = useState<number | null>(null)
  const [playheadMs, setPlayheadMs] = useState<number | null>(null)
  const projectRef = useRef<Project | null>(null)
  const writeQueueRef = useRef(Promise.resolve())
  const bufferRef = useRef<AudioBuffer | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const sheetPageChangeGenRef = useRef(0)
  const openStartMsRef = useRef<number | null>(null)
  const committedIdsRef = useRef<string[]>([])
  const markAlongPlayingRef = useRef(false)
  const playheadRafRef = useRef<number | null>(null)
  const onMarkAlongTapRef = useRef<() => void>(() => {})

  bufferRef.current = buffer

  const liveProject = project && typeof project === 'object' ? project : null
  const sheetDoc = liveProject?.sheetDocs.at(-1) ?? null
  const sheetImageBlobId = sheetDoc?.pages.find((page) => page.pageIndex === sheetPageIndex)
    ?.imageBlobId

  useEffect(() => {
    setSheetPageIndex(0)
  }, [liveProject?.id])

  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    setSheetPageUrl(null)
    if (!sheetImageBlobId) return
    void repo
      .getAudioBlob(sheetImageBlobId)
      .then((record) => {
        if (!record) return
        const next = URL.createObjectURL(record.blob)
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        url = next
        setSheetPageUrl(next)
      })
      .catch(() => {
        if (!cancelled) setSheetPageUrl(null)
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [sheetImageBlobId, repo])

  useEffect(() => {
    return () => {
      if (playheadRafRef.current != null) {
        cancelAnimationFrame(playheadRafRef.current)
        playheadRafRef.current = null
      }
      engineRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' && event.key !== 'N' && event.key !== 'Enter') return
      if (isTextEntryTarget(event.target)) return
      if (!markAlongPlayingRef.current) return
      event.preventDefault()
      onMarkAlongTapRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (project && typeof project === 'object') {
      projectRef.current = project
    }
  }, [project])

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
          // Decode on the playback singleton so the buffer is usable for play().
          const decoded = await decodeAudioFile(record.blob)
          if (cancelled) return
          setBuffer(decoded.buffer)
          // Stored ghostMeta can outlive the real audio; the timeline and phrase
          // clamping must follow the buffer, not a stale snapshot. Only write
          // when they actually disagree, so loading a song is not a mutation.
          const current = projectRef.current
          if (current && reconcileGhostDuration(current, decoded.durationMs) !== current) {
            void persistProject((live) => reconcileGhostDuration(live, decoded.durationMs))
          }
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

  const loaded = project

  async function handleImported({ blob, meta }: GhostImportResult) {
    const blobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: blobId,
      projectId: loaded.id,
      kind: 'ghost',
      mimeType: blob.type || 'application/octet-stream',
      byteSize: blob.size,
      createdAt: new Date().toISOString(),
      blob,
    })

    const saved = await repo.saveProject({
      ...loaded,
      ghostTrackId: blobId,
      guides: [
        ...loaded.guides.filter((guide) => guide.kind !== 'ghost'),
        {
          id: crypto.randomUUID(),
          kind: 'ghost',
          audioBlobId: blobId,
          gainDbDefault: 0,
          alignToGhost: true,
        },
      ],
      settings: {
        ...loaded.settings,
        ghostMeta: {
          filename: meta.filename,
          durationMs: meta.durationMs,
        },
      },
    })
    setProject(saved)
  }

  function persistProject(mutate: (current: Project) => Project): Promise<void> {
    const run = writeQueueRef.current.then(async () => {
      const current = projectRef.current ?? loaded
      const next = mutate(current)
      const saved = await repo.saveProject({
        ...next,
        completion: deriveCompletion(next),
      })
      projectRef.current = saved
      setProject(saved)
    })
    writeQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function cancelPlayheadLoop() {
    if (playheadRafRef.current != null) {
      cancelAnimationFrame(playheadRafRef.current)
      playheadRafRef.current = null
    }
  }

  function startPlayheadLoop() {
    cancelPlayheadLoop()
    const tick = () => {
      if (!markAlongPlayingRef.current) {
        playheadRafRef.current = null
        return
      }
      setPlayheadMs(engineRef.current?.getPositionMs() ?? null)
      playheadRafRef.current = requestAnimationFrame(tick)
    }
    playheadRafRef.current = requestAnimationFrame(tick)
  }

  function setMarkAlongPlayingFlag(value: boolean) {
    markAlongPlayingRef.current = value
    setMarkAlongPlaying(value)
  }

  function setOpenStart(value: number | null) {
    openStartMsRef.current = value
    setOpenStartMs(value)
  }

  function ghostDurationMs() {
    return (bufferRef.current?.duration ?? 0) * 1000
  }

  async function persistNewPhrase(startMs: number, endMs: number): Promise<string | undefined> {
    const beforeIds = new Set((projectRef.current?.phrases ?? []).map((item) => item.id))
    await persistProject((current) => addPhrase(current, { startMs, endMs }))
    return (projectRef.current?.phrases ?? []).find((item) => !beforeIds.has(item.id))?.id
  }

  async function handleNewPhrase() {
    if (!markAlongPlayingRef.current) return
    const tapMs = engineRef.current?.getPositionMs()
    if (tapMs == null) return
    const result = tapMarkAlong(
      projectRef.current?.phrases ?? [],
      openStartMsRef.current,
      tapMs,
      ghostDurationMs(),
    )
    if (result.kind === 'ignore') return
    if (result.kind === 'open') {
      setOpenStart(result.startMs)
      return
    }
    setOpenStart(result.nextOpenMs)
    const addedId = await persistNewPhrase(result.startMs, result.endMs)
    if (addedId) {
      committedIdsRef.current = [...committedIdsRef.current, addedId]
    }
  }

  onMarkAlongTapRef.current = () => {
    void handleNewPhrase()
  }

  async function finishMarkAlong() {
    cancelPlayheadLoop()
    const nowMs = engineRef.current?.getPositionMs() ?? 0
    const result = stopMarkAlong(
      projectRef.current?.phrases ?? [],
      openStartMsRef.current,
      nowMs,
      ghostDurationMs(),
    )
    setOpenStart(null)
    engineRef.current?.stop()
    setPlaying(false)
    setMarkAlongPlayingFlag(false)
    setPlayheadMs(null)
    if (result.kind === 'commit') {
      const addedId = await persistNewPhrase(result.startMs, result.endMs)
      if (addedId) {
        committedIdsRef.current = [...committedIdsRef.current, addedId]
      }
    }
  }

  async function handlePlayGhost() {
    const buf = bufferRef.current
    if (!buf || markAlongPlayingRef.current) return
    committedIdsRef.current = []
    setOpenStart(null)
    setPlayError(null)
    try {
      const started = await getEngine().play(
        {
          startMs: 0,
          endMs: buf.duration * 1000,
          preRollMs: 0,
          postRollMs: 0,
          gapMs: 0,
          loop: false,
        },
        {
          onEnded: () => {
            void finishMarkAlong()
          },
        },
        { ghostGainDb: 0, ghostMute: false },
      )
      setPlaying(false)
      setMarkAlongPlayingFlag(started)
      if (started) {
        const opened = tapMarkAlong(
          projectRef.current?.phrases ?? [],
          null,
          0,
          buf.duration * 1000,
        )
        if (opened.kind === 'open') setOpenStart(opened.startMs)
        startPlayheadLoop()
      } else {
        cancelPlayheadLoop()
        setPlayheadMs(null)
      }
    } catch (err: unknown) {
      setMarkAlongPlayingFlag(false)
      setPlayError(err instanceof Error && err.message ? err.message : 'Could not play ghost')
    }
  }

  async function handleUndoLastTap() {
    const ids = committedIdsRef.current
    if (ids.length > 0) {
      const last = ids[ids.length - 1]!
      const phrase = projectRef.current?.phrases.find((item) => item.id === last)
      committedIdsRef.current = ids.slice(0, -1)
      setOpenStart(phrase?.startMs ?? null)
      await persistProject((current) => removePhrase(current, last))
      return
    }
    setOpenStart(null)
  }

  async function handleMarkPhrase(startMs: number, endMs: number) {
    await persistProject((current) => addPhrase(current, { startMs, endMs }))
  }

  async function handleUpdatePhrase(id: string, patch: PhrasePatch) {
    await persistProject((current) => updatePhrase(current, id, patch))
  }

  async function handleRemovePhrase(id: string) {
    await persistProject((current) => removePhrase(current, id))
    if (selectedPhraseId === id) handleSelectPhrase(null)
  }

  function handleSelectPhrase(id: string | null) {
    if (id !== selectedPhraseId && !markAlongPlayingRef.current) {
      engineRef.current?.stop()
      setPlaying(false)
    }
    setSelectedPhraseId(id)
  }

  async function handleAddPart(partial: NewVoicePartInput) {
    await persistProject((current) => addPart(current, partial))
  }

  async function handleUpdatePart(id: string, patch: VoicePartPatch) {
    await persistProject((current) => updatePart(current, id, patch))
  }

  async function handleRemovePart(id: string) {
    await persistProject((current) => removePart(current, id))
  }

  async function handleAddSection(input: NewSectionInput) {
    await persistProject((current) => addSection(current, input))
  }

  async function handleRemoveSection(id: string) {
    await persistProject((current) => removeSection(current, id))
  }

  function getEngine(): PlaybackEngine {
    if (!engineRef.current) {
      engineRef.current = createPlaybackEngine({
        getBuffer: () => bufferRef.current,
      })
    }
    return engineRef.current
  }

  const selectedPhrase = loaded.phrases.find((item) => item.id === selectedPhraseId) ?? null

  async function playPhrase(phrase: Phrase, loop: boolean) {
    if (markAlongPlayingRef.current) return
    setPlayError(null)
    try {
      const mix = await loadPlaybackMixForPhrase(
        loaded,
        phrase.id,
        mixPresetId,
        createAudioBlobLoader((id) => repo.getAudioBlob(id)),
      )
      const clickTimesMs = clicksForPhrase(phrase, loaded.sections, loaded.phrases)
      const started = await getEngine().play(
        {
          startMs: phrase.startMs,
          endMs: phrase.endMs,
          preRollMs: phrase.preRollMs ?? 0,
          postRollMs: phrase.postRollMs,
          gapMs: phrase.loopDefault.gapMs,
          loop,
        },
        {
          onEnded: () => setPlaying(false),
        },
        { ...mix, click: true, clickTimesMs },
      )
      // play() returns false if Stop cancelled during AudioContext resume
      setPlaying(started)
    } catch (err: unknown) {
      setPlaying(false)
      setPlayError(err instanceof Error && err.message ? err.message : 'Could not play phrase')
    }
  }

  async function handlePlay(loop: boolean) {
    if (!selectedPhrase) return
    await playPhrase(selectedPhrase, loop)
  }

  function handlePlayPhrase(id: string) {
    const phrase = loaded.phrases.find((item) => item.id === id)
    if (!phrase || !bufferRef.current) return
    void playPhrase(phrase, false)
  }

  function handleStop() {
    void finishMarkAlong()
  }

  async function handleSheetUploaded({ blob, filename }: SheetUploadResult) {
    const bytes = await blob.arrayBuffer()
    const rendered = await renderPageToCanvas(bytes, 0)
    const pdfBlobId = crypto.randomUUID()
    const pageBlobId = crypto.randomUUID()
    const now = new Date().toISOString()
    await repo.putAudioBlob({
      id: pdfBlobId,
      projectId: loaded.id,
      kind: 'sheet',
      mimeType: blob.type || 'application/pdf',
      byteSize: blob.size,
      createdAt: now,
      blob,
    })
    await repo.putAudioBlob({
      id: pageBlobId,
      projectId: loaded.id,
      kind: 'sheet',
      mimeType: 'image/png',
      byteSize: rendered.pngBlob.size,
      createdAt: now,
      blob: rendered.pngBlob,
    })
    const nextDoc: SheetDocument = {
      id: crypto.randomUUID(),
      name: filename,
      source: 'pdf',
      pdfBlobId,
      pages: Array.from({ length: Math.max(1, rendered.pageCount) }, (_, pageIndex) => ({
        pageIndex,
        imageBlobId: pageIndex === 0 ? pageBlobId : undefined,
      })),
    }
    await persistProject((current) => ({
      ...current,
      sheetDocs: [...current.sheetDocs, nextDoc],
    }))
    sheetPageChangeGenRef.current += 1
    setSheetPageIndex(0)
  }

  async function handleSheetPageChange(nextIndex: number) {
    const gen = ++sheetPageChangeGenRef.current
    const stillCurrent = () => gen === sheetPageChangeGenRef.current
    const current = projectRef.current ?? loaded
    const doc = current.sheetDocs.at(-1)
    if (!doc || nextIndex < 0 || nextIndex >= doc.pages.length) return
    const page = doc.pages.find((item) => item.pageIndex === nextIndex)
    if (page?.imageBlobId || !doc.pdfBlobId) {
      if (stillCurrent()) setSheetPageIndex(nextIndex)
      return
    }
    const pdfRecord = await repo.getAudioBlob(doc.pdfBlobId)
    if (!stillCurrent()) return
    if (!pdfRecord) {
      if (stillCurrent()) setSheetPageIndex(nextIndex)
      return
    }
    const rendered = await renderPageToCanvas(await pdfRecord.blob.arrayBuffer(), nextIndex)
    if (!stillCurrent()) return
    const pageBlobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: pageBlobId,
      projectId: loaded.id,
      kind: 'sheet',
      mimeType: 'image/png',
      byteSize: rendered.pngBlob.size,
      createdAt: new Date().toISOString(),
      blob: rendered.pngBlob,
    })
    if (!stillCurrent()) return
    await persistProject((proj) => ({
      ...proj,
      sheetDocs: proj.sheetDocs.map((item) =>
        item.id === doc.id
          ? {
              ...item,
              pages: item.pages.map((row) =>
                row.pageIndex === nextIndex ? { ...row, imageBlobId: pageBlobId } : row,
              ),
            }
          : item,
      ),
    }))
    if (stillCurrent()) setSheetPageIndex(nextIndex)
  }

  async function handleRenameSong(title: string) {
    const trimmed = title.trim()
    if (!trimmed || trimmed === (projectRef.current ?? loaded).title) {
      setTitleDraft(null)
      return
    }
    await persistProject((current) => renameProject(current, trimmed))
    setTitleDraft(null)
  }

  async function handleBindCrop(phraseId: string, region: RegionNorm) {
    const doc = (projectRef.current ?? loaded).sheetDocs.at(-1)
    if (!doc) return
    await persistProject((current) =>
      bindSheetRefToPhrase(current, phraseId, {
        id: crypto.randomUUID(),
        sheetDocId: doc.id,
        pageIndex: sheetPageIndex,
        regionNorm: region,
      }),
    )
  }

  async function handleAddCrop(phraseId: string, region: RegionNorm) {
    const doc = (projectRef.current ?? loaded).sheetDocs.at(-1)
    if (!doc) return
    await persistProject((current) =>
      addSheetRefToPhrase(current, phraseId, {
        id: crypto.randomUUID(),
        sheetDocId: doc.id,
        pageIndex: sheetPageIndex,
        regionNorm: region,
      }),
    )
  }

  async function handleRemoveCrop(phraseId: string, refId: string) {
    await persistProject((current) => removeSheetRefFromPhrase(current, phraseId, refId))
  }

  const ghostMeta = loaded.settings.ghostMeta
  const activeSheet = loaded.sheetDocs.at(-1) ?? null
  const hasGhost = Boolean(loaded.ghostTrackId && ghostMeta)
  // Phrases marked over audio the ghost does not actually have: those passes
  // stop early, so recording and listen-back get cut off mid-phrase.
  const strandedPhrases = buffer ? phrasesBeyondGhost(loaded, buffer.duration * 1000) : []

  return (
    <PreparerShell title={loaded.title} current="prepare" projectId={loaded.id}>
      {titleDraft === null ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-display text-xl font-semibold tracking-tight">{loaded.title}</h2>
          <button
            type="button"
            className="rounded-md border border-ink/15 px-3 py-1 text-sm font-medium studio-transition hover:bg-ink/5"
            aria-label="Rename song"
            onClick={() => setTitleDraft(loaded.title)}
          >
            Rename
          </button>
        </div>
      ) : (
        <form
          className="flex max-w-xl flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleRenameSong(titleDraft)
          }}
        >
          <input
            autoFocus
            type="text"
            aria-label="Song name"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setTitleDraft(null)
            }}
            className="min-w-0 flex-1 rounded-md border border-ink/15 bg-paper px-3 py-2 font-display text-xl font-semibold tracking-tight"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
          >
            Save name
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5"
            onClick={() => setTitleDraft(null)}
          >
            Cancel
          </button>
        </form>
      )}
      <p className="mt-3 max-w-xl text-ink/70">The ghost is the lead everyone locks to.</p>
      {strandedPhrases.length > 0 ? (
        <p role="alert" className="mt-4 max-w-xl text-record-red">
          {strandedPhrases.length === 1
            ? `“${strandedPhrases[0]?.name}” runs past the end of the ghost audio`
            : `${strandedPhrases.length} phrases run past the end of the ghost audio`}{' '}
          ({formatDuration(buffer ? buffer.duration * 1000 : 0)}). Those passes stop when the ghost
          does — shorten them, or import a longer ghost.
        </p>
      ) : null}
      {hasGhost && ghostMeta ? (
        <section
          className="mt-8 max-w-3xl rounded-lg border border-phrase-line bg-phrase-tint p-5"
          aria-label="Ghost track"
        >
          <h3 className="font-medium">Ghost track</h3>
          <p className="mt-2">{ghostMeta.filename}</p>
          <p className="mt-1 text-ink-muted">{formatDuration(ghostMeta.durationMs)}</p>
          <GhostImporter label="Replace ghost track" onImported={handleImported} />
          {buffer ? (
            <section className="mt-6" aria-label="Mark along">
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                  disabled={markAlongPlaying}
                  onClick={() => void handlePlayGhost()}
                >
                  Play ghost
                </button>
                <button
                  type="button"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                  disabled={!markAlongPlaying}
                  onClick={() => void handleNewPhrase()}
                >
                  New phrase
                </button>
                <button
                  type="button"
                  className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5"
                  onClick={() => void handleUndoLastTap()}
                >
                  Undo last tap
                </button>
                <button
                  type="button"
                  className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5"
                  onClick={handleStop}
                >
                  Stop
                </button>
              </div>
              <p className="mt-2 text-sm text-ink-muted">
                Play the ghost from the start. A phrase opens at 0. Tap New phrase each time a later line begins.
              </p>
            </section>
          ) : null}
          <GhostTimeline
            durationMs={ghostMeta.durationMs}
            phrases={loaded.phrases}
            buffer={buffer}
            onMarkPhrase={handleMarkPhrase}
            onUpdatePhrase={handleUpdatePhrase}
            onRemovePhrase={handleRemovePhrase}
            onSelectPhrase={handleSelectPhrase}
            onPlayPhrase={handlePlayPhrase}
            playheadMs={playheadMs}
            openPreview={
              openStartMs != null
                ? { startMs: openStartMs, endMs: Math.max(openStartMs, playheadMs ?? openStartMs) }
                : null
            }
          />
          {selectedPhrase && buffer ? (
            <section className="mt-6" aria-label="Phrase playback">
              <h3 className="font-medium">Listen</h3>
              <p className="mt-1 text-sm text-ink-muted">{selectedPhrase.name}</p>
              <div className="mt-3">
                <MixPresetSelect value={mixPresetId} onChange={setMixPresetId} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                  onClick={() => void handlePlay(false)}
                >
                  Play once
                </button>
                <button
                  type="button"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                  onClick={() => void handlePlay(true)}
                >
                  Loop
                </button>
                <button
                  type="button"
                  className="rounded-md border border-ink/15 px-4 py-2 text-sm font-medium studio-transition hover:bg-ink/5"
                  onClick={handleStop}
                >
                  Stop
                </button>
              </div>
              {playing ? <p className="mt-2 text-sm text-ink-muted">Playing</p> : null}
              {playError ? (
                <p role="alert" className="mt-2 text-record-red">
                  {playError}
                </p>
              ) : null}
            </section>
          ) : null}
        </section>
      ) : (
        <GhostImporter onImported={handleImported} />
      )}
      {hasGhost && ghostMeta ? (
        <SectionEditor
          sections={loaded.sections}
          phrases={loaded.phrases}
          onAddSection={handleAddSection}
          onRemoveSection={handleRemoveSection}
        />
      ) : null}
      <section className="mt-10 max-w-3xl" aria-label="Sheet music">
        <h3 className="font-medium">Sheet music</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Upload a PDF, crop a region, and bind it to a phrase.
        </p>
        <SheetUploader
          onUploaded={handleSheetUploaded}
          label={activeSheet ? 'Replace sheet PDF' : 'Upload sheet PDF'}
        />
        {activeSheet && sheetPageUrl ? (
          <SheetCropper
            pageImageUrl={sheetPageUrl}
            pageIndex={sheetPageIndex}
            pageCount={activeSheet.pages.length}
            phrases={loaded.phrases}
            selectedPhraseId={selectedPhraseId}
            onPageChange={handleSheetPageChange}
            onBind={handleBindCrop}
            onAddCrop={handleAddCrop}
            onRemoveCrop={handleRemoveCrop}
          />
        ) : null}
      </section>
      <VoiceRosterEditor
        parts={loaded.voiceRoster}
        onAddPart={handleAddPart}
        onUpdatePart={handleUpdatePart}
        onRemovePart={handleRemovePart}
      />
      <CompletionMatrix project={loaded} />
    </PreparerShell>
  )
}
