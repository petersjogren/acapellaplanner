import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { createEmptyProject } from '../../src/domain/schemas.ts'
import { AcapellaDB } from '../../src/storage/db.ts'
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../src/storage/projectRepository.ts'

describe('HomePage', () => {
  let database: AcapellaDB
  let repo: ProjectRepository

  beforeEach(() => {
    database = new AcapellaDB(`acapellaplanner-home-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
  })

  afterEach(async () => {
    cleanup()
    database.close()
    await database.delete()
  })

  function renderHome() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes repo={repo} />
      </MemoryRouter>,
    )
  }

  it('lists saved project titles', async () => {
    const saved = await repo.saveProject(createEmptyProject('When I Fall in Love'))
    await repo.saveProject(createEmptyProject('Autumn Leaves'))

    renderHome()

    await waitFor(() => {
      expect(screen.getByText('When I Fall in Love')).toBeTruthy()
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: /When I Fall in Love/ }).getAttribute('href')).toBe(
      `/project/${saved.id}/prepare`,
    )
    expect(document.querySelector(`time[datetime="${saved.updatedAt}"]`)).toBeTruthy()
  })

  it('creates a project with New song and lands on prepare', async () => {
    renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'New song' }))

    await waitFor(() => {
      expect(screen.getByText('Ghost track comes next')).toBeTruthy()
    })

    const listed = await repo.listProjects()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.title).toBe('Untitled song')
    expect(screen.getByRole('heading', { level: 1, name: 'Untitled song' })).toBeTruthy()
  })

  it('surfaces a rejected listProjects call as an alert', async () => {
    const failingRepo: ProjectRepository = {
      ...repo,
      listProjects: () => Promise.reject(new Error('Storage unavailable')),
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes repo={failingRepo} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Storage unavailable')
    })
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('surfaces a rejected New song save as an alert', async () => {
    const failingRepo: ProjectRepository = {
      ...repo,
      saveProject: () => Promise.reject(new Error('Could not save')),
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes repo={failingRepo} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('No songs yet')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'New song' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not save')
    })
    expect(screen.getByRole('button', { name: 'New song' })).toBeTruthy()
  })
})
