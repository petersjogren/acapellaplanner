import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { closeAudioContext } from '../../src/audio/context.ts'
import { decodeAudioFile } from '../../src/audio/decode.ts'
import { createEmptyProject } from '../../src/domain/schemas.ts'
import { setRenderPageToCanvas } from '../../src/pdf/renderPage.ts'
import { AcapellaDB } from '../../src/storage/db.ts'
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../src/storage/projectRepository.ts'

vi.mock('../../src/audio/decode.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audio/decode.ts')>()
  return {
    ...actual,
    decodeAudioFile: vi.fn(),
  }
})

describe('PreparePage ghost import', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    database = new AcapellaDB(`acapellaplanner-prepare-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    const project = await repo.saveProject(createEmptyProject('When I Fall'))
    projectId = project.id
    vi.mocked(decodeAudioFile).mockReset()
    vi.mocked(decodeAudioFile).mockResolvedValue({
      buffer: { duration: 83.4, sampleRate: 44100 } as AudioBuffer,
      durationMs: 83400,
      sampleRate: 44100,
    })
  })

  afterEach(async () => {
    cleanup()
    database.close()
    await database.delete()
  })

  function renderPrepare(repository: ProjectRepository = repo) {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/prepare`]}>
        <AppRoutes repo={repository} />
      </MemoryRouter>,
    )
  }

  it('imports a ghost track, shows name and duration, and persists ghostTrackId', async () => {
    renderPrepare()

    await waitFor(() => {
      expect(screen.getByLabelText('Import ghost track')).toBeTruthy()
    })

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'lead.wav', { type: 'audio/wav' })
    fireEvent.change(screen.getByLabelText('Import ghost track'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('lead.wav')).toBeTruthy()
      expect(screen.getAllByText('1:23.4').length).toBeGreaterThan(0)
    })
    expect(screen.getByLabelText('Replace ghost track')).toBeTruthy()
    expect(screen.queryByLabelText('Import ghost track')).toBeNull()

    const loaded = await repo.getProject(projectId)
    expect(loaded?.ghostTrackId).toEqual(expect.any(String))
    expect(loaded?.settings.ghostMeta).toEqual({ filename: 'lead.wav', durationMs: 83400 })
    const blob = await repo.getAudioBlob(loaded!.ghostTrackId!)
    expect(blob?.kind).toBe('ghost')
    expect(blob?.projectId).toBe(projectId)
    expect(blob?.mimeType).toBe('audio/wav')
    expect(blob?.byteSize).toBe(file.size)
    expect(blob?.blob).toBeTruthy()
    expect(
      loaded?.guides.some(
        (guide) => guide.kind === 'ghost' && guide.audioBlobId === loaded.ghostTrackId,
      ),
    ).toBe(true)
  })

  it('shows name, duration, and replace when a ghost is already attached', async () => {
    const blobId = crypto.randomUUID()
    const existing = await repo.getProject(projectId)
    await repo.saveProject({
      ...existing!,
      ghostTrackId: blobId,
      guides: [
        {
          id: crypto.randomUUID(),
          kind: 'ghost',
          audioBlobId: blobId,
          gainDbDefault: 0,
          alignToGhost: true,
        },
      ],
      settings: {
        ...existing!.settings,
        ghostMeta: { filename: 'already-here.mp3', durationMs: 83400 },
      },
    })

    renderPrepare()

    await waitFor(() => {
      expect(screen.getByText('already-here.mp3')).toBeTruthy()
      expect(screen.getAllByText('1:23.4').length).toBeGreaterThan(0)
      expect(screen.getByLabelText('Replace ghost track')).toBeTruthy()
    })
    expect(screen.queryByLabelText('Import ghost track')).toBeNull()
  })

  it('surfaces a rejected save as an alert', async () => {
    const failingRepo: ProjectRepository = {
      ...repo,
      saveProject: () => Promise.reject(new Error('Could not save ghost track')),
    }

    renderPrepare(failingRepo)

    await waitFor(() => {
      expect(screen.getByLabelText('Import ghost track')).toBeTruthy()
    })

    const file = new File([new Uint8Array([1])], 'lead.wav', { type: 'audio/wav' })
    fireEvent.change(screen.getByLabelText('Import ghost track'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not save ghost track')
    })
    expect(screen.getByLabelText('Import ghost track')).toBeTruthy()
  })
})

