import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { decodeAudioFile } from '../../src/audio/decode.ts'
import { createEmptyProject } from '../../src/domain/schemas.ts'
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
      expect(screen.getByText('Phrase 1')).toBeTruthy()
    })

    dragPhrase(timeline, 400, 600)
    await waitFor(() => {
      expect(screen.getByText('Phrase 2')).toBeTruthy()
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
          sheetRefs: [],
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
