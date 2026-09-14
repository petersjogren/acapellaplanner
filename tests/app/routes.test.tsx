import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { createEmptyProject } from '../../src/domain/schemas.ts'
import { AcapellaDB } from '../../src/storage/db.ts'
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../src/storage/projectRepository.ts'

describe('routes', () => {
  let database: AcapellaDB
  let repo: ProjectRepository
  let projectId: string

  beforeEach(async () => {
    database = new AcapellaDB(`acapellaplanner-routes-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
    const project = await repo.saveProject(createEmptyProject('Landmark song'))
    projectId = project.id
  })

  afterEach(async () => {
    cleanup()
    database.close()
    await database.delete()
  })

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes repo={repo} />
      </MemoryRouter>,
    )
  }

  it('registers home, prepare, sing, and review routes', async () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Acapella Planner' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New song' })).toBeTruthy()
    cleanup()

    renderAt(`/project/${projectId}/prepare`)
    await waitFor(() => {
      expect(screen.getByLabelText('Import ghost track')).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: /Prepare/ }).getAttribute('href')).toBe(
      `/project/${projectId}/prepare`,
    )
    expect(screen.getByRole('link', { name: /Sing/ }).getAttribute('href')).toBe(
      `/project/${projectId}/sing`,
    )
    expect(screen.getByRole('link', { name: /Review/ }).getAttribute('href')).toBe(
      `/project/${projectId}/review`,
    )
    cleanup()

    renderAt(`/project/${projectId}/sing`)
    await waitFor(() => {
      expect(screen.getByText(/The booth is quiet/)).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: 'Landmark song' }).getAttribute('href')).toBe(
      `/project/${projectId}/prepare`,
    )
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
    cleanup()

    renderAt(`/project/${projectId}/review`)
    await waitFor(() => {
      expect(screen.getByText('Hear a take with the ghost or solo, or all keepers together with or without the ghost.')).toBeTruthy()
    })
    expect(screen.getByRole('navigation', { name: 'Studio' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Review/ }).getAttribute('aria-current')).toBe('page')
    cleanup()

    renderAt('/calibrate')
    expect(screen.getByRole('heading', { name: 'Line up headphones' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
  })

  it('shows not-found when the project id is missing', async () => {
    renderAt('/project/missing-id/prepare')

    await waitFor(() => {
      expect(screen.getByText(/Project not found/)).toBeTruthy()
    })
  })

  it('shows not found for unknown paths', () => {
    renderAt('/no-such-page')
    expect(screen.getByRole('heading', { name: 'Not found' })).toBeTruthy()
  })

  it('surfaces a rejected getProject call as an alert', async () => {
    const failingRepo: ProjectRepository = {
      ...repo,
      getProject: () => Promise.reject(new Error('Read failed')),
    }

    render(
      <MemoryRouter initialEntries={[`/project/${projectId}/prepare`]}>
        <AppRoutes repo={failingRepo} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Read failed')
    })
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText('Project not found')).toBeNull()
  })
})