describe('PreparePage phrase marking', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    database = new AcapellaDB(`acapellaplanner-prepare-phrases-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    const project = await repo.saveProject(createEmptyProject('When I Fall'))
    projectId = project.id
    const blobId = crypto.randomUUID()
    await repo.saveProject({
      ...project,
      ghostTrackId: blobId,
      guides: [
        {
          id: crypto.randomUUID(),
          kind: 'ghost',
          audioBlobId: blobId,
          gainDbDefault: 0,
          alignToGhost: true,
        },
      ],
      settings: {
        ...project.settings,
        ghostMeta: { filename: 'lead.wav', durationMs: 10_000 },
      },
    })
  })

  afterEach(async () => {
    cleanup()
    database.close()
    await database.delete()
  })

  function renderPrepare(repository: ProjectRepository = repo) {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/prepare`]}>
        <AppRoutes repo={repository} />
      </MemoryRouter>,
    )
  }

  function mockTimelineRect(width = 1000) {
    const timeline = screen.getByLabelText('Ghost timeline')
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 80,
      width,
      height: 80,
      toJSON() {
        return {}
      },
    })
    return timeline
  }

  function dragPhrase(timeline: HTMLElement, fromX: number, toX: number, pointerId = 1) {
    fireEvent.pointerDown(timeline, { clientX: fromX, pointerId })
    fireEvent.pointerMove(timeline, { clientX: toX, pointerId })
    fireEvent.pointerUp(timeline, { clientX: toX, pointerId })
  }

  it('persists two sequential phrases using the latest project state', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByLabelText('Ghost timeline')).toBeTruthy()
    })

    const timeline = mockTimelineRect()
    dragPhrase(timeline, 100, 300)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Phrase 1/ })).toBeTruthy()
    })

    dragPhrase(timeline, 400, 600)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Phrase 2/ })).toBeTruthy()
    })

    const loaded = await repo.getProject(projectId)
    expect(loaded?.phrases).toHaveLength(2)
    expect(loaded?.phrases.map((item) => item.name).sort()).toEqual(['Phrase 1', 'Phrase 2'])
  })

  it('does not drop the first phrase when a second mark starts before save resolves', async () => {
    let releaseFirstSave = () => {}
    let resolveFirstSaveStarted = () => {}
    const firstSaveStarted = new Promise<void>((resolve) => {
      resolveFirstSaveStarted = resolve
    })
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    let saves = 0
    const gatedRepo: ProjectRepository = {
      ...repo,
      async saveProject(project) {
        saves += 1
        if (saves === 1) {
          resolveFirstSaveStarted()
          await firstSaveGate
        }
        return repo.saveProject(project)
      },
    }

    renderPrepare(gatedRepo)
    await waitFor(() => {
      expect(screen.getByLabelText('Ghost timeline')).toBeTruthy()
    })

    const timeline = mockTimelineRect()
    dragPhrase(timeline, 100, 300, 1)
    await firstSaveStarted
    dragPhrase(timeline, 400, 600, 2)
    releaseFirstSave()

    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.phrases).toHaveLength(2)
    })
  })
})

