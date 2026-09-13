import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { githubPagesSpaFallback } from './vite/githubPagesSpaFallback.ts'

// GitHub Pages serves a project site from /<repo>/, so assets, the PWA scope
// and the service worker's navigate fallback all need that prefix. Set
// BASE_PATH='/' (or use a custom domain / <user>.github.io repo) to serve from
// the root instead.
const base = process.env.BASE_PATH ?? '/acapellaplanner/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'record-lamp.svg',
        'pwa-192x192.png',
        'pwa-512x512.png',
      ],
      manifest: {
        name: 'Acapella Planner',
        short_name: 'Acapella',
        description: 'Local-first ghost-track studio for acapella rehearsal.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f6f1e8',
        theme_color: '#c23b2a',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: `${base}index.html`,
      },
    }),
    githubPagesSpaFallback(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
})
