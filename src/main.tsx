import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installStaleAssetReload } from './app/staleAssetReload.ts'
import './index.css'
import App from './App.tsx'

installStaleAssetReload({
  target: window,
  location,
  sessionStorage,
  serviceWorker: navigator.serviceWorker ?? null,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
