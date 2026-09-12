import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/routes.tsx'
import { createEmptyProject } from '../../src/domain/schemas.ts'
import { AcapellaDB } from '../../src/storage/db.ts'
import { exportProjectZip } from '../../src/storage/projectIO.ts'
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
      expect(screen.getByLabelText('Import ghost track')).toBeTruthy()
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

  it('imports a project zip into the list with its audio blob', async () => {
    const source = await repo.saveProject({
      ...createEmptyProject('Imported song'),
      ghostTrackId: 'blob-tiny',
    })
    const audio = new Blob(['ghost-audio'], { type: 'audio/webm' })
    await repo.putAudioBlob({
      id: 'blob-tiny',
      projectId: source.id,
      kind: 'ghost',
      mimeType: 'audio/webm',
      byteSize: audio.size,
      createdAt: source.createdAt,
      blob: audio,
    })
    const zip = await exportProjectZip(source, async () => audio)
    await repo.deleteProject(source.id)

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('No songs yet')).toBeTruthy()
    })

    const file = new File([zip], 'song.acapella.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('Import zip'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Imported song')).toBeTruthy()
    })
    const listed = await repo.listProjects()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.title).toBe('Imported song')
    expect(listed[0]?.ghostTrackId).toBe('blob-tiny')
    const loadedBlob = await repo.getAudioBlob('blob-tiny')
    expect(loadedBlob?.kind).toBe('ghost')
    expect(loadedBlob?.mimeType).toBe('audio/webm')
    expect(loadedBlob?.byteSize).toBe(11)
  })

  it('does not save when project.json is invalid JSON', async () => {
    const broken = new Blob(
      [zipSync({ 'project.json': strToU8('{not json') })],
      { type: 'application/zip' },
    )

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('No songs yet')).toBeTruthy()
    })

    const file = new File([broken], 'bad.acapella.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('Import zip'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(await repo.listProjects()).toHaveLength(0)
  })

  it('does not store zip-slip or extra blobs that are not in the project', async () => {
    const source = await repo.saveProject({
      ...createEmptyProject('Imported song'),
      ghostTrackId: 'blob-tiny',
    })
    const audio = new Blob(['ghost-audio'], { type: 'audio/webm' })
    await repo.putAudioBlob({
      id: 'blob-tiny',
      projectId: source.id,
      kind: 'ghost',
      mimeType: 'audio/webm',
      byteSize: audio.size,
      createdAt: source.createdAt,
      blob: audio,
    })
    const zip = await exportProjectZip(source, async () => audio)
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    files['audio/extra-not-referenced.webm'] = new Uint8Array([9, 9, 9])
    files['audio/nested/../slip.webm'] = new Uint8Array([8])
    files['audio/../evil.webm'] = new Uint8Array([7])
    const padded = new Blob([zipSync(files)], { type: 'application/zip' })
    await repo.deleteProject(source.id)

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('No songs yet')).toBeTruthy()
    })

    const file = new File([padded], 'song.acapella.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('Import zip'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Imported song')).toBeTruthy()
    })
    expect(await repo.getAudioBlob('blob-tiny')).toBeTruthy()
    expect(await repo.getAudioBlob('extra-not-referenced')).toBeUndefined()
    expect(await repo.getAudioBlob('slip')).toBeUndefined()
    expect(await repo.getAudioBlob('evil')).toBeUndefined()
  })
})
