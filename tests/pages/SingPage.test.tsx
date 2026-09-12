import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import type { PlaybackListeners } from '../../src/audio/engine.ts'
import {
  createEmptyProject,
  type Phrase,
  type Project,
  type Take,
  type VoicePart,
} from '../../src/domain/schemas.ts'
import { AcapellaDB } from '../../src/storage/db.ts'
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../src/storage/projectRepository.ts'

const playback = vi.hoisted(() => {
  const state: { listeners: PlaybackListeners | undefined } = { listeners: undefined }
  return {
    state,
    play: vi.fn(async (_spec: unknown, listeners?: PlaybackListeners) => {
      state.listeners = listeners
      return true
    }),
    stop: vi.fn(),
  }
})

vi.mock('../../src/audio/engine.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audio/engine.ts')>()
  return {
    ...actual,
    createPlaybackEngine: () => ({
      play: playback.play,
      stop: playback.stop,
    }),
  }
})

const soprano: VoicePart = {
  id: 's1',
  name: 'Soprano 1',
  shortLabel: 'S1',
  color: '#c23b2a',
  targetTakes: 4,
}

const alto: VoicePart = {
  id: 'a1',
  name: 'Alto 2',
  shortLabel: 'A2',
  color: '#4d6a8f',
  targetTakes: 4,
}

function phrase(overrides: Partial<Phrase> & { id: string }): Phrase {
  return {
    name: overrides.name ?? overrides.id,
    startMs: 0,
    endMs: 1000,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

function sampleTake(overrides: Partial<Take> = {}): Take {
  return {
    id: 't1',
    phraseId: 'p1',
    voicePartId: 's1',
    takeIndex: 1,
    audioBlobId: 'b1',
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: 0,
    ...overrides,
  }
}

function stubMedia(byteSize = 2048) {
  const stream = { getTracks: () => [{ stop: vi.fn() }] }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })

  class FakeMediaRecorder {
    state = 'inactive'
    mimeType = 'audio/webm'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({
        data: new Blob([new Uint8Array(byteSize)], { type: this.mimeType }),
      })
      this.onstop?.()
    }
    static isTypeSupported() {
      return true
    }
  }
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
}

