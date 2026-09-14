import { migrateAndParseProject } from '../domain/migrations.ts'
import { ProjectSchema, type Project } from '../domain/schemas.ts'
import { db as defaultDb, type AcapellaDB, type AudioBlobRecord } from './db.ts'

export function createProjectRepository(database: AcapellaDB = defaultDb) {
  return {
    async listProjects(): Promise<Project[]> {
      const rows = await database.projects.toArray()
      return rows
        .map((row) => migrateAndParseProject(row))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async getProject(id: string): Promise<Project | undefined> {
      const row = await database.projects.get(id)
      return row === undefined ? undefined : migrateAndParseProject(row)
    },

    async saveProject(project: Project): Promise<Project> {
      const parsed = ProjectSchema.parse(project)
      const saved: Project = {
        ...parsed,
        updatedAt: new Date().toISOString(),
      }
      await database.projects.put(saved)
      return saved
    },

    async deleteProject(id: string): Promise<void> {
      await database.transaction('rw', database.projects, database.audioBlobs, async () => {
        await database.audioBlobs.where('projectId').equals(id).delete()
        await database.projects.delete(id)
      })
    },

    async putAudioBlob(record: AudioBlobRecord): Promise<string> {
      await database.audioBlobs.put(record)
      return record.id
    },

    async getAudioBlob(id: string): Promise<AudioBlobRecord | undefined> {
      return database.audioBlobs.get(id)
    },

    async deleteAudioBlob(id: string): Promise<void> {
      await database.audioBlobs.delete(id)
    },
  }
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>

const defaultRepository = createProjectRepository()

export const listProjects = defaultRepository.listProjects
export const getProject = defaultRepository.getProject
export const saveProject = defaultRepository.saveProject
export const deleteProject = defaultRepository.deleteProject
export const putAudioBlob = defaultRepository.putAudioBlob
export const getAudioBlob = defaultRepository.getAudioBlob
export const deleteAudioBlob = defaultRepository.deleteAudioBlob
