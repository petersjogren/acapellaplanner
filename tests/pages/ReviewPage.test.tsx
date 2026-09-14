import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { decodeAudioFile } from '../../src/audio/decode.ts'
import type { PlaybackMix } from '../../src/audio/mix.ts'
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

vi.mock('../../src/audio/decode.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audio/decode.ts')>()
  return {
    ...actual,
    decodeAudioFile: vi.fn(),
  }
})

const playback = vi.hoisted(() => {
  const calls: PlaybackMix[] = []
  return {
    calls,
    play: vi.fn(async (_spec: unknown, _listeners: unknown, mix?: PlaybackMix) => {
      if (mix) calls.push(mix)
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

function part(overrides: Partial<VoicePart> & { id: string }): VoicePart {
  return {
    name: overrides.name ?? overrides.id,
    shortLabel: overrides.shortLabel ?? overrides.id,
    color: '#c23b2a',
    targetTakes: 4,
    ...overrides,
  }
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

function take(
  overrides: Partial<Take> & { id: string; phraseId: string; voicePartId: string },
): Take {
  return {
    takeIndex: 1,
    audioBlobId: 'blob-1',
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: -6,
    ...overrides,
  }
}

describe('ReviewPage', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    playback.play.mockClear()
    playback.stop.mockClear()
    playback.calls.length = 0
    database = new AcapellaDB(`acapellaplanner-review-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    vi.mocked(decodeAudioFile).mockReset()
    vi.mocked(decodeAudioFile).mockResolvedValue({
      buffer: { duration: 3, sampleRate: 44100 } as AudioBuffer,
      durationMs: 3000,
      sampleRate: 44100,
    })
    const ghostBlobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: ghostBlobId,
      projectId: 'pending',
      kind: 'ghost',
      mimeType: 'audio/wav',
      byteSize: 4,
      createdAt: new Date().toISOString(),
      blob: new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'audio/wav' }),
    })
    for (const takeId of ['blob-1', 'blob-2', 'blob-3']) {
      await repo.putAudioBlob({
        id: takeId,
        projectId: 'pending',
        kind: 'take',
        mimeType: 'audio/webm',
        byteSize: 4,
        createdAt: new Date().toISOString(),
        blob: new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'audio/webm' }),
      })
    }
    const project: Project = {
      ...createEmptyProject('When I Fall'),
      voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })],
      phrases: [phrase({ id: 'p1', name: 'when I fall' })],
      takes: [take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 })],
      ghostTrackId: ghostBlobId,
      settings: { language: 'en', ghostMeta: { filename: 'ghost.wav', durationMs: 3000 } },
    }
    const saved = await repo.saveProject(project)
    projectId = saved.id
  })

  afterEach(async () => {
    cleanup()
    database.close()
    await database.delete()
  })

  function renderReview(repository: ProjectRepository = repo) {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/review`]}>
        <AppRoutes repo={repository} />
      </MemoryRouter>,
    )
  }

  it('clicking Keeper persists rating keeper via the repository', async () => {
    const saveProject = vi.fn(async (project: Project) => repo.saveProject(project))
    const mocked: ProjectRepository = {
      ...repo,
      saveProject,
    }

    renderReview(mocked)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keeper' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Keeper' }))

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalled()
    })
    const persisted = saveProject.mock.calls.at(-1)?.[0]
    expect(persisted?.takes[0]?.rating).toBe('keeper')
    const loaded = await repo.getProject(projectId)
    expect(loaded?.takes[0]?.rating).toBe('keeper')
    expect(loaded?.completion.cells[0]?.keeperCount).toBe(1)
  })

  it('"With ghost" plays the take against an unmuted ghost', async () => {
    renderReview()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'With ghost' })).toBeTruthy()
    })

    // The ghost buffer decodes asynchronously after mount; a click before it
    // resolves hits the "No ghost track" guard and never calls play(). Retry
    // the click (idempotent — it only ever changes the label once play()
    // resolves) until playback actually registers.
    await waitFor(() => {
      const button = screen.queryByRole('button', { name: 'With ghost' })
      if (button) fireEvent.click(button)
      expect(playback.calls.length).toBe(1)
    })
    expect(playback.calls[0]?.ghostMute).toBe(false)
    expect(playback.calls[0]?.extra).toHaveLength(1)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop — With ghost' })).toBeTruthy()
    })
  })

  it('"Solo (no ghost)" mutes the ghost and plays only the take', async () => {
    renderReview()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Solo (no ghost)' })).toBeTruthy()
    })

    await waitFor(() => {
      const button = screen.queryByRole('button', { name: 'Solo (no ghost)' })
      if (button) fireEvent.click(button)
      expect(playback.calls.length).toBe(1)
    })
    expect(playback.calls[0]?.ghostMute).toBe(true)
    expect(playback.calls[0]?.extra).toHaveLength(1)
  })

  it('"All keepers (no ghost)" plays every keeper on the filtered phrase with the ghost muted', async () => {
    const current = await repo.getProject(projectId)
    await repo.saveProject({
      ...current!,
      takes: [
        ...current!.takes,
        take({ id: 't2', phraseId: 'p1', voicePartId: 's1', takeIndex: 2, rating: 'keeper' }),
        take({ id: 't3', phraseId: 'p1', voicePartId: 's1', takeIndex: 3, rating: 'keeper' }),
      ],
    })

    renderReview()

    await waitFor(() => {
      expect(screen.getByLabelText('Phrase')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Phrase'), { target: { value: 'p1' } })

    await waitFor(() => {
      const button = screen.queryByRole('button', { name: 'All keepers (no ghost)' })
      if (button && !button.hasAttribute('disabled')) fireEvent.click(button)
      expect(playback.calls.length).toBe(1)
    })
    expect(playback.calls[0]?.ghostMute).toBe(true)
    // Both keepers (t2, t3) play together — t1 is unrated, not a keeper.
    expect(playback.calls[0]?.extra).toHaveLength(2)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop — All keepers (no ghost)' })).toBeTruthy()
    })
  })

  it('"All keepers (with ghost)" plays every keeper on the filtered phrase with the ghost audible', async () => {
    const current = await repo.getProject(projectId)
    await repo.saveProject({
      ...current!,
      takes: [
        ...current!.takes,
        take({ id: 't2', phraseId: 'p1', voicePartId: 's1', takeIndex: 2, rating: 'keeper' }),
        take({ id: 't3', phraseId: 'p1', voicePartId: 's1', takeIndex: 3, rating: 'keeper' }),
      ],
    })

    renderReview()

    await waitFor(() => {
      expect(screen.getByLabelText('Phrase')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Phrase'), { target: { value: 'p1' } })

    await waitFor(() => {
      const button = screen.queryByRole('button', { name: 'All keepers (with ghost)' })
      if (button && !button.hasAttribute('disabled')) fireEvent.click(button)
      expect(playback.calls.length).toBe(1)
    })
    expect(playback.calls[0]?.ghostMute).toBe(false)
    expect(playback.calls[0]?.extra).toHaveLength(2)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop — All keepers (with ghost)' })).toBeTruthy()
    })
  })

  it('"All keepers" buttons are disabled on a phrase with no keepers', async () => {
    renderReview()

    await waitFor(() => {
      expect(screen.getByLabelText('Phrase')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Phrase'), { target: { value: 'p1' } })

    const noGhost = await screen.findByRole('button', { name: 'All keepers (no ghost)' })
    const withGhost = await screen.findByRole('button', { name: 'All keepers (with ghost)' })
    expect(noGhost.hasAttribute('disabled')).toBe(true)
    expect(withGhost.hasAttribute('disabled')).toBe(true)
    fireEvent.click(noGhost)
    fireEvent.click(withGhost)
    expect(playback.play).not.toHaveBeenCalled()
  })
})
