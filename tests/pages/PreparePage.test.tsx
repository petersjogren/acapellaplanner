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
      expect(screen.getByText('1:23.4')).toBeTruthy()
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
      expect(screen.getByText('1:23.4')).toBeTruthy()
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
