import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { createEmptyProject, type Phrase, type Project, type VoicePart } from '../../src/domain/schemas.ts'
import { AcapellaDB } from '../../src/storage/db.ts'
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../src/storage/projectRepository.ts'

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

describe('SingPage booth flow', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
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
})