describe('SingPage booth flow', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    playback.play.mockClear()
    playback.stop.mockClear()
    playback.state.listeners = undefined
    database = new AcapellaDB(`acapellaplanner-sing-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    const base = createEmptyProject('When I Fall')
    const saved = await repo.saveProject({
      ...base,
      voiceRoster: [soprano, alto],
      phrases: [
        phrase({
          id: 'p1',
          name: 'when I fall',
          lyricText: 'when I fall in love',
          startMs: 0,
          endMs: 1000,
        }),
        phrase({
          id: 'p2',
          name: 'it will be forever',
          lyricText: 'it will be forever',
          startMs: 2000,
          endMs: 3000,
        }),
      ],
    } satisfies Project)
    projectId = saved.id
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    database.close()
    await database.delete()
  })

  function renderSing() {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/sing`]}>
        <AppRoutes repo={repo} />
      </MemoryRouter>,
    )
  }

  it('shows the lyric after picking a part and keeps Record', async () => {
    renderSing()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /S1/ })).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /A2/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Surprise me with what’s left/ })).toBeTruthy()
    expect(screen.queryByText('when I fall in love')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /S1/ }))

    await waitFor(() => {
      expect(screen.getByText('when I fall in love')).toBeTruthy()
    })
    expect(screen.getByText('Phrase 1 of 2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Good enough' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
  })

  it('Good enough persists enough and advances to the next phrase', async () => {
    renderSing()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /S1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /S1/ }))

    await waitFor(() => {
      expect(screen.getByText('when I fall in love')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Good enough' }))

    await waitFor(() => {
      expect(screen.getByText('it will be forever')).toBeTruthy()
    })
    expect(screen.queryByText('when I fall in love')).toBeNull()
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    expect(screen.getByText('Phrase 2 of 2')).toBeTruthy()

    const loaded = await repo.getProject(projectId)
    const plan = loaded?.phrases.find((item) => item.id === 'p1')?.partPlan.find(
      (row) => row.voicePartId === 's1',
    )
    expect(plan?.status).toBe('enough')
  })

  it('keeps a saved take after Good enough and Next', async () => {
    const current = await repo.getProject(projectId)
    await repo.saveProject({
      ...current!,
      phrases: current!.phrases.map((item) =>
        item.id === 'p1'
          ? {
              ...item,
              partPlan: [
                {
                  voicePartId: 's1',
                  priority: 0,
                  targetTakes: 4,
                  requiredGuide: ['ghost'] as const,
                  status: 'in-progress' as const,
                },
              ],
            }
          : item,
      ),
      takes: [sampleTake()],
    })

    renderSing()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /S1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /S1/ }))

    await waitFor(() => {
      expect(screen.getByText('when I fall in love')).toBeTruthy()
    })
    expect(screen.getByLabelText('Takes').textContent).toMatch(/1\s*\/\s*4/)

    fireEvent.click(screen.getByRole('button', { name: 'Good enough' }))

    await waitFor(() => {
      expect(screen.getByText('it will be forever')).toBeTruthy()
    })

    let loaded = await repo.getProject(projectId)
    expect(loaded?.takes.map((item) => item.id)).toEqual(['t1'])
    expect(
      loaded?.phrases.find((item) => item.id === 'p1')?.partPlan.find((row) => row.voicePartId === 's1')
        ?.status,
    ).toBe('enough')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(screen.getByText(/That.s a wrap for Soprano 1/)).toBeTruthy()
    })

    loaded = await repo.getProject(projectId)
    expect(loaded?.takes.map((item) => item.id)).toEqual(['t1'])
  })

  it('does not drop a take when Good enough runs before the take save resolves', async () => {
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

    stubMedia()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    render(
      <MemoryRouter initialEntries={[`/project/${projectId}/sing`]}>
        <AppRoutes repo={gatedRepo} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /S1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /S1/ }))
    await waitFor(() => {
      expect(screen.getByText('when I fall in love')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => {
      expect(playback.play).toHaveBeenCalled()
    })

    now += 10
    playback.state.listeners?.onPassStart?.()
    now += 500
    playback.state.listeners?.onPassComplete?.()

    await firstSaveStarted
    fireEvent.click(screen.getByRole('button', { name: 'Good enough' }))
    releaseFirstSave()

    await waitFor(async () => {
      const loaded = await repo.getProject(projectId)
      expect(loaded?.takes).toHaveLength(1)
      expect(
        loaded?.phrases
          .find((item) => item.id === 'p1')
          ?.partPlan.find((row) => row.voicePartId === 's1')?.status,
      ).toBe('enough')
    })
  })

  it('Next on the last remaining cell goes to wrap-up', async () => {
    const current = await repo.getProject(projectId)
    await repo.saveProject({
      ...current!,
      phrases: current!.phrases.map((item) =>
        item.id === 'p1'
          ? {
              ...item,
              partPlan: [
                {
                  voicePartId: 's1',
                  priority: 0,
                  targetTakes: 4,
                  requiredGuide: ['ghost'] as const,
                  status: 'enough' as const,
                },
              ],
            }
          : item,
      ),
    })

    renderSing()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /S1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /S1/ }))
    await waitFor(() => {
      expect(screen.getByText('it will be forever')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(screen.getByText(/That.s a wrap for Soprano 1/)).toBeTruthy()
    })
    expect(screen.getByText(/This part is full enough/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Need more takes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sing another part' })).toBeTruthy()
  })

  it('Need more takes reopens the part so the singer can record again', async () => {
    const current = await repo.getProject(projectId)
    await repo.saveProject({
      ...current!,
      phrases: current!.phrases.map((item) => ({
        ...item,
        partPlan: [
          {
            voicePartId: 's1',
            priority: 0,
            targetTakes: 4,
            requiredGuide: ['ghost'] as const,
            status: 'enough' as const,
          },
        ],
      })),
      takes: [
        sampleTake({ id: 't1', phraseId: 'p1', takeIndex: 1 }),
        sampleTake({ id: 't2', phraseId: 'p1', takeIndex: 2 }),
        sampleTake({ id: 't3', phraseId: 'p1', takeIndex: 3 }),
        sampleTake({ id: 't4', phraseId: 'p1', takeIndex: 4 }),
      ],
    })

    renderSing()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /S1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /S1/ }))
    await waitFor(() => {
      expect(screen.getByText(/That.s a wrap for Soprano 1/)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Need more takes' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    })
    expect(screen.getByText('when I fall in love')).toBeTruthy()
    expect(screen.getByLabelText('Takes').textContent).toMatch(/4\s*\/\s*5/)

    const loaded = await repo.getProject(projectId)
    const plan = loaded?.phrases
      .find((item) => item.id === 'p1')
      ?.partPlan.find((row) => row.voicePartId === 's1')
    expect(plan?.status).toBe('in-progress')
    expect(plan?.targetTakes).toBe(5)
  })

  it('Surprise me opens a remaining phrase', async () => {
    renderSing()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Surprise me with what’s left/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /Surprise me with what’s left/ }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    })
    expect(
      screen.queryByText('when I fall in love') ?? screen.queryByText('it will be forever'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Good enough' })).toBeTruthy()
  })

  it('shows a calm empty booth when the preparer has not set phrases and parts', async () => {
    const empty = await repo.saveProject(createEmptyProject('Quiet rehearsal'))
    render(
      <MemoryRouter initialEntries={[`/project/${empty.id}/sing`]}>
        <AppRoutes repo={repo} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('Nothing to sing yet — the preparer still needs phrases and voice parts.'),
      ).toBeTruthy()
    })
    expect(screen.getByText(/The booth is quiet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
  })

  it('shows the bound sheet crop in the booth', async () => {
    const imageBlobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: imageBlobId,
      projectId,
      kind: 'sheet',
      mimeType: 'image/png',
      byteSize: 4,
      createdAt: new Date().toISOString(),
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
    })
    const current = await repo.getProject(projectId)
    await repo.saveProject({
      ...current!,
      sheetDocs: [
        {
          id: 'doc-1',
          name: 'lead.pdf',
          source: 'pdf',
          pages: [{ pageIndex: 0, imageBlobId }],
        },
      ],
      phrases: current!.phrases.map((item) =>
        item.id === 'p1'
          ? {
              ...item,
              sheetRefs: [
                {
                  id: 'ref-1',
                  sheetDocId: 'doc-1',
                  pageIndex: 0,
                  regionNorm: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
                },
              ],
            }
          : item,
      ),
    })

    renderSing()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /S1/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /S1/ }))

    await waitFor(() => {
      expect(screen.getByLabelText('Sheet crop')).toBeTruthy()
    })
    expect(screen.getByText('when I fall in love')).toBeTruthy()
    expect(screen.getByLabelText('Sheet crop').querySelector('img')).toBeTruthy()
  })
})
