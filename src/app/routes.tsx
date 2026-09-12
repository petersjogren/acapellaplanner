import { Route, Routes } from 'react-router-dom'
import {
  defaultProjectRepository,
  ProjectRepositoryContext,
} from './projectRepositoryContext.tsx'
import type { ProjectRepository } from '../storage/projectRepository.ts'
import { HomePage } from '../pages/HomePage.tsx'
import { NotFound } from '../pages/NotFound.tsx'
import { PreparePage } from '../pages/PreparePage.tsx'
import { ReviewPage } from '../pages/ReviewPage.tsx'
import { SingPage } from '../pages/SingPage.tsx'

export const APP_ROUTES = [
  { path: '/', Component: HomePage },
  { path: '/project/:id/prepare', Component: PreparePage },
  { path: '/project/:id/sing', Component: SingPage },
  { path: '/project/:id/review', Component: ReviewPage },
] as const

export function AppRoutes({
  repo = defaultProjectRepository,
}: {
  repo?: ProjectRepository
} = {}) {
  return (
    <ProjectRepositoryContext.Provider value={repo}>
      <Routes>
        {APP_ROUTES.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ProjectRepositoryContext.Provider>
  )
}
