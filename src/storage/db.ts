import Dexie, { type Table } from 'dexie'
import type { Project } from '../domain/schemas.ts'

export type AudioBlobKind =
  | 'ghost'
  | 'tonal'
  | 'click'
  | 'reference-stack'
  | 'take'
  | 'sheet'
  | 'other'

export type AudioBlobRecord = {
  id: string
  projectId: string
  kind: AudioBlobKind
  mimeType: string
  byteSize: number
  createdAt: string
  blob: Blob
  opfsKey?: string
}

export class AcapellaDB extends Dexie {
  projects!: Table<Project, string>
  audioBlobs!: Table<AudioBlobRecord, string>

  constructor(name = 'acapellaplanner') {
    super(name)
    this.version(1).stores({
      projects: 'id, updatedAt',
      audioBlobs: 'id, projectId, kind, createdAt',
    })
  }
}

export const db = new AcapellaDB()