describe('PreparePage voice roster and matrix', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    database = new AcapellaDB(`acapellaplanner-prepare-roster-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    const project = await repo.saveProject(createEmptyProject('When I Fall'))
    projectId = project.id
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    database.close()
    await database.delete()
  })

  function renderPrepare(repository: ProjectRepository = repo) {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/prepare`]}>
        <AppRoutes repo={repository} />
      </MemoryRouter>,
    )
  }

  function fillAddForm(name: string, shortLabel: string) {
    fireEvent.change(screen.getByLabelText('Part name'), { target: { value: name } })
    fireEvent.change(screen.getByLabelText('Short label'), { target: { value: shortLabel } })
  }

  it('shows the empty completion matrix copy', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByText("Mark phrases and add voice parts to see what's left.")).toBeTruthy()
    })
  })

  it('adds a voice part and persists it with saveProject', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByLabelText('Part name')).toBeTruthy()
    })

    fillAddForm('Soprano 1', 'S1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))

    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.voiceRoster).toHaveLength(1)
      expect(loaded?.voiceRoster[0]).toMatchObject({
        name: 'Soprano 1',
        shortLabel: 'S1',
        targetTakes: 4,
      })
    })
    expect(screen.getByText('Soprano 1')).toBeTruthy()
    expect(screen.queryByText(/users/i)).toBeNull()
  })

  it('persists two sequential adds against the latest project', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByLabelText('Part name')).toBeTruthy()
    })

    fillAddForm('Soprano 1', 'S1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    await waitFor(() => {
      expect(screen.getByText('Soprano 1')).toBeTruthy()
    })

    fillAddForm('Alto 1', 'A1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    await waitFor(() => {
      expect(screen.getByText('Alto 1')).toBeTruthy()
    })

    const loaded = await repo.getProject(projectId)
    expect(loaded?.voiceRoster).toHaveLength(2)
    expect(loaded?.voiceRoster.map((item) => item.shortLabel).sort()).toEqual(['A1', 'S1'])
  })

  it('does not drop the first part when a second add starts before save resolves', async () => {
    let releaseFirstSave = () => {}
    let resolveFirstSaveStarted = () => {}
    const firstSaveStarted = new Promise<void>((resolve) => {
      resolveFirstSaveStarted = resolve
    })
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    let saves = 0
    const gatedRepo: ProjectRepository = {
      ...repo,
      async saveProject(project) {
        saves += 1
        if (saves === 1) {
          resolveFirstSaveStarted()
          await firstSaveGate
        }
        return repo.saveProject(project)
      },
    }

    renderPrepare(gatedRepo)
    await waitFor(() => {
      expect(screen.getByLabelText('Part name')).toBeTruthy()
    })

    fillAddForm('Soprano 1', 'S1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    await firstSaveStarted
    fillAddForm('Alto 1', 'A1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    releaseFirstSave()

    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.voiceRoster).toHaveLength(2)
    })
  })

  it('rejects a duplicate short label without persisting', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByLabelText('Part name')).toBeTruthy()
    })

    fillAddForm('Soprano 1', 'S1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    await waitFor(() => {
      expect(screen.getByText('Soprano 1')).toBeTruthy()
    })

    fillAddForm('Soprano double', 's1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    expect(screen.getByRole('alert').textContent).toMatch(/already used/i)

    const loaded = await repo.getProject(projectId)
    expect(loaded?.voiceRoster).toHaveLength(1)
    expect(loaded?.voiceRoster[0]?.shortLabel).toBe('S1')
  })

  it('cascades takes and partPlan when a part is deleted after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const existing = await repo.getProject(projectId)
    await repo.saveProject({
      ...existing!,
      voiceRoster: [
        { id: 's1', name: 'Soprano 1', shortLabel: 'S1', color: '#c23b2a', targetTakes: 4 },
        { id: 'a1', name: 'Alto 1', shortLabel: 'A1', color: '#4d6a8f', targetTakes: 3 },
      ],
      phrases: [
        {
          id: 'p1',
          name: 'Phrase 1',
          startMs: 0,
          endMs: 1000,
                partPlan: [
            {
              voicePartId: 's1',
              priority: 0,
              targetTakes: 4,
              requiredGuide: ['ghost'],
              status: 'in-progress',
            },
            {
              voicePartId: 'a1',
              priority: 1,
              targetTakes: 3,
              requiredGuide: ['ghost'],
              status: 'not-started',
            },
          ],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          postRollMs: 0,
        },
      ],
      takes: [
        {
          id: 't-s1',
          phraseId: 'p1',
          voicePartId: 's1',
          takeIndex: 1,
          audioBlobId: 'blob-1',
          recordedAt: '2026-09-12T10:00:00.000Z',
          durationMs: 1000,
          headphoneMixSnapshot: { layers: [] },
          peakDb: -6,
        },
        {
          id: 't-a1',
          phraseId: 'p1',
          voicePartId: 'a1',
          takeIndex: 1,
          audioBlobId: 'blob-2',
          recordedAt: '2026-09-12T10:00:00.000Z',
          durationMs: 1000,
          headphoneMixSnapshot: { layers: [] },
          peakDb: -6,
        },
      ],
    })

    renderPrepare()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete Soprano 1' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Soprano 1' }))

    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.voiceRoster.map((item) => item.id)).toEqual(['a1'])
      expect(loaded?.takes.map((item) => item.id)).toEqual(['t-a1'])
      expect(loaded?.phrases[0]?.partPlan.map((row) => row.voicePartId)).toEqual(['a1'])
    })
  })
})

