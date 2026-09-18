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

  it('imports a project zip as a new project, not overwriting the original', async () => {
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

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Imported song')).toBeTruthy()
    })

    const file = new File([zip], 'song.acapella.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('Import zip'), { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Imported song (imported)')).toBeTruthy()
    })
    // Original project untouched.
    expect(screen.getByText('Imported song')).toBeTruthy()

    const listed = await repo.listProjects()
    expect(listed).toHaveLength(2)
    const original = listed.find((item) => item.id === source.id)
    const forked = listed.find((item) => item.id !== source.id)
    expect(original?.title).toBe('Imported song')
    expect(original?.ghostTrackId).toBe('blob-tiny')
    expect(forked?.title).toBe('Imported song (imported)')
    expect(forked?.id).not.toBe(source.id)
    expect(forked?.ghostTrackId).toBeTruthy()
    expect(forked?.ghostTrackId).not.toBe('blob-tiny')

    // Both projects keep their own, independent blob.
    expect(await repo.getAudioBlob('blob-tiny')).toBeTruthy()
    const forkedBlob = await repo.getAudioBlob(forked!.ghostTrackId!)
    expect(forkedBlob?.kind).toBe('ghost')
    expect(forkedBlob?.mimeType).toBe('audio/webm')
    expect(forkedBlob?.byteSize).toBe(11)
    expect(forkedBlob?.projectId).toBe(forked!.id)
  })

  it('numbers repeated imports of the same song apart', async () => {
    const source = await repo.saveProject(createEmptyProject('Alto part'))
    const zip = await exportProjectZip(source, async () => undefined)

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Alto part')).toBeTruthy()
    })

    const file1 = new File([zip], 'song.acapella.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('Import zip'), { target: { files: [file1] } })
    await waitFor(() => {
      expect(screen.getByText('Alto part (imported)')).toBeTruthy()
    })

    const file2 = new File([zip], 'song.acapella.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('Import zip'), { target: { files: [file2] } })
    await waitFor(() => {
      expect(screen.getByText('Alto part (imported 2)')).toBeTruthy()
    })

    const listed = await repo.listProjects()
    expect(listed.map((item) => item.title).sort()).toEqual(
      ['Alto part', 'Alto part (imported)', 'Alto part (imported 2)'].sort(),
    )
    // Three distinct project ids, none reused from the source or each other.
    expect(new Set(listed.map((item) => item.id)).size).toBe(3)
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

  it('renames a song from the list and persists the new title', async () => {
    await repo.saveProject(createEmptyProject('Untitled song'))

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Untitled song')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rename Untitled song' }))
    fireEvent.change(screen.getByLabelText('Song name'), {
      target: { value: '  Autumn Leaves  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })
    const listed = await repo.listProjects()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.title).toBe('Autumn Leaves')
  })

  it('rejects an empty rename and keeps the old title', async () => {
    await repo.saveProject(createEmptyProject('Autumn Leaves'))

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rename Autumn Leaves' }))
    fireEvent.change(screen.getByLabelText('Song name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Song name is required')
    })
    expect((await repo.listProjects())[0]?.title).toBe('Autumn Leaves')
  })

  it('cancels a rename without saving', async () => {
    await repo.saveProject(createEmptyProject('Autumn Leaves'))

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rename Autumn Leaves' }))
    fireEvent.change(screen.getByLabelText('Song name'), { target: { value: 'Something else' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })
    expect(screen.queryByLabelText('Song name')).toBeNull()
    expect((await repo.listProjects())[0]?.title).toBe('Autumn Leaves')
  })

  it('deletes a song only after confirmation, and drops its audio blobs', async () => {
    const saved = await repo.saveProject({
      ...createEmptyProject('Autumn Leaves'),
      ghostTrackId: 'blob-tiny',
    })
    await repo.putAudioBlob({
      id: 'blob-tiny',
      projectId: saved.id,
      kind: 'ghost',
      mimeType: 'audio/webm',
      byteSize: 4,
      createdAt: saved.createdAt,
      blob: new Blob(['abcd'], { type: 'audio/webm' }),
    })

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Autumn Leaves' }))
    expect(await repo.listProjects()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Autumn Leaves' }))

    await waitFor(() => {
      expect(screen.getByText('No songs yet')).toBeTruthy()
    })
    expect(await repo.listProjects()).toHaveLength(0)
    expect(await repo.getAudioBlob('blob-tiny')).toBeUndefined()
  })

  it('keeps the song when the delete confirmation is dismissed', async () => {
    await repo.saveProject(createEmptyProject('Autumn Leaves'))

    renderHome()
    await waitFor(() => {
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Autumn Leaves' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))

    expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm delete Autumn Leaves' })).toBeNull()
    expect(await repo.listProjects()).toHaveLength(1)
  })

  it('surfaces a rejected delete as an alert and keeps the song listed', async () => {
    await repo.saveProject(createEmptyProject('Autumn Leaves'))
    const failingRepo: ProjectRepository = {
      ...repo,
      deleteProject: () => Promise.reject(new Error('Delete failed')),
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes repo={failingRepo} />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('Autumn Leaves')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Autumn Leaves' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Autumn Leaves' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Delete failed')
    })
    expect(screen.getByText('Autumn Leaves')).toBeTruthy()
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
      expect(screen.getByText('Imported song (imported)')).toBeTruthy()
    })
    const listed = await repo.listProjects()
    expect(listed).toHaveLength(1)
    const forkedGhostId = listed[0]?.ghostTrackId
    expect(forkedGhostId).toBeTruthy()
    expect(await repo.getAudioBlob(forkedGhostId!)).toBeTruthy()
    expect(await repo.getAudioBlob('extra-not-referenced')).toBeUndefined()
    expect(await repo.getAudioBlob('slip')).toBeUndefined()
    expect(await repo.getAudioBlob('evil')).toBeUndefined()
  })
})
