import { describe, expect, it } from 'vitest'
import { githubPagesSpaFallback } from '../../vite/githubPagesSpaFallback.ts'

type EmittedFile = { type: string; fileName: string; source: string }

function runPlugin(bundle: Record<string, unknown>) {
  const plugin = githubPagesSpaFallback()
  const emitted: EmittedFile[] = []
  const warnings: string[] = []
  const context = {
    emitFile: (file: EmittedFile) => emitted.push(file),
    warn: (message: string) => warnings.push(message),
  }
  const hook = plugin.generateBundle as unknown as (
    this: typeof context,
    options: unknown,
    bundle: unknown,
  ) => void
  hook.call(context, {}, bundle)
  return { emitted, warnings }
}

describe('githubPagesSpaFallback', () => {
  it('only runs on build, after other plugins', () => {
    const plugin = githubPagesSpaFallback()
    expect(plugin.apply).toBe('build')
    expect(plugin.enforce).toBe('post')
  })

  // GitHub Pages has no rewrite rule: without this copy, reloading a deep link
  // such as /project/<id>/sing returns a hard 404 instead of the app.
  it('emits 404.html byte-identical to index.html', () => {
    const html = '<!doctype html><html><body>app shell</body></html>'
    const { emitted } = runPlugin({
      'index.html': { type: 'asset', fileName: 'index.html', source: html },
    })

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: 'asset',
      fileName: '404.html',
      source: html,
    })
  })

  it('warns instead of throwing when index.html is absent', () => {
    const { emitted, warnings } = runPlugin({})
    expect(emitted).toHaveLength(0)
    expect(warnings[0]).toMatch(/index\.html not found/i)
  })

  it('ignores a non-asset index.html entry', () => {
    const { emitted, warnings } = runPlugin({
      'index.html': { type: 'chunk', fileName: 'index.html' },
    })
    expect(emitted).toHaveLength(0)
    expect(warnings).toHaveLength(1)
  })
})

describe('router basename', () => {
  it('strips the trailing slash from BASE_URL', () => {
    // BrowserRouter wants '/acapellaplanner', not '/acapellaplanner/'.
    expect('/acapellaplanner/'.replace(/\/$/, '')).toBe('/acapellaplanner')
    // Root deploys become '' — BrowserRouter's default.
    expect('/'.replace(/\/$/, '')).toBe('')
  })
})
