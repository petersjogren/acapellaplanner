import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './app/routes.tsx'

// Vite's base ('/acapellaplanner/' on GitHub Pages, '/' in dev). Router paths
// are written from the app root, so the deploy prefix belongs here — without
// it every route 404s on a project site. Trailing slash trimmed: BrowserRouter
// wants '/acapellaplanner', not '/acapellaplanner/'.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <AppRoutes />
    </BrowserRouter>
  )
}
