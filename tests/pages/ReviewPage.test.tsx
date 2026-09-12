import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
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
    database = new AcapellaDB(`acapellaplanner-review-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    const project: Project = {
      ...createEmptyProject('When I Fall'),
      voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })],
      phrases: [phrase({ id: 'p1', name: 'when I fall' })],
      takes: [take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 })],
    }
    const saved = await repo.saveProject(project)
    projectId = saved.id
  })

  afterEach(async () => {
    cleanup()
    database.close()
    await database.delete()
  })

  it('clicking Keeper persists rating keeper via the repository', async () => {
    const saveProject = vi.fn(async (project: Project) => repo.saveProject(project))
    const mocked: ProjectRepository = {
      ...repo,
      saveProject,
    }

    render(
      <MemoryRouter initialEntries={[`/project/${projectId}/review`]}>
        <AppRoutes repo={mocked} />
      </MemoryRouter>,
    )

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
})
