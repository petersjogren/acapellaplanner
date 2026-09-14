import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProject, ProjectSchema } from '../../src/domain/schemas.ts'
import {
  audioBlobIdFromZipPath,
  downloadBlob,
  exportProjectZip,
  importProjectZip,
} from '../../src/storage/projectIO.ts'

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
    const broken = new Blob([zipSync(files)], { type: 'application/zip' })

    await expect(importProjectZip(broken)).rejects.toThrow(/project\.json/)
  })

  it('throws when project.json is invalid JSON', async () => {
    const broken = new Blob(
      [zipSync({ 'project.json': strToU8('{not json') })],
      { type: 'application/zip' },
    )

    await expect(importProjectZip(broken)).rejects.toThrow()
  })

  it('imports a pre-schemaVersion zip (exported before the field existed)', async () => {
    const { schemaVersion: _drop, ...legacyShape } = createEmptyProject('Legacy song')
    const legacyZip = new Blob(
      [zipSync({ 'project.json': strToU8(JSON.stringify(legacyShape)) })],
      { type: 'application/zip' },
    )

    const { project: imported } = await importProjectZip(legacyZip)

    expect(imported.schemaVersion).toBe(1)
    expect(imported.title).toBe('Legacy song')
  })

  it('throws when project.json fails schema parse', async () => {
    const broken = new Blob(
      [zipSync({ 'project.json': strToU8(JSON.stringify({ title: 'Nope' })) })],
      { type: 'application/zip' },
    )

    await expect(importProjectZip(broken)).rejects.toThrow()
  })

  it('ignores extra audio entries not referenced by the project', async () => {
    const project = { ...createEmptyProject('Allowlist'), ghostTrackId: 'blob-tiny' }
    const zip = await exportProjectZip(project, async () => new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    files['audio/extra-not-referenced.webm'] = new Uint8Array([9, 9, 9])
    const padded = new Blob([zipSync(files)], { type: 'application/zip' })

    const { blobs } = await importProjectZip(padded)
    expect(blobs.map((item) => item.id)).toEqual(['blob-tiny'])
  })

  it('drops nested and zip-slip audio paths', async () => {
    const project = { ...createEmptyProject('Slip'), ghostTrackId: 'blob-tiny' }
    const zip = await exportProjectZip(project, async () => new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    files['audio/../evil.webm'] = new Uint8Array([2])
    files['audio/nested/../blob-tiny.webm'] = new Uint8Array([3])
    files['audio/nested/foo.webm'] = new Uint8Array([4])
    files['audio//double.webm'] = new Uint8Array([5])
    const malicious = new Blob([zipSync(files)], { type: 'application/zip' })

    const { blobs } = await importProjectZip(malicious)
    expect(blobs.map((item) => item.id)).toEqual(['blob-tiny'])
  })

  it('rejects zip paths with .. or extra slashes after audio/', () => {
    expect(audioBlobIdFromZipPath('audio/blob-tiny.webm')).toBe('blob-tiny')
    expect(audioBlobIdFromZipPath('audio/../evil.webm')).toBeNull()
    expect(audioBlobIdFromZipPath('audio/nested/../slip.webm')).toBeNull()
    expect(audioBlobIdFromZipPath('audio/nested/foo.webm')).toBeNull()
    expect(audioBlobIdFromZipPath('audio//double.webm')).toBeNull()
  })
})

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('revokes the object URL after a delay instead of in the same turn as click', () => {
    vi.useFakeTimers()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      rel: '',
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)

    downloadBlob(new Blob(['zip']), 'song.acapella.zip')

    expect(click).toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(999)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoke).toHaveBeenCalledTimes(1)
  })
})
