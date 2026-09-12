import { createContext, useContext } from 'react'
import {
  createProjectRepository,
  type ProjectRepository,
} from '../storage/projectRepository.ts'

export const defaultProjectRepository = createProjectRepository()

export const ProjectRepositoryContext =
  createContext<ProjectRepository>(defaultProjectRepository)

export function useProjectRepository(): ProjectRepository {
  return useContext(ProjectRepositoryContext)
}
