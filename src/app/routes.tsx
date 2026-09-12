import { Route, Routes } from 'react-router-dom'
import {
  defaultProjectRepository,
  ProjectRepositoryContext,
} from './projectRepositoryContext.tsx'
import type { ProjectRepository } from '../storage/projectRepository.ts'
import { HomePage } from '../pages/HomePage.tsx'
import { PreparePage } from '../pages/PreparePage.tsx'
import { ReviewPage } from '../pages/ReviewPage.tsx'
import { SingPage } from '../pages/SingPage.tsx'

export const APP_ROUTES = [
  { path: '/', page: 'HomePage' },
  { path: '/project/:id/prepare', page: 'PreparePage' },
  { path: '/project/:id/sing', page: 'SingPage' },
  { path: '/project/:id/review', page: 'ReviewPage' },
] as const

export function AppRoutes({
  repo = defaultProjectRepository,
}: {
  repo?: ProjectRepository
} = {}) {
  return (
    <ProjectRepositoryContext.Provider value={repo}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:id/prepare" element={<PreparePage />} />
        <Route path="/project/:id/sing" element={<SingPage />} />
        <Route path="/project/:id/review" element={<ReviewPage />} />
      </Routes>
    </ProjectRepositoryContext.Provider>
  )
}
