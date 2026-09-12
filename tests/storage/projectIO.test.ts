/** @vitest-environment node */
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createEmptyProject, ProjectSchema } from '../../src/domain/schemas.ts'
import { exportProjectZip, importProjectZip } from '../../src/storage/projectIO.ts'

describe('projectIO', () => {
  it('round-trips createEmptyProject and one tiny blob through zip', async () => {
    const project = { ...createEmptyProject('Roundtrip song'), ghostTrackId: 'blob-tiny' }
    const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })

    const zip = await exportProjectZip(project, async (id) => (id === 'blob-tiny' ? audio : undefined))

    const unzipped = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(unzipped).sort()).toEqual(['audio/blob-tiny.webm', 'project.json'])

    const { project: imported, blobs } = await importProjectZip(zip)
    const parsed = ProjectSchema.parse(imported)

    expect(parsed.id).toBe(project.id)
    expect(parsed.title).toBe('Roundtrip song')
    expect(parsed.ghostTrackId).toBe('blob-tiny')
    expect(blobs).toHaveLength(1)
    expect(blobs[0]?.id).toBe('blob-tiny')
    expect(blobs[0]?.kind).toBe('ghost')
    expect(blobs[0]?.mimeType).toBe('audio/webm')
    expect(new Uint8Array(await blobs[0]!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('throws when project.json is missing', async () => {
    const emptyZip = await exportProjectZip(createEmptyProject(), async () => undefined)
    const files = unzipSync(new Uint8Array(await emptyZip.arrayBuffer()))
    delete files['project.json']
    const { zipSync } = await import('fflate')
    const broken = new Blob([zipSync(files)], { type: 'application/zip' })

    await expect(importProjectZip(broken)).rejects.toThrow(/project\.json/)
  })
})
