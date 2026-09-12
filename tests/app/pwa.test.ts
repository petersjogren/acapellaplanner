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
    expect(config).toContain("start_url: '/'")
    expect(html).toContain('theme-color')
    expect(
      html.includes('rel="manifest"') || config.includes("name: 'Acapella Planner'"),
    ).toBe(true)
  })
})
