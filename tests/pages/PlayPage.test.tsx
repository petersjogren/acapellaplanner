import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { decodeAudioFile } from '../../src/audio/decode.ts'
import type { PlaybackListeners } from '../../src/audio/engine.ts'
import type { PhrasePlaySpec } from '../../src/audio/schedule.ts'
import {
  createEmptyProject,
  type Phrase,
  type Project,
  type Section,
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
  const state: { spec: PhrasePlaySpec | undefined; listeners: PlaybackListeners | undefined } = {
    spec: undefined,
    listeners: undefined,
  }
  return {
    state,
    play: vi.fn(async (spec: PhrasePlaySpec, listeners?: PlaybackListeners) => {
      state.spec = spec
      state.listeners = listeners
      return true
    }),
    stop: vi.fn(),
    getPositionMs: vi.fn((): number | null => null),
  }
})

vi.mock('../../src/audio/engine.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audio/engine.ts')>()
  return {
    ...actual,
    createPlaybackEngine: () => ({
      play: playback.play,
      stop: playback.stop,
      getPositionMs: playback.getPositionMs,
    }),
  }
})

function phrase(overrides: Partial<Phrase> & { id: string }): Phrase {
  return {
    name: overrides.name ?? overrides.id,
    startMs: 0,
    endMs: 1000,
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

describe('PlayPage', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    playback.play.mockClear()
    playback.stop.mockClear()
    playback.getPositionMs.mockReset()
    playback.getPositionMs.mockReturnValue(null)
    playback.state.spec = undefined
    playback.state.listeners = undefined
    database = new AcapellaDB(`acapellaplanner-play-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    vi.mocked(decodeAudioFile).mockReset()
    vi.mocked(decodeAudioFile).mockResolvedValue({
      buffer: { duration: 10, sampleRate: 44100 } as AudioBuffer,
      durationMs: 10_000,
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
    const verse: Section = {
      id: 'verse',
      name: 'Verse',
      timeMode: 'ghost-follow',
      fromPhraseId: 'p1',
      toPhraseId: 'p2',
      clickEnabled: false,
    }
    const project: Project = {
      ...createEmptyProject('When I Fall'),
      phrases: [
        phrase({
          id: 'p1',
          name: 'when I fall',
          lyricText: 'when I fall in love',
          startMs: 1000,
          endMs: 3000,
        }),
        phrase({
          id: 'p2',
          name: 'it will be forever',
          lyricText: 'it will be forever',
          startMs: 3000,
          endMs: 5000,
          loopDefault: { mode: 'phrase-loop', gapMs: 250 },
        }),
      ],
      sections: [verse],
      ghostTrackId: ghostBlobId,
      settings: { language: 'en', ghostMeta: { filename: 'ghost.wav', durationMs: 10_000 } },
    }
    const saved = await repo.saveProject(project)
    projectId = saved.id
  })

  afterEach(async () => {
    cleanup()
    database.close()
    await database.delete()
  })

  function renderPlay() {
    return render(
      <MemoryRouter initialEntries={[`/project/${projectId}/play`]}>
        <AppRoutes repo={repo} />
      </MemoryRouter>,
    )
  }

  it('shows follow-along chrome, no Record, and the phrase list', async () => {
    renderPlay()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByLabelText('Once through')).toBeTruthy()
    expect(screen.getByLabelText('Loop this phrase')).toBeTruthy()
    expect(screen.getByLabelText('Loop this section')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Phrases' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'when I fall in love' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Play' }).getAttribute('aria-current')).toBe('page')
  })

  it('plays the whole ghost once from the top', async () => {
    renderPlay()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    await waitFor(() => {
      expect(playback.play).toHaveBeenCalled()
    })
    expect(playback.state.spec).toEqual(
      expect.objectContaining({
        startMs: 0,
        endMs: 10_000,
        preRollMs: 0,
        postRollMs: 0,
        loop: false,
        gapMs: 0,
      }),
    )
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })

  it('jumps to a phrase and plays from there through the end', async () => {
    renderPlay()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'it will be forever' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    await waitFor(() => {
      expect(playback.play).toHaveBeenCalled()
    })
    expect(playback.state.spec).toEqual(
      expect.objectContaining({
        startMs: 3000,
        endMs: 10_000,
        loop: false,
      }),
    )
  })

  it('loops the selected phrase with its stored gap', async () => {
    renderPlay()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'it will be forever' }))
    fireEvent.click(screen.getByLabelText('Loop this phrase'))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    await waitFor(() => {
      expect(playback.play).toHaveBeenCalled()
    })
    expect(playback.state.spec).toEqual(
      expect.objectContaining({
        startMs: 3000,
        endMs: 5000,
        loop: true,
        gapMs: 250,
        preRollMs: 0,
        postRollMs: 0,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  })

  it('loops the section that contains the selected phrase', async () => {
    renderPlay()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByLabelText('Loop this section'))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    await waitFor(() => {
      expect(playback.play).toHaveBeenCalled()
    })
    expect(playback.state.spec).toEqual(
      expect.objectContaining({
        startMs: 1000,
        endMs: 5000,
        loop: true,
        gapMs: 400,
      }),
    )
  })

  it('Stop cancels playback', async () => {
    renderPlay()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play' })).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(playback.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
  })
})
