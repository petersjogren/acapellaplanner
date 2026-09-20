import { Route, Routes } from 'react-router-dom'
import {
  defaultProjectRepository,
  ProjectRepositoryContext,
} from './projectRepositoryContext.tsx'
import type { ProjectRepository } from '../storage/projectRepository.ts'
import { CalibrationPage } from '../pages/CalibrationPage.tsx'
import { HomePage } from '../pages/HomePage.tsx'
import { NotFound } from '../pages/NotFound.tsx'
import { PlayPage } from '../pages/PlayPage.tsx'
import { PreparePage } from '../pages/PreparePage.tsx'
import { ReviewPage } from '../pages/ReviewPage.tsx'
import { SingPage } from '../pages/SingPage.tsx'
import { WorkflowPage } from '../pages/WorkflowPage.tsx'

export const APP_ROUTES = [
  { path: '/', Component: HomePage },
  { path: '/calibrate', Component: CalibrationPage },
  { path: '/workflow', Component: WorkflowPage },
  { path: '/project/:id/prepare', Component: PreparePage },
  { path: '/project/:id/sing', Component: SingPage },
  { path: '/project/:id/play', Component: PlayPage },
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
