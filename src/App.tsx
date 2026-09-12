import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './app/routes.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
