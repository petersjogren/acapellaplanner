import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('PWA', () => {
  it('references a web app manifest from the app shell config', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')

    expect(config).toContain('VitePWA')
    expect(config).toContain("name: 'Acapella Planner'")
    expect(config).toContain("display: 'standalone'")
    // start_url/scope follow the deploy base rather than a hardcoded '/', so a
    // GitHub Pages project site installs scoped to /<repo>/.
    expect(config).toContain('start_url: base')
    expect(config).toContain('scope: base')
    expect(html).toContain('theme-color')
    expect(
      html.includes('rel="manifest"') || config.includes("name: 'Acapella Planner'"),
    ).toBe(true)
  })

  it('derives the base from BASE_PATH with a project-site default', () => {
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')
    expect(config).toContain("process.env.BASE_PATH ?? '/acapellaplanner/'")
    // The service worker must fall back within the deployed scope, or a deep
    // link reload is served the wrong shell.
    expect(config).toContain('navigateFallback: `${base}index.html`')
  })

  it('reloads the open tab after an autoUpdate SW replaces hashed chunks', () => {
    const main = readFileSync(resolve(root, 'src/main.tsx'), 'utf8')
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')
    // autoUpdate skipWaiting+clientsClaim deletes the previous pdfjs chunk;
    // without a reload the still-running tab 404s the dynamic import.
    expect(config).toContain("registerType: 'autoUpdate'")
    expect(main).toContain('installStaleAssetReload')
  })
})
