import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './app/routes.tsx'
import { unlockIOSAudioSession } from './audio/context.ts'

// Vite's base ('/acapellaplanner/' on GitHub Pages, '/' in dev). Router paths
// are written from the app root, so the deploy prefix belongs here — without
// it every route 404s on a project site. Trailing slash trimmed: BrowserRouter
// wants '/acapellaplanner', not '/acapellaplanner/'.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

// iOS Safari silences plain AudioContext output when the Ring/Silent switch
// is on, but not <audio> elements. Unlock on the very first user gesture
// anywhere in the app (not just Sing's Record button, which happens to call
// getUserMedia and gets this for free) so Prepare's Play Ghost mark-along is
// audible too. See src/audio/context.ts for the mechanism.
function useUnlockIOSAudioOnFirstGesture() {
  useEffect(() => {
    const events = ['pointerdown', 'touchend', 'keydown'] as const
    function onGesture() {
      unlockIOSAudioSession()
    }
    for (const event of events) {
      window.addEventListener(event, onGesture, { capture: true, passive: true })
    }
    return () => {
      for (const event of events) {
        window.removeEventListener(event, onGesture, { capture: true })
      }
    }
  }, [])
}

export default function App() {
  useUnlockIOSAudioOnFirstGesture()
  return (
    <BrowserRouter basename={basename}>
      <AppRoutes />
    </BrowserRouter>
  )
}