describe('PreparePage phrase playback', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string
  let sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>
  let resumeImpl: (ctx: { state: AudioContextState }) => Promise<void>
  let fakeCtx: { currentTime: number }

  beforeEach(async () => {
    sources = []
    resumeImpl = async (ctx) => {
      ctx.state = 'running'
    }
    function FakeAudioContext(this: unknown) {
      const ctx = {
        state: 'suspended' as AudioContextState,
        currentTime: 1,
        destination: {},
        resume: vi.fn(async () => {
          await resumeImpl(ctx)
        }),
        close: vi.fn(async () => {
          ctx.state = 'closed'
        }),
        createGain() {
          return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }
        },
        createBufferSource() {
          const source: {
            buffer: AudioBuffer | null
            connect: ReturnType<typeof vi.fn>
            disconnect: ReturnType<typeof vi.fn>
            start: ReturnType<typeof vi.fn>
            stop: ReturnType<typeof vi.fn>
            onended: (() => void) | null
          } = {
            buffer: null,
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null,
          }
          sources.push(source)
          return source
        },
      }
      fakeCtx = ctx
      return ctx
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

    database = new AcapellaDB(`acapellaplanner-prepare-play-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    const project = await repo.saveProject(createEmptyProject('When I Fall'))
    projectId = project.id
    const blobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: blobId,
      projectId,
      kind: 'ghost',
      mimeType: 'audio/wav',
      byteSize: 4,
      createdAt: new Date().toISOString(),
      blob: new Blob([new Uint8Array([1, 2, 3, 4])]),
    })
    await repo.saveProject({
      ...project,
      ghostTrackId: blobId,
      guides: [
        {
          id: crypto.randomUUID(),
          kind: 'ghost',
          audioBlobId: blobId,
          gainDbDefault: 0,
          alignToGhost: true,
        },
      ],
      phrases: [
        {
          id: 'phrase-1',
          name: 'Phrase 1',
          startMs: 1000,
          endMs: 3000,
                partPlan: [],
          loopDefault: { mode: 'phrase-loop', gapMs: 400 },
          preRollMs: 250,
          postRollMs: 100,
        },
      ],
      settings: {
        ...project.settings,
        ghostMeta: { filename: 'lead.wav', durationMs: 10_000 },
      },
    })
    vi.mocked(decodeAudioFile).mockReset()
    vi.mocked(decodeAudioFile).mockResolvedValue({
      buffer: { duration: 10, sampleRate: 44100, length: 441_000 } as AudioBuffer,
      durationMs: 10_000,
      sampleRate: 44100,
    })
  })

  afterEach(async () => {
    cleanup()
    await closeAudioContext()
    vi.unstubAllGlobals()
    database.close()
    await database.delete()
  })

  function renderPrepare() {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/prepare`]}>
        <AppRoutes repo={repo} />
      </MemoryRouter>,
    )
  }

  async function clearPhrases() {
    const existing = await repo.getProject(projectId)
    await repo.saveProject({ ...existing!, phrases: [] })
  }

  async function startMarkAlong() {
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play ghost' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Play ghost' }))
    await waitFor(() => {
      expect(sources).toHaveLength(1)
    })
  }

  it('hides playback controls until a phrase is selected', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Phrase 1/ })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Play once' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Loop' })).toBeNull()
    expect(screen.queryByLabelText('Phrase playback')).toBeNull()
  })

  it('plays the selected phrase once, loops with gap, and stops without throwing', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Phrase 1/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play once' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Play once' }))
    await waitFor(() => {
      expect(sources).toHaveLength(1)
    })
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0.75, 2.35)
    expect(screen.getByText('Playing')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Loop' }))
    await waitFor(() => {
      expect(sources[0]?.stop).toHaveBeenCalled()
      expect(sources.length).toBeGreaterThanOrEqual(2)
    })

    fireEvent.click(within(screen.getByLabelText('Phrase playback')).getByRole('button', { name: 'Stop' }))
    fireEvent.click(within(screen.getByLabelText('Phrase playback')).getByRole('button', { name: 'Stop' }))
    expect(screen.queryByText('Playing')).toBeNull()
  })

  it('does not stay on Playing when Stop cancels during AudioContext resume', async () => {
    let resolveResume: (() => void) | undefined
    resumeImpl = () =>
      new Promise<void>((resolve) => {
        resolveResume = () => resolve()
      })

    renderPrepare()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Phrase 1/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play once' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Play once' }))
    // Resume is pending — user hits Stop before it completes
    await waitFor(() => {
      expect(resolveResume).toBeTypeOf('function')
    })
    fireEvent.click(within(screen.getByLabelText('Phrase playback')).getByRole('button', { name: 'Stop' }))
    resolveResume?.()

    await waitFor(() => {
      expect(screen.queryByText('Playing')).toBeNull()
    })
    expect(sources).toHaveLength(0)
  })

  it('selects a phrase from a waveform click', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByLabelText('Ghost timeline')).toBeTruthy()
    })

    const timeline = screen.getByLabelText('Ghost timeline')
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 80,
      width: 1000,
      height: 80,
      toJSON() {
        return {}
      },
    })
    fireEvent.pointerDown(timeline, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 200, clientY: 10, pointerId: 1 })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play once' })).toBeTruthy()
    })
  })

  it('plays a phrase from an Option-click on the waveform', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Phrase 1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play once' })).toBeTruthy()
    })

    const timeline = screen.getByLabelText('Ghost timeline')
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 80,
      width: 1000,
      height: 80,
      toJSON() {
        return {}
      },
    })
    fireEvent.pointerDown(timeline, { clientX: 200, clientY: 10, pointerId: 1, altKey: true })
    fireEvent.pointerUp(timeline, { clientX: 200, clientY: 10, pointerId: 1, altKey: true })

    await waitFor(() => {
      expect(sources).toHaveLength(1)
    })
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0.75, 2.35)
    expect(screen.getByText('Playing')).toBeTruthy()
  })

  it('shows Play ghost without selecting a phrase once the ghost buffer exists', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play ghost' })).toBeTruthy()
    })
    expect(screen.getByLabelText('Mark along')).toBeTruthy()
    expect(screen.getByText('Play the ghost from the start. A phrase opens at 0. Tap New phrase each time a later line begins.')).toBeTruthy()
    expect(screen.queryByLabelText('Phrase playback')).toBeNull()
    expect((screen.getByRole('button', { name: 'New phrase' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('Play ghost starts the source at offset 0 covering the buffer and enables New phrase', async () => {
    renderPrepare()
    await startMarkAlong()
    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0, 10)
    expect((screen.getByRole('button', { name: 'New phrase' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect((screen.getByRole('button', { name: 'Play ghost' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('Play ghost opens a phrase at 0 without persisting until New phrase or Stop', async () => {
    await clearPhrases()
    renderPrepare()
    await startMarkAlong()

    expect(screen.getByTestId('mark-along-preview')).toBeTruthy()
    expect((await repo.getProject(projectId))?.phrases).toHaveLength(0)
  })

  it('first New phrase tap after Play ghost commits a phrase starting at 0', async () => {
    await clearPhrases()
    renderPrepare()
    await startMarkAlong()

    fakeCtx.currentTime = 1 + 2
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)
    })
    const loaded = await repo.getProject(projectId)
    expect(loaded?.phrases[0]).toMatchObject({
      startMs: 0,
      endMs: 2000,
      preRollMs: 2000,
      postRollMs: 2000,
    })
  })

  it('Stop without a tap commits the auto-opened phrase from 0', async () => {
    await clearPhrases()
    renderPrepare()
    await startMarkAlong()

    fakeCtx.currentTime = 1 + 2.1
    fireEvent.click(within(screen.getByLabelText('Mark along')).getByRole('button', { name: 'Stop' }))

    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)
    })
    expect((await repo.getProject(projectId))?.phrases[0]).toMatchObject({
      startMs: 0,
      endMs: 2100,
    })
  })

  it('tap then Stop commits the first phrase from 0 and the remainder', async () => {
    await clearPhrases()
    renderPrepare()
    await startMarkAlong()

    fakeCtx.currentTime = 1 + 2
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)
    })
    fakeCtx.currentTime = 1 + 2.1
    fireEvent.click(within(screen.getByLabelText('Mark along')).getByRole('button', { name: 'Stop' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(2)
    })
    const loaded = await repo.getProject(projectId)
    const ordered = [...(loaded?.phrases ?? [])].sort((a, b) => a.startMs - b.startMs)
    expect(ordered[0]).toMatchObject({ startMs: 0, endMs: 2000 })
    expect(ordered[1]).toMatchObject({ startMs: 2000, endMs: 2100 })
  })

  it('New phrase tap into an existing phrase commits up to that phrase start', async () => {
    renderPrepare()
    await startMarkAlong()

    fakeCtx.currentTime = 1 + 2
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.phrases).toHaveLength(2)
    })
    const loaded = await repo.getProject(projectId)
    const added = loaded?.phrases.find((item) => item.id !== 'phrase-1')
    expect(added).toMatchObject({ startMs: 0, endMs: 1000 })
  })

  it('does not auto-open at 0 when a phrase already covers 0', async () => {
    const existing = await repo.getProject(projectId)
    await repo.saveProject({
      ...existing!,
      phrases: existing!.phrases.map((item) =>
        item.id === 'phrase-1' ? { ...item, startMs: 0, endMs: 3000 } : item,
      ),
    })
    renderPrepare()
    await startMarkAlong()
    expect(screen.queryByTestId('mark-along-preview')).toBeNull()

    fakeCtx.currentTime = 1 + 1
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)
  })

  it('Undo last tap removes the committed phrase and restores the open start', async () => {
    await clearPhrases()
    renderPrepare()
    await startMarkAlong()

    fakeCtx.currentTime = 1 + 2
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)
    })
    expect((await repo.getProject(projectId))?.phrases[0]).toMatchObject({
      startMs: 0,
      endMs: 2000,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Undo last tap' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(0)
    })

    fakeCtx.currentTime = 1 + 8
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.phrases).toHaveLength(1)
    })
    const loaded = await repo.getProject(projectId)
    expect(loaded?.phrases[0]).toMatchObject({ startMs: 0, endMs: 8000 })
  })

  it('N while playing acts like New phrase; N in a phrase name input does not', async () => {
    renderPrepare()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Phrase 1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeTruthy()
    })
    await startMarkAlong()

    fakeCtx.currentTime = 1
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'N' })
    expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)

    fakeCtx.currentTime = 1
    fireEvent.keyDown(document.body, { key: 'N' })
    fakeCtx.currentTime = 2
    fireEvent.keyDown(document.body, { key: 'N' })
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(2)
    })
    const loaded = await repo.getProject(projectId)
    const added = loaded?.phrases.find((item) => item.id !== 'phrase-1')
    expect(added).toMatchObject({ startMs: 0, endMs: 1000 })
  })

  it('selecting Phrase 1 during mark-along after New phrase does not surprise-commit', async () => {
    renderPrepare()
    await startMarkAlong()

    fakeCtx.currentTime = 1 + 2
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases.length).toBeGreaterThan(1)
    })
    const afterTap = (await repo.getProject(projectId))?.phrases.length
    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    expect((await repo.getProject(projectId))?.phrases).toHaveLength(afterTap ?? 0)
  })

  it('Undo last tap after Stop-commit removes the phrase', async () => {
    await clearPhrases()
    renderPrepare()
    await startMarkAlong()

    fakeCtx.currentTime = 1 + 2
    fireEvent.click(screen.getByRole('button', { name: 'New phrase' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)
    })
    fakeCtx.currentTime = 1 + 2.1
    fireEvent.click(within(screen.getByLabelText('Mark along')).getByRole('button', { name: 'Stop' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(2)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Undo last tap' }))
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.phrases).toHaveLength(1)
    })
    expect((await repo.getProject(projectId))?.phrases[0]).toMatchObject({
      startMs: 0,
      endMs: 2000,
    })
  })

  it('Play once during mark-along does not start a phrase window source', async () => {
    renderPrepare()
    await startMarkAlong()

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Play once' }))

    expect(sources[0]?.start).toHaveBeenCalledWith(1, 0, 10)
    expect(sources).toHaveLength(1)
  })
})

