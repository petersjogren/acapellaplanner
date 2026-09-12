import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepositoryContext } from '../../app/projectRepositoryContext.tsx'
import type { PlaybackEngine, PlaybackListeners } from '../../audio/engine.ts'
import {
  createEmptyProject,
  type Phrase,
  type Project,
  type Take,
  type VoicePart,
} from '../../domain/schemas.ts'
import type { ProjectRepository } from '../../storage/projectRepository.ts'
import { RecordControl } from './RecordControl.tsx'

const soprano: VoicePart = {
  id: 's1',
  name: 'Soprano 1',
  shortLabel: 'S1',
  color: '#c23b2a',
  targetTakes: 4,
}

const phrase: Phrase = {
  id: 'p1',
  name: 'when I fall',
  startMs: 1000,
  endMs: 3000,
  sheetRefs: [],
  partPlan: [],
  loopDefault: { mode: 'phrase-loop', gapMs: 400 },
  preRollMs: 250,
  postRollMs: 100,
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

function projectWith(overrides: Partial<Project> = {}): Project {
  const base = createEmptyProject('When I Fall')
  return {
    ...base,
    voiceRoster: [soprano],
    phrases: [phrase],
    guides: [
      {
        id: 'ghost-guide',
        kind: 'ghost',
        audioBlobId: 'ghost-blob',
        gainDbDefault: 0,
        alignToGhost: true,
      },
    ],
    ...overrides,
  }
}

function mockRepo(overrides: Partial<ProjectRepository> = {}): ProjectRepository {
  return {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    saveProject: vi.fn(async (project) => project),
    deleteProject: vi.fn(),
    putAudioBlob: vi.fn(async (record) => record.id),
    getAudioBlob: vi.fn(),
    ...overrides,
  }
}

function mockEngine(): {
  engine: PlaybackEngine
  listeners: { current: PlaybackListeners | undefined }
} {
  const listeners: { current: PlaybackListeners | undefined } = { current: undefined }
  const engine: PlaybackEngine = {
    play: vi.fn(async (_spec, next) => {
      listeners.current = next
      return true
    }),
    stop: vi.fn(),
  }
  return { engine, listeners }
}

function stubMedia(byteSize = 2048) {
  const trackStop = vi.fn()
  const recorderStop = vi.fn()
  const stream = { getTracks: () => [{ stop: trackStop }] }
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
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
      recorderStop()
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
  return { getUserMedia, trackStop, recorderStop, stream }
}

function renderControl({
  repo = mockRepo(),
  engine,
  project = projectWith(),
  onProjectChange = vi.fn(),
}: {
  repo?: ProjectRepository
  engine: PlaybackEngine
  project?: Project
  onProjectChange?: (project: Project) => void
} = { engine: mockEngine().engine }) {
  const view = render(
    <ProjectRepositoryContext.Provider value={repo}>
      <RecordControl
        phrase={phrase}
        voicePart={soprano}
        project={project}
        onProjectChange={onProjectChange}
        engine={engine}
      />
    </ProjectRepositoryContext.Provider>,
  )
  return {
    repo,
    onProjectChange,
    rerender(next: Project) {
      view.rerender(
        <ProjectRepositoryContext.Provider value={repo}>
          <RecordControl
            phrase={phrase}
            voicePart={soprano}
            project={next}
            onProjectChange={onProjectChange}
            engine={engine}
          />
        </ProjectRepositoryContext.Provider>,
      )
    },
  }
}

describe('RecordControl', () => {
  beforeEach(() => {
    stubMedia()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows take count over target', () => {
    const { engine } = mockEngine()
    renderControl({
      engine,
      project: projectWith({
        takes: [sampleTake()],
      }),
    })
    expect(screen.getByText('1 / 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
  })

  it('arms recording and starts playback', async () => {
    const { engine } = mockEngine()
    renderControl({ engine })

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1)
    })
    expect(engine.play).toHaveBeenCalledWith(
      expect.objectContaining({
        startMs: 1000,
        endMs: 3000,
        preRollMs: 250,
        postRollMs: 100,
        gapMs: 400,
        loop: true,
      }),
      expect.objectContaining({
        onPassStart: expect.any(Function),
        onPassComplete: expect.any(Function),
      }),
    )
    expect(screen.getByRole('button', { name: 'Record' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('saves a take on onPassComplete via the repository', async () => {
    const { engine, listeners } = mockEngine()
    const repo = mockRepo()
    const onProjectChange = vi.fn()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    renderControl({ engine, repo, onProjectChange })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => {
      expect(engine.play).toHaveBeenCalled()
    })

    now += 10
    listeners.current?.onPassStart?.()
    now += 500
    listeners.current?.onPassComplete?.()

    await waitFor(() => {
      expect(repo.putAudioBlob).toHaveBeenCalledTimes(1)
    })
    expect(repo.putAudioBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'take',
        projectId: expect.any(String),
        mimeType: 'audio/webm',
        byteSize: 2048,
      }),
    )
    expect(repo.saveProject).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(repo.saveProject).mock.calls[0]?.[0]
    expect(saved?.takes).toHaveLength(1)
    expect(saved?.takes[0]).toEqual(
      expect.objectContaining({
        phraseId: 'p1',
        voicePartId: 's1',
        takeIndex: 1,
        durationMs: 500,
        peakDb: 0,
        clipFlag: false,
        latencyCompMs: 0,
        notes: 'S1_p1_t1',
      }),
    )
    expect(saved?.takes[0]?.headphoneMixSnapshot).toEqual({
      layers: [
        {
          guideOrTakeRef: 'ghost-guide',
          gainDb: 0,
          pan: 0,
          mute: false,
        },
      ],
    })
    expect(saved?.takes[0]?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(onProjectChange).toHaveBeenCalledWith(saved)
  })

  it('stops MediaRecorder at pass complete before persist resolves', async () => {
    const { recorderStop } = stubMedia()
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const repo = mockRepo({
      putAudioBlob: vi.fn(async (record) => {
        await hold
        return record.id
      }),
    })
    const { engine, listeners } = mockEngine()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    renderControl({ engine, repo })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => {
      expect(engine.play).toHaveBeenCalled()
    })

    now += 10
    listeners.current?.onPassStart?.()
    now += 500
    listeners.current?.onPassComplete?.()

    await waitFor(() => {
      expect(repo.putAudioBlob).toHaveBeenCalledTimes(1)
    })
    expect(recorderStop).toHaveBeenCalledTimes(1)
    expect(repo.saveProject).not.toHaveBeenCalled()

    now += 10
    listeners.current?.onPassStart?.()
    now += 500
    listeners.current?.onPassComplete?.()

    expect(recorderStop).toHaveBeenCalledTimes(2)
    expect(repo.saveProject).not.toHaveBeenCalled()

    release()
    await waitFor(() => {
      expect(repo.saveProject).toHaveBeenCalledTimes(2)
    })
  })

  it('increments takeIndex for each completed pass', async () => {
    const { engine, listeners } = mockEngine()
    const repo = mockRepo()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    renderControl({ engine, repo })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => {
      expect(engine.play).toHaveBeenCalled()
    })

    now += 10
    listeners.current?.onPassStart?.()
    now += 500
    listeners.current?.onPassComplete?.()
    await waitFor(() => {
      expect(repo.saveProject).toHaveBeenCalledTimes(1)
    })

    now += 10
    listeners.current?.onPassStart?.()
    now += 500
    listeners.current?.onPassComplete?.()
    await waitFor(() => {
      expect(repo.saveProject).toHaveBeenCalledTimes(2)
    })

    const second = vi.mocked(repo.saveProject).mock.calls[1]?.[0]
    expect(second?.takes).toHaveLength(2)
    expect(second?.takes.map((item) => item.takeIndex)).toEqual([1, 2])
    expect(second?.takes[1]?.notes).toBe('S1_p1_t2')
  })

  it('appends the take onto the latest project after putAudioBlob', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const repo = mockRepo({
      putAudioBlob: vi.fn(async (record) => {
        await hold
        return record.id
      }),
    })
    const { engine, listeners } = mockEngine()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const { rerender } = renderControl({ engine, repo, project: projectWith() })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => {
      expect(engine.play).toHaveBeenCalled()
    })

    now += 10
    listeners.current?.onPassStart?.()
    now += 500
    listeners.current?.onPassComplete?.()

    await waitFor(() => {
      expect(repo.putAudioBlob).toHaveBeenCalledTimes(1)
    })

    rerender(projectWith({ takes: [sampleTake()] }))
    release()

    await waitFor(() => {
      expect(repo.saveProject).toHaveBeenCalledTimes(1)
    })
    const saved = vi.mocked(repo.saveProject).mock.calls[0]?.[0]
    expect(saved?.takes).toHaveLength(2)
    expect(saved?.takes.map((item) => item.takeIndex)).toEqual([1, 2])
  })

  it('discards a near-empty take and surfaces an alert', async () => {
    stubMedia(10)
    const { engine, listeners } = mockEngine()
    const repo = mockRepo()
    renderControl({ engine, repo })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => {
      expect(engine.play).toHaveBeenCalled()
    })
    listeners.current?.onPassStart?.()
    listeners.current?.onPassComplete?.()

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('nothing caught — try again')
    })
    expect(repo.putAudioBlob).not.toHaveBeenCalled()
    expect(repo.saveProject).not.toHaveBeenCalled()
  })

  it('alerts when the microphone is denied and allows retry', async () => {
    const { getUserMedia, stream } = stubMedia()
    getUserMedia.mockReset()
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'))
    getUserMedia.mockResolvedValueOnce(stream)
    const { engine } = mockEngine()
    renderControl({ engine })

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Permission denied')
    })
    expect(screen.getByRole('button', { name: 'Record' })).toHaveProperty('disabled', false)
    expect(engine.play).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1)
    })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('does not start a second arm while the first is in flight', async () => {
    const { getUserMedia, stream } = stubMedia()
    let resolveStream!: (value: typeof stream) => void
    getUserMedia.mockReset()
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve
        }),
    )
    const { engine } = mockEngine()
    renderControl({ engine })

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))

    expect(getUserMedia).toHaveBeenCalledTimes(1)

    resolveStream(stream)
    await waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1)
    })
  })

  it('stops microphone tracks on disarm', async () => {
    const { trackStop } = stubMedia()
    const { engine } = mockEngine()
    renderControl({ engine })

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(engine.stop).toHaveBeenCalled()
    expect(trackStop).toHaveBeenCalled()
  })

  it('toggles arm with the space key and ignores space in an input', async () => {
    const { engine } = mockEngine()
    renderControl({ engine })

    const repeat = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
      repeat: true,
    })
    window.dispatchEvent(repeat)
    expect(repeat.defaultPrevented).toBe(true)
    expect(engine.play).not.toHaveBeenCalled()

    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    window.dispatchEvent(space)
    expect(space.defaultPrevented).toBe(true)

    await waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1)
    })

    const held = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
      repeat: true,
    })
    window.dispatchEvent(held)
    expect(engine.play).toHaveBeenCalledTimes(1)
    expect(engine.stop).not.toHaveBeenCalled()

    const input = document.createElement('input')
    document.body.appendChild(input)
    const typed = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    input.dispatchEvent(typed)
    expect(typed.defaultPrevented).toBe(false)
    expect(engine.play).toHaveBeenCalledTimes(1)
    input.remove()
  })
})
