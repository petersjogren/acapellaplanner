import type { Plugin } from 'vite'

/**
 * GitHub Pages has no server-side rewrite, so a deep link like
 * /project/<id>/sing returns a real 404 on reload or bookmark. Pages serves
 * 404.html for any unmatched path, so shipping a byte-identical copy of
 * index.html makes it the SPA fallback and the router takes over from there.
 */
export function githubPagesSpaFallback(): Plugin {
  return {
    name: 'github-pages-spa-fallback',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const indexHtml = bundle['index.html']
      if (!indexHtml || indexHtml.type !== 'asset') {
        this.warn('index.html not found in bundle; skipping 404.html fallback')
        return
      }
      this.emitFile({
        type: 'asset',
        fileName: '404.html',
        source: indexHtml.source,
      })
    },
  }
}
