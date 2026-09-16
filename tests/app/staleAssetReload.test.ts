import { describe, expect, it, vi } from 'vitest'
import {
  STALE_ASSET_RELOAD_KEY,
  installStaleAssetReload,
} from '../../src/app/staleAssetReload.ts'

function createEnv(options?: { controller?: object | null; alreadyReloaded?: boolean }) {
  const target = new EventTarget()
  const reload = vi.fn()
  const store = new Map<string, string>()
  if (options?.alreadyReloaded) store.set(STALE_ASSET_RELOAD_KEY, '1')
  const swListeners: Array<() => void> = []
  const serviceWorker =
    options && 'controller' in options
      ? {
          controller: options.controller,
          addEventListener: (_type: string, listener: EventListener) => {
            swListeners.push(listener as () => void)
          },
        }
      : null

  installStaleAssetReload({
    target,
    location: { reload },
    sessionStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value)
      },
    },
    serviceWorker,
  })

  return { target, reload, store, swListeners }
}

describe('installStaleAssetReload', () => {
  it('reloads once on vite:preloadError and prevents the default reject', () => {
    const { target, reload, store } = createEnv()
    const event = new Event('vite:preloadError', { cancelable: true })
    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(store.get(STALE_ASSET_RELOAD_KEY)).toBe('1')

    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe to controllerchange on a first-visit SW claim', () => {
    const { reload, swListeners } = createEnv({ controller: null })
    expect(swListeners).toHaveLength(0)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads when an already-controlling SW is replaced', () => {
    const { reload, swListeners } = createEnv({ controller: {} })
    expect(swListeners).toHaveLength(1)
    swListeners[0]!()
    expect(reload).toHaveBeenCalledTimes(1)
    swListeners[0]!()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload again in a session that already recovered', () => {
    const { target, reload } = createEnv({ alreadyReloaded: true, controller: {} })
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).not.toHaveBeenCalled()
  })
})
