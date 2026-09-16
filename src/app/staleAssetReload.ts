/** sessionStorage flag so a still-missing chunk cannot reload-loop. */
export const STALE_ASSET_RELOAD_KEY = 'acapellaplanner.stale-asset-reload'

export type StaleAssetReloadEnv = {
  target: Pick<EventTarget, 'addEventListener'>
  location: { reload: () => void }
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  /** Omit or pass null when the browser has no service worker API. */
  serviceWorker?: {
    controller: unknown
    addEventListener: (type: string, listener: EventListener) => void
  } | null
}

/**
 * GitHub Pages + `autoUpdate` SW: a new deploy activates immediately and
 * deletes the previous hashed assets. A tab that was already open still runs
 * the old JS, so `import('./pdfjsRender.ts')` requests a chunk that 404s
 * (Pages then serves `404.html`, and the browser reports a failed dynamic
 * import). Reload once when Vite fails a preload, or when an *existing*
 * controller is replaced — not on the first SW claim, which would bounce
 * every fresh visit.
 */
export function installStaleAssetReload(env: StaleAssetReloadEnv): void {
  const reloadOnce = (): void => {
    if (env.sessionStorage.getItem(STALE_ASSET_RELOAD_KEY)) return
    env.sessionStorage.setItem(STALE_ASSET_RELOAD_KEY, '1')
    env.location.reload()
  }

  env.target.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnce()
  })

  if (env.serviceWorker?.controller) {
    env.serviceWorker.addEventListener('controllerchange', reloadOnce)
  }
}
