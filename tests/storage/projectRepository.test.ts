/** @vitest-environment node */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject, CURRENT_SCHEMA_VERSION, type Project } from '../../src/domain/schemas.ts'
import { AcapellaDB } from '../../src/storage/db.ts'
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../src/storage/projectRepository.ts'

describe('projectRepository', () => {
  let database: AcapellaDB
  let repo: ProjectRepository

  beforeEach(() => {
    database = new AcapellaDB(`acapellaplanner-test-${crypto.randomUUID()}`)
    repo = createProjectRepository(database)
  })

  afterEach(async () => {
    database.close()
    await database.delete()
  })

  it('saves and reads a project', async () => {
    const project = createEmptyProject('When I Fall')
    const saved = await repo.saveProject(project)
    const loaded = await repo.getProject(project.id)

    expect(loaded).toEqual(saved)
    expect(loaded?.title).toBe('When I Fall')
    expect(loaded?.id).toBe(project.id)
  })

  it('returns undefined for a missing project', async () => {
    await expect(repo.getProject('missing-id')).resolves.toBeUndefined()
  })

  it('updates an existing project', async () => {
    const project = createEmptyProject('Draft')
    await repo.saveProject(project)

    const updated = await repo.saveProject({ ...project, title: 'Final mix' })
    const loaded = await repo.getProject(project.id)

    expect(updated.title).toBe('Final mix')
    expect(loaded?.title).toBe('Final mix')
    const listed = await repo.listProjects()
    expect(listed).toHaveLength(1)
  })

  it('lists saved projects', async () => {
    const a = createEmptyProject('Song A')
    const b = createEmptyProject('Song B')
    await repo.saveProject(a)
    await repo.saveProject(b)

    const listed = await repo.listProjects()
    expect(listed.map((project) => project.id).sort()).toEqual([a.id, b.id].sort())
    expect(listed.map((project) => project.title).sort()).toEqual(['Song A', 'Song B'])
  })

  it('deletes a project', async () => {
    const project = createEmptyProject('To delete')
    await repo.saveProject(project)

    await repo.deleteProject(project.id)

    await expect(repo.getProject(project.id)).resolves.toBeUndefined()
    await expect(repo.listProjects()).resolves.toEqual([])
  })

  it('rejects saving an invalid project', async () => {
    await expect(repo.saveProject({} as Project)).rejects.toThrow()
  })

  it('bumps updatedAt on save', async () => {
    const project = {
      ...createEmptyProject(),
      updatedAt: '2020-01-01T00:00:00.000Z',
    }

    const saved = await repo.saveProject(project)

    expect(saved.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(
      new Date('2020-01-01T00:00:00.000Z').getTime(),
    )
    const loaded = await repo.getProject(project.id)
    expect(loaded?.updatedAt).toBe(saved.updatedAt)
  })

  it('parses stored rows with ProjectSchema on read', async () => {
    await database.projects.put({ id: 'corrupt', title: 1 } as unknown as Project)

    await expect(repo.getProject('corrupt')).rejects.toThrow()
    await expect(repo.listProjects()).rejects.toThrow()
  })

  it('migrates a pre-schemaVersion row on read (data saved before the field existed)', async () => {
    const { schemaVersion: _drop, ...legacyShape } = createEmptyProject('Legacy row')
    await database.projects.put(legacyShape as unknown as Project)

    const loaded = await repo.getProject(legacyShape.id)
    expect(loaded?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(loaded?.title).toBe('Legacy row')

    const listed = await repo.listProjects()
    expect(listed.find((project) => project.id === legacyShape.id)?.schemaVersion).toBe(
      CURRENT_SCHEMA_VERSION,
    )
  })

  it('round-trips an audio blob', async () => {
    const project = await repo.saveProject(createEmptyProject())
    const blob = new Blob(['ghost-audio'], { type: 'audio/webm' })
    const id = crypto.randomUUID()

    await repo.putAudioBlob({
      id,
      projectId: project.id,
      kind: 'ghost',
      mimeType: 'audio/webm',
      byteSize: blob.size,
      createdAt: new Date().toISOString(),
      blob,
    })

    const loaded = await repo.getAudioBlob(id)
    expect(loaded?.id).toBe(id)
    expect(loaded?.projectId).toBe(project.id)
    expect(loaded?.kind).toBe('ghost')
    expect(loaded?.mimeType).toBe('audio/webm')
    expect(loaded?.byteSize).toBe(blob.size)
    expect(loaded?.blob).toBeInstanceOf(Blob)
    expect(await loaded?.blob.text()).toBe('ghost-audio')
  })

  it('deletes audio blobs with the project', async () => {
    const project = await repo.saveProject(createEmptyProject())
    const blob = new Blob(['take'], { type: 'audio/webm' })
    const blobId = crypto.randomUUID()
    await repo.putAudioBlob({
      id: blobId,
      projectId: project.id,
      kind: 'take',
      mimeType: 'audio/webm',
      byteSize: blob.size,
      createdAt: new Date().toISOString(),
      blob,
    })

    await repo.deleteProject(project.id)

    await expect(repo.getAudioBlob(blobId)).resolves.toBeUndefined()
  })
})