describe('PreparePage sheet upload', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    database = new AcapellaDB(`acapellaplanner-prepare-sheet-${crypto.randomUUID()}`)
    const stored = createProjectRepository(database)
    // fake-indexeddb structured-clones a Blob into a plain object, so the
    // round-tripped record has no `.arrayBuffer()`. Hand back the original.
    const blobsById = new Map<string, Blob>()
    repo = {
      ...stored,
      async putAudioBlob(record) {
        blobsById.set(record.id, record.blob)
        return stored.putAudioBlob(record)
      },
      async getAudioBlob(id) {
        const row = await stored.getAudioBlob(id)
        if (!row) return row
        const original = blobsById.get(id)
        return original ? { ...row, blob: original } : row
      },
    }
    const project = await repo.saveProject({
      ...createEmptyProject('When I Fall'),
      phrases: [
        {
          id: 'p1',
          name: 'Phrase 1',
          startMs: 0,
          endMs: 1000,
                partPlan: [],
          loopDefault: { mode: 'phrase-loop' as const, gapMs: 400 },
          postRollMs: 0,
        },
      ],
    })
    projectId = project.id
    setRenderPageToCanvas(async () => ({
      canvas: document.createElement('canvas'),
      pngBlob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
      pageCount: 2,
      width: 200,
      height: 100,
    }))
  })

  afterEach(async () => {
    setRenderPageToCanvas(null)
    cleanup()
    database.close()
    await database.delete()
  })

  function renderPrepare() {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/prepare`]}>
        <AppRoutes repo={repo} />
      </MemoryRouter>,
    )
  }

  it('stores the PDF as a sheet blob and shows the page cropper', async () => {
    renderPrepare()

    await waitFor(() => {
      expect(screen.getByLabelText('Upload sheet PDF')).toBeTruthy()
    })

    const file = new File([new Uint8Array([9, 8, 7])], 'lead.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload sheet PDF'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByLabelText('Sheet page')).toBeTruthy()
    })
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    expect(screen.getByLabelText('Replace sheet PDF')).toBeTruthy()

    const loaded = await repo.getProject(projectId)
    expect(loaded?.sheetDocs).toHaveLength(1)
    expect(loaded?.sheetDocs[0]?.source).toBe('pdf')
    expect(loaded?.sheetDocs[0]?.name).toBe('lead.pdf')
    expect(loaded?.sheetDocs[0]?.pages).toHaveLength(2)
    const pdfBlob = await repo.getAudioBlob(loaded!.sheetDocs[0]!.pdfBlobId!)
    expect(pdfBlob?.kind).toBe('sheet')
    expect(pdfBlob?.mimeType).toBe('application/pdf')
    const pageBlob = await repo.getAudioBlob(loaded!.sheetDocs[0]!.pages[0]!.imageBlobId!)
    expect(pageBlob?.kind).toBe('sheet')
    expect(pageBlob?.mimeType).toBe('image/png')
  })

  it('stages a dragged rect and adds it to the film', async () => {
    renderPrepare()

    await waitFor(() => {
      expect(screen.getByLabelText('Upload sheet PDF')).toBeTruthy()
    })

    const file = new File([new Uint8Array([9, 8, 7])], 'lead.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload sheet PDF'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByLabelText('Sheet page')).toBeTruthy()
    })

    const page = screen.getByLabelText('Sheet page')
    vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON() {
        return {}
      },
    })
    fireEvent.pointerDown(page, { clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(page, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Add rect' }))

    // Staged, not persisted: the film is only written by Add all.
    expect((await repo.getProject(projectId))?.sheetCrops).toHaveLength(0)
    expect(document.querySelectorAll('[data-page-rect]')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Add all 1' }))

    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.sheetCrops).toHaveLength(1)
    })
    const loaded = await repo.getProject(projectId)
    expect(loaded?.sheetCrops[0]).toMatchObject({
      sheetDocId: loaded?.sheetDocs[0]?.id,
      pageIndex: 0,
      regionNorm: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    })
  })

  it('appends a second crop to the score film', async () => {
    renderPrepare()

    await waitFor(() => {
      expect(screen.getByLabelText('Upload sheet PDF')).toBeTruthy()
    })

    const file = new File([new Uint8Array([9, 8, 7])], 'lead.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload sheet PDF'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByLabelText('Sheet page')).toBeTruthy()
    })

    function dragRect(from: { x: number; y: number }, to: { x: number; y: number }) {
      const page = screen.getByLabelText('Sheet page')
      vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON() {
          return {}
        },
      })
      fireEvent.pointerDown(page, { clientX: from.x, clientY: from.y, pointerId: 1 })
      fireEvent.pointerMove(page, { clientX: to.x, clientY: to.y, pointerId: 1 })
      fireEvent.pointerUp(page, { clientX: to.x, clientY: to.y, pointerId: 1 })
      fireEvent.click(screen.getByRole('button', { name: 'Add rect' }))
    }

    dragRect({ x: 20, y: 10 }, { x: 120, y: 60 })
    fireEvent.click(screen.getByRole('button', { name: 'Add all 1' }))
    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.sheetCrops).toHaveLength(1)
      expect(loaded?.sheetCrops[0]).toMatchObject({
        pageIndex: 0,
        regionNorm: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      })
    })
    const firstId = (await repo.getProject(projectId))?.sheetCrops[0]?.id

    dragRect({ x: 40, y: 20 }, { x: 140, y: 70 })
    fireEvent.click(screen.getByRole('button', { name: 'Add all 1' }))
    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.sheetCrops).toHaveLength(2)
      expect(loaded?.sheetCrops[0]?.id).toBe(firstId)
      expect(loaded?.sheetCrops[1]).toMatchObject({
        pageIndex: 0,
        regionNorm: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
      })
    })
  })

  it('clears one page and commits the redraw together with the other page', async () => {
    renderPrepare()

    await waitFor(() => {
      expect(screen.getByLabelText('Upload sheet PDF')).toBeTruthy()
    })

    const file = new File([new Uint8Array([9, 8, 7])], 'lead.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload sheet PDF'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByLabelText('Sheet page')).toBeTruthy()
    })

    function dragRect(from: { x: number; y: number }, to: { x: number; y: number }) {
      const page = screen.getByLabelText('Sheet page')
      vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON() {
          return {}
        },
      })
      fireEvent.pointerDown(page, { clientX: from.x, clientY: from.y, pointerId: 1 })
      fireEvent.pointerMove(page, { clientX: to.x, clientY: to.y, pointerId: 1 })
      fireEvent.pointerUp(page, { clientX: to.x, clientY: to.y, pointerId: 1 })
      fireEvent.click(screen.getByRole('button', { name: 'Add rect' }))
    }

    // Page 1 keeps its rect for the whole run.
    dragRect({ x: 20, y: 10 }, { x: 120, y: 60 })
    expect(document.querySelectorAll('[data-page-rect]')).toHaveLength(1)

    const firstPageSrc = document.querySelector<HTMLImageElement>('[aria-label="Sheet page"] img')
      ?.src
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    // The cropper unmounts while page 2's PNG is rendered and its blob URL
    // minted; waiting for the label alone catches a stale-URL frame.
    await waitFor(() => {
      expect(screen.getByText('Page 2 of 2')).toBeTruthy()
      const src = document.querySelector<HTMLImageElement>('[aria-label="Sheet page"] img')?.src
      expect(src && src !== firstPageSrc).toBe(true)
    })

    // Two bad rects on page 2, thrown away, then one redraw.
    dragRect({ x: 10, y: 10 }, { x: 60, y: 30 })
    dragRect({ x: 10, y: 50 }, { x: 60, y: 80 })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-page-rect]')).toHaveLength(2)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear page rects' }))
    await waitFor(() => {
      expect(document.querySelectorAll('[data-page-rect]')).toHaveLength(0)
    })
    // Page 1's rect survived the clear.
    expect(screen.getByRole('button', { name: 'Add all 1' })).toBeTruthy()

    dragRect({ x: 40, y: 20 }, { x: 140, y: 70 })
    fireEvent.click(screen.getByRole('button', { name: 'Add all 2' }))

    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.sheetCrops.map((crop) => crop.pageIndex)).toEqual([0, 1])
    })
    const loaded = await repo.getProject(projectId)
    expect(loaded?.sheetCrops[0]?.regionNorm).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    expect(loaded?.sheetCrops[1]?.regionNorm).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 })
    // The hand-drawn page-2 rect got its page image rendered on commit.
    expect(loaded?.sheetDocs[0]?.pages[1]?.imageBlobId).toBeTruthy()
  })

  it('renames the song from the prepare page and persists it', async () => {
    renderPrepare()

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'When I Fall' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rename song' }))
    fireEvent.change(screen.getByLabelText('Song name'), {
      target: { value: '  When I Fall in Love  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'When I Fall in Love' })).toBeTruthy()
    })
    expect(screen.queryByLabelText('Song name')).toBeNull()
    await waitFor(async () => {
      expect((await repo.getProject(projectId))?.title).toBe('When I Fall in Love')
    })
  })

  it('ignores an empty song name and keeps the old title', async () => {
    renderPrepare()

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'When I Fall' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rename song' }))
    fireEvent.change(screen.getByLabelText('Song name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'When I Fall' })).toBeTruthy()
    })
    expect((await repo.getProject(projectId))?.title).toBe('When I Fall')
  })
})
